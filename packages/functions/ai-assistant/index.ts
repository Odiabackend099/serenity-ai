/**
 * AI Assistant Edge Function
 *
 * Picks up queued messages from message_queue and processes them:
 * 1. Check NDPR consent — if not given, ask for it first
 * 2. Download and transcribe voice notes via Deepgram (PII redacted)
 * 3. Check if this is a feedback reply → save rating, skip AI
 * 4. Detect emergency keywords → abort booking session if active
 * 5. Route active/new appointment booking through deterministic backend flow
 * 6. Call Groq-backed AI (Dr Ade) only for general non-booking messages
 * 7. Save conversation to DB
 * 8. Send response back via WhatsApp
 * 9. If emergency: trigger emergency-alert function
 *
 * Called by pg_cron every 1 minute OR directly via Supabase scheduled trigger.
 * Processes up to 5 queued messages per invocation to stay within CPU budget.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import {
  getSupabaseClient,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  getConversationHistory,
  isAuthorizedInternalRequest,
  saveConversation,
  recordConsent,
  trackApiUsage,
} from '../_shared/supabase.ts'
import {
  sendTextMessage,
  downloadMedia,
  sendAppointmentReminder1Week,
  sendAppointmentReminder24h,
} from '../_shared/whatsapp.ts'
import {
  sendAppointmentConfirmationEmail,
  sendStaffAppointmentBookedEmail,
} from '../_shared/email.ts'
import {
  callDrAde,
  detectEmergency,
  buildConsentMessage,
  isConsentResponse,
} from '../_shared/ai-provider.ts'
import {
  transcribeAudio,
  redactPII,
  parseFeedbackRating,
} from '../_shared/deepgram.ts'
import {
  checkCalendarConflict,
  cancelAppointmentEvent,
  createAppointmentEvent,
  isCalendarConfigured,
} from '../_shared/calendar.ts'
import type {
  AIMessage,
  BookingSessionRow,
  MessageQueueRow,
  PatientRow,
} from '../_shared/types.ts'
import { BOOKING_STEPS } from '../_shared/types.ts'

const BATCH_SIZE = 5
const MAX_RETRY_COUNT = 3

const CENTER_ADDRESSES: Record<string, string> = {
  Karu: 'No. 11 Ali Amodu Close (behind CBN Quarters), Karu, Abuja',
  Galadimawa: 'No. 10 Royal Homes Estate, Galadinmawa, Abuja',
}

const FIXED_CRISIS_RESPONSE = `I'm really sorry you're feeling this way. You're not alone, and immediate help is available.

Please call Serenity Royale Hospital now: +234 806 219 7384 or +234 811 689 1990. If you are in immediate danger, please go to the nearest emergency department or ask someone near you to stay with you while you call.`

const FIRST_BOOKING_PROMPT = 'Sure. I can help book your appointment. What is your full name?'

type BookingResult = {
  response: string
  sentiment?: 'positive' | 'neutral' | 'distressed' | 'crisis' | null
}

type TemplateResult = {
  response: string
  sentiment: 'positive' | 'neutral' | 'distressed' | 'crisis' | null
  label: string
}

type ValidationResult<T> = {
  value: T | null
  error: string | null
}

type AssistantRequestBody = {
  queueItemId?: string
}

type DoctorContact = {
  id: string
  name: string
  phone: string | null
  location?: string | null
}

type StaffNotificationRecipient = {
  role: 'operations_manager' | 'primary_doctor' | 'assigned_doctor'
  name: string
  phone: string
}

type PatientContext = Pick<PatientRow, 'id' | 'phone_number' | 'name' | 'email' | 'gender' | 'location' | 'consent_ndpr' | 'consent_date' | 'created_at' | 'updated_at'>

type AppointmentMemoryRow = {
  id: string
  appointment_date: string
  appointment_time: string | null
  center: string | null
  service_type: string | null
  reason: string | null
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled'
  created_at: string
  created_from_whatsapp?: boolean | null
  doctors?: { name?: string | null } | null
}

type EmergencyMemoryRow = {
  id: string
  alert_type: string | null
  severity: string | null
  created_at: string
}

type PatientMemoryContext = {
  patient: PatientContext
  latestAppointment: AppointmentMemoryRow | null
  latestCompletedBooking: BookingSessionRow | null
  recentConversation: AIMessage[]
  unresolvedEmergency: EmergencyMemoryRow | null
}

type AdminDateRange = {
  label: string
  startDate: string
  endDate: string
  reminderType: '24h' | '1week' | 'early'
}

type AdminAppointmentRow = {
  id: string
  appointment_date: string
  appointment_time: string | null
  center: string | null
  service_type: string | null
  status: string
  created_at: string
  reminder_1week_sent?: boolean | null
  reminder_24h_sent?: boolean | null
  patients?: { name?: string | null; phone_number?: string | null; email?: string | null } | null
  doctors?: { name?: string | null } | null
}

serve(async (req: Request) => {
  if (!isAuthorizedInternalRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = getSupabaseClient()
  const requestBody = await parseAssistantRequestBody(req)
  let processed = 0
  let errors = 0
  let skipped = 0

  const queuedMessages = await getQueuedMessages(supabase, requestBody.queueItemId)

  if (!queuedMessages || queuedMessages.length === 0) {
    return Response.json({ processed: 0, errors: 0, skipped: 0, message: 'No queued messages' })
  }

  for (const queueItem of queuedMessages) {
    const claimedQueueItem = await claimQueueItem(supabase, queueItem.id)
    if (!claimedQueueItem) {
      skipped++
      continue
    }

    try {
      await processMessage(supabase, claimedQueueItem)
      await supabase.from('message_queue').update({ status: 'completed' }).eq('id', claimedQueueItem.id)
      processed++
    } catch (err) {
      const error = err as Error
      console.error(`[ai-assistant] Failed queue item ${claimedQueueItem.id}:`, error.message)

      const retryCount = (claimedQueueItem.retry_count ?? 0) + 1
      if (retryCount >= MAX_RETRY_COUNT) {
        await supabase.from('message_queue').update({ status: 'dead_letter', last_error: error.message, retry_count: retryCount }).eq('id', claimedQueueItem.id)
      } else {
        const backoffMs = Math.pow(2, retryCount - 1) * 1000
        await supabase.from('message_queue').update({
          status: 'queued',
          last_error: error.message,
          retry_count: retryCount,
          next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
        }).eq('id', claimedQueueItem.id)
      }
      errors++
    }
  }

  return Response.json({ processed, errors, skipped, total: queuedMessages.length, immediate: Boolean(requestBody.queueItemId) })
})

async function parseAssistantRequestBody(req: Request): Promise<AssistantRequestBody> {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return {}

  try {
    const body = await req.json() as AssistantRequestBody
    return typeof body.queueItemId === 'string' && body.queueItemId.trim()
      ? { queueItemId: body.queueItemId.trim() }
      : {}
  } catch {
    return {}
  }
}

async function getQueuedMessages(
  supabase: ReturnType<typeof getSupabaseClient>,
  queueItemId?: string,
): Promise<MessageQueueRow[]> {
  const now = new Date().toISOString()

  if (queueItemId) {
    const { data, error } = await supabase
      .from('message_queue')
      .select('*')
      .eq('id', queueItemId)
      .eq('status', 'queued')
      .lte('next_retry_at', now)
      .maybeSingle()

    if (error) throw new Error(`Failed to fetch queued message ${queueItemId}: ${error.message}`)
    return data ? [data as MessageQueueRow] : []
  }

  const { data, error } = await supabase
    .from('message_queue')
    .select('*')
    .eq('status', 'queued')
    .lte('next_retry_at', now)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) throw new Error(`Failed to fetch queued messages: ${error.message}`)
  return (data ?? []) as MessageQueueRow[]
}

async function claimQueueItem(
  supabase: ReturnType<typeof getSupabaseClient>,
  queueItemId: string,
): Promise<MessageQueueRow | null> {
  const { data, error } = await supabase
    .from('message_queue')
    .update({ status: 'processing', last_error: null })
    .eq('id', queueItemId)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(`Failed to claim queue item ${queueItemId}: ${error.message}`)
  return data as MessageQueueRow | null
}

async function processMessage(
  supabase: ReturnType<typeof getSupabaseClient>,
  queueItem: Record<string, unknown>,
): Promise<void> {
  const phoneNumber = (queueItem.phone_number ?? queueItem.patient_phone) as string
  const patientId = queueItem.patient_id as string
  const messageType = queueItem.message_type as string
  const whatsappMessageId = queueItem.whatsapp_message_id as string
  let messageText = queueItem.message_text as string | null

  // ── Load patient ─────────────────────────────────────────────────────────
  const { data: patient } = await supabase
    .from('patients')
    .select('id, phone_number, name, email, gender, location, consent_ndpr, consent_date, created_at, updated_at')
    .eq('id', patientId)
    .single() as { data: PatientContext | null }

  if (!patient) throw new Error(`Patient ${patientId} not found`)

  const preConsentEmergencyCheck = detectEmergency(messageText ?? '')

  // ── Staff/admin WhatsApp commands ────────────────────────────────────────
  // Dr K and the operations secretary can ask for appointment summaries and
  // reminder sends directly on WhatsApp. Patients never receive admin data.
  const adminCommand = await handleAdminWhatsAppCommand(supabase, phoneNumber, messageText ?? '')
  if (adminCommand) {
    await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageText ? redactPII(messageText) : null,
      aiResponse: adminCommand.response,
      mediaUrl: queueItem.media_url as string | null,
      sentiment: adminCommand.sentiment,
      hasEmergencyKeywords: false,
      whatsappMessageId,
      transcription: null,
      transcriptionRedacted: null,
    })

    await sendTextMessageSafely(phoneNumber, adminCommand.response, `admin command: ${adminCommand.label}`)
    return
  }

  // ── Emergency safety bypass before consent ───────────────────────────────
  // For critical safety concerns, use a fixed response and alert humans without
  // calling the AI model. This keeps crisis handling deterministic for demo and production.
  if (!patient.consent_ndpr && preConsentEmergencyCheck.isEmergency) {
    const conversationId = await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageText ? redactPII(messageText) : null,
      aiResponse: FIXED_CRISIS_RESPONSE,
      mediaUrl: queueItem.media_url as string | null,
      sentiment: 'crisis',
      hasEmergencyKeywords: true,
      whatsappMessageId,
      transcription: null,
      transcriptionRedacted: null,
    })

    await sendTextMessage(phoneNumber, FIXED_CRISIS_RESPONSE)

    await triggerEmergencyAlert(supabase, {
      patientId,
      conversationId,
      phoneNumber,
      patientName: patient.name ?? 'Unknown',
      alertType: preConsentEmergencyCheck.alertType!,
      severity: preConsentEmergencyCheck.severity!,
      keywords: preConsentEmergencyCheck.keywordsFound,
      messageSnippet: (messageText ?? '').slice(0, 200),
    })
    return
  }

  // ── NDPR Consent gate ─────────────────────────────────────────────────────
  if (!patient.consent_ndpr) {
    const consentCheck = isConsentResponse(messageText ?? '')
    if (consentCheck === 'yes') {
      await recordConsent(supabase, patientId, messageText ?? 'YES')
      await sendTextMessage(phoneNumber,
        `Thank you! Your consent has been recorded. 🌿\n\nI'm Dr Ade, your AI health assistant at Serenity Royale Hospital. How can I help you today?\n\n• Book an appointment\n• Ask about our services\n• Learn about costs\n• Get emergency support`)
      await saveConversation(supabase, { patientId, messageType: 'text', patientMessage: messageText, patientMessageRedacted: messageText, aiResponse: 'Consent recorded. Welcome message sent.', mediaUrl: null, sentiment: 'positive', hasEmergencyKeywords: false, whatsappMessageId, transcription: null, transcriptionRedacted: null })
      return
    }
    if (consentCheck === 'no') {
      await sendTextMessage(phoneNumber, `No problem. We respect your privacy. You can still reach us directly:\n📞 +234 806 219 7384\n📞 +234 811 689 1990\n📧 info@serenityroyalehospital.com\n\nWe're here 24/7 for emergencies. Stay well! 💚`)
      return
    }
    await sendTextMessage(phoneNumber, buildConsentMessage(patient.name ?? undefined))
    return
  }

  // ── Handle voice notes — transcribe via Deepgram ─────────────────────────
  let transcription: string | null = null
  let transcriptionRedacted: string | null = null

  if (messageType === 'audio' && queueItem.media_url) {
    try {
      const { data: mediaBytes, mimeType } = await downloadMedia(queueItem.media_url as string)
      const result = await transcribeAudio(mediaBytes, mimeType)
      transcription = result.transcript
      transcriptionRedacted = result.redacted
      messageText = result.transcript
      await trackApiUsage(supabase, 'deepgram', 0.0043)
    } catch (err) {
      console.error('[ai-assistant] Deepgram transcription failed:', err)
      messageText = '[Voice note — transcription unavailable]'
    }
  }

  // ── PII redaction on text messages ───────────────────────────────────────
  const messageRedacted = messageText ? redactPII(messageText) : null

  // ── Emergency detection ───────────────────────────────────────────────────
  const emergencyCheck = detectEmergency(messageText ?? '')

  // ── Check active booking session ─────────────────────────────────────────
  const { data: activeBooking } = await supabase
    .from('booking_sessions')
    .select('*')
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .single() as { data: BookingSessionRow | null }

  // ── Emergency handling before booking/AI ─────────────────────────────────
  if (emergencyCheck.isEmergency) {
    const assignedDoctor = activeBooking?.collected_doctor_preference
      ? await findPreferredDoctor(supabase, activeBooking.collected_doctor_preference)
      : null

    if (activeBooking) {
      await supabase.from('booking_sessions')
        .update({ status: 'abandoned', abandoned_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
        .eq('id', activeBooking.id)
      console.log(`[ai-assistant] Booking session ${activeBooking.id} abandoned — emergency detected`)
    }

    const conversationId = await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageRedacted,
      aiResponse: FIXED_CRISIS_RESPONSE,
      mediaUrl: queueItem.media_url as string | null,
      sentiment: 'crisis',
      hasEmergencyKeywords: true,
      whatsappMessageId,
      transcription,
      transcriptionRedacted,
    })

    await sendTextMessage(phoneNumber, FIXED_CRISIS_RESPONSE)

    await triggerEmergencyAlert(supabase, {
      patientId,
      conversationId,
      phoneNumber,
      patientName: patient.name ?? 'Unknown',
      alertType: emergencyCheck.alertType!,
      severity: emergencyCheck.severity!,
      keywords: emergencyCheck.keywordsFound,
      messageSnippet: (messageText ?? '').slice(0, 200),
      assignedDoctorName: assignedDoctor?.name ?? null,
      assignedDoctorPhone: assignedDoctor?.phone ?? null,
    })
    return
  }

  // ── Deterministic booking flow before general AI ─────────────────────────
  if (activeBooking) {
    const bookingResult = messageText
      ? await handleBookingSession(supabase, activeBooking, messageText, phoneNumber, patient)
      : { response: getPromptForStep(activeBooking), sentiment: 'neutral' as const }

    await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageRedacted,
      aiResponse: bookingResult.response,
      mediaUrl: queueItem.media_url as string | null,
      sentiment: bookingResult.sentiment ?? 'neutral',
      hasEmergencyKeywords: false,
      whatsappMessageId,
      transcription,
      transcriptionRedacted,
    })

    await sendTextMessageSafely(phoneNumber, bookingResult.response, 'booking response')
    return
  }

  const patientMemory = await loadPatientMemoryContext(supabase, patient)
  const memoryResult = await handleReturningPatientMemory(supabase, patientMemory, messageText ?? '')
  if (memoryResult) {
    await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageRedacted,
      aiResponse: memoryResult.response,
      mediaUrl: queueItem.media_url as string | null,
      sentiment: memoryResult.sentiment,
      hasEmergencyKeywords: false,
      whatsappMessageId,
      transcription,
      transcriptionRedacted,
    })

    await sendTextMessageSafely(phoneNumber, memoryResult.response, `patient memory: ${memoryResult.label}`)
    return
  }

  if (isBookingIntent(messageText ?? '')) {
    const response = await startBookingSession(supabase, patientId, phoneNumber)

    await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageRedacted,
      aiResponse: response,
      mediaUrl: queueItem.media_url as string | null,
      sentiment: 'positive',
      hasEmergencyKeywords: false,
      whatsappMessageId,
      transcription,
      transcriptionRedacted,
    })

    await sendTextMessageSafely(phoneNumber, response, 'booking start')
    return
  }

  // ── Feedback reply detection ──────────────────────────────────────────────
  // Check BEFORE calling AI — if patient is responding to feedback request,
  // save the rating and thank them without burning an AI provider call.
  const feedbackHandled = await detectAndHandleFeedbackReply(supabase, patientId, phoneNumber, messageText ?? '', whatsappMessageId)
  if (feedbackHandled) return

  // ── Hybrid templates before general AI ───────────────────────────────────
  // High-precision hospital facts and safety boundaries stay deterministic.
  // Open-ended low-risk support still goes to Groq below.
  const templateResult = getHybridTemplateResponse(messageText ?? '')
  if (templateResult) {
    await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageRedacted,
      aiResponse: templateResult.response,
      mediaUrl: queueItem.media_url as string | null,
      sentiment: templateResult.sentiment,
      hasEmergencyKeywords: false,
      whatsappMessageId,
      transcription,
      transcriptionRedacted,
    })

    await sendTextMessageSafely(phoneNumber, templateResult.response, `hybrid template: ${templateResult.label}`)
    return
  }

  // ── Build conversation history for AI ────────────────────────────────────
  const history = patientMemory.recentConversation.length > 0
    ? patientMemory.recentConversation
    : await getConversationHistory(supabase, patientId, 8)
  const memoryPrompt = buildPatientMemoryPrompt(patientMemory)

  const messages: AIMessage[] = [
    ...(memoryPrompt ? [memoryPrompt] : []),
    ...history,
    { role: 'user', content: messageText ?? '[media]' },
  ]

  // ── Call Dr Ade AI ───────────────────────────────────────────────────────
  const aiResult = await callDrAde(messages, phoneNumber)
  await trackApiUsage(supabase, aiResult.provider || 'groq', 0)

  const finalResponse = aiResult.message

  // ── Save conversation ─────────────────────────────────────────────────────
  await saveConversation(supabase, {
    patientId,
    messageType,
    patientMessage: messageText,
    patientMessageRedacted: messageRedacted,
    aiResponse: finalResponse,
    mediaUrl: queueItem.media_url as string | null,
    sentiment: aiResult.sentiment,
    hasEmergencyKeywords: false,
    whatsappMessageId,
    transcription,
    transcriptionRedacted,
  })

  // ── Send AI response ──────────────────────────────────────────────────────
  await sendTextMessage(phoneNumber, finalResponse)
}

async function handleAdminWhatsAppCommand(
  supabase: ReturnType<typeof getSupabaseClient>,
  phoneNumber: string,
  message: string,
): Promise<TemplateResult | null> {
  const lower = normalizeDoctorMatchText(message)
  if (!lower) return null

  const looksLikeAdmin = isAdminInstruction(lower)
  const isAdmin = isAuthorizedAdminPhone(phoneNumber)

  if (!looksLikeAdmin) {
    if (!isAdmin || !isAdminHelpIntent(lower)) return null
    return {
      label: 'admin_help',
      sentiment: 'neutral',
      response: buildAdminHelpResponse(),
    }
  }

  if (!isAdmin) {
    return {
      label: 'admin_rejected',
      sentiment: 'neutral',
      response: 'I can only share admin reports or send patient reminders for authorised Serenity Royale Hospital staff. For patient support, reply "Book an appointment" or call +234 806 219 7384.',
    }
  }

  if (isAdminHelpIntent(lower)) {
    return {
      label: 'admin_help',
      sentiment: 'neutral',
      response: buildAdminHelpResponse(),
    }
  }

  if (matchesAny(lower, ['emergency summary', 'urgent summary', 'open emergencies', 'open urgent', 'crisis summary'])) {
    return {
      label: 'admin_emergency_summary',
      sentiment: 'neutral',
      response: await buildEmergencySummary(supabase),
    }
  }

  if (matchesAny(lower, ['remind', 'send reminder', 'follow up', 'followup'])) {
    const range = parseAdminDateRange(lower)
    return {
      label: `admin_reminders_${range.reminderType}`,
      sentiment: 'neutral',
      response: await sendAdminRequestedReminders(supabase, range),
    }
  }

  if (matchesAny(lower, ['booked today', 'booking today', 'bookings today', 'booked for today', 'patients that booked today', 'patients booked today'])) {
    return {
      label: 'admin_bookings_today',
      sentiment: 'neutral',
      response: await buildBookingsCreatedSummary(supabase, 'today'),
    }
  }

  if (matchesAny(lower, ['appointment summary', 'appointments today', 'appointments tomorrow', 'appointments next week', 'appointments next month', 'patients due', 'schedule today', 'schedule tomorrow'])) {
    const range = parseAdminDateRange(lower)
    return {
      label: 'admin_appointment_summary',
      sentiment: 'neutral',
      response: await buildAppointmentRangeSummary(supabase, range),
    }
  }

  if (matchesAny(lower, ['daily summary', 'today summary', 'summary today', 'operations summary'])) {
    const [bookings, emergencies] = await Promise.all([
      buildBookingsCreatedSummary(supabase, 'today'),
      buildEmergencySummary(supabase),
    ])
    return {
      label: 'admin_daily_summary',
      sentiment: 'neutral',
      response: `${bookings}\n\n${emergencies.replace(/^Yes boss\\.\\s*/, '')}`,
    }
  }

  return {
    label: 'admin_help',
    sentiment: 'neutral',
    response: buildAdminHelpResponse(),
  }
}

function isAdminInstruction(message: string): boolean {
  return matchesAny(message, [
    'admin',
    'booked today',
    'bookings today',
    'appointment summary',
    'appointments today',
    'appointments tomorrow',
    'appointments next week',
    'appointments next month',
    'patients due',
    'remind all patients',
    'send reminder',
    'follow up patients',
    'patient follow up',
    'follow up reminder',
    'followup reminder',
    'open emergencies',
    'emergency summary',
    'urgent summary',
    'operations summary',
    'daily summary',
  ])
}

function isAdminHelpIntent(message: string): boolean {
  return matchesAny(message, ['admin help', 'boss help', 'what can you do', 'commands', 'command list'])
}

function buildAdminHelpResponse(): string {
  return `Yes boss. I can help with Serenity operations on WhatsApp.

Try:
• "Summary of bookings today"
• "Appointments tomorrow"
• "Appointments next week"
• "Remind patients tomorrow"
• "Remind patients next week"
• "Emergency summary"

For safety, I only accept these admin commands from Dr K and the operations secretary.`
}

function isAuthorizedAdminPhone(phoneNumber: string): boolean {
  const configured = [
    Deno.env.get('PRIMARY_DOCTOR_WHATSAPP') ?? '+2348062197384',
    Deno.env.get('OPERATIONS_MANAGER_WHATSAPP') ?? '+2348072023652',
    Deno.env.get('HOSPITAL_MD_WHATSAPP'),
    Deno.env.get('HOSPITAL_MD_PHONE'),
    Deno.env.get('STAFF_BOOKING_WHATSAPP_TO'),
    ...(Deno.env.get('ADMIN_COMMAND_WHATSAPP_NUMBERS') ?? '').split(','),
  ]
    .filter((phone): phone is string => Boolean(phone?.trim()))
    .map(normalizePhoneDigits)

  const inbound = normalizePhoneDigits(phoneNumber)
  return configured.some((phone) => phone === inbound)
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

function parseAdminDateRange(message: string): AdminDateRange {
  const today = todayInLagos()

  if (message.includes('next month') || message.includes('month')) {
    const start = addDays(today, 1)
    const end = addDays(today, 30)
    return {
      label: 'next 30 days',
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      reminderType: 'early',
    }
  }

  if (message.includes('next week') || message.includes('one week') || message.includes('1 week')) {
    const target = addDays(today, 7)
    return {
      label: 'one week from today',
      startDate: toIsoDate(target),
      endDate: toIsoDate(target),
      reminderType: '1week',
    }
  }

  if (message.includes('tomorrow') || message.includes('24h') || message.includes('24 hour')) {
    const target = addDays(today, 1)
    return {
      label: 'tomorrow',
      startDate: toIsoDate(target),
      endDate: toIsoDate(target),
      reminderType: '24h',
    }
  }

  return {
    label: 'today',
    startDate: toIsoDate(today),
    endDate: toIsoDate(today),
    reminderType: '24h',
  }
}

async function buildAppointmentRangeSummary(
  supabase: ReturnType<typeof getSupabaseClient>,
  range: AdminDateRange,
): Promise<string> {
  const appointments = await getAppointmentsByDateRange(supabase, range, { includeCancelled: false })

  if (appointments.length === 0) {
    return `Yes boss. I found no active appointments for ${range.label}.`
  }

  return `Yes boss. I found ${appointments.length} active appointment${appointments.length === 1 ? '' : 's'} for ${range.label}.\n\n${formatAdminAppointmentList(appointments)}`
}

async function buildBookingsCreatedSummary(
  supabase: ReturnType<typeof getSupabaseClient>,
  label: string,
): Promise<string> {
  const range = getLagosCreatedAtRange(0)
  const { data } = await supabase
    .from('appointments')
    .select('id, appointment_date, appointment_time, center, service_type, status, created_at, patients(name, phone_number), doctors(name)')
    .gte('created_at', range.startIso)
    .lt('created_at', range.endIso)
    .order('created_at', { ascending: false })
    .limit(25)

  const appointments = (data ?? []) as AdminAppointmentRow[]

  if (appointments.length === 0) {
    return `Yes boss. No appointment bookings have been created ${label}.`
  }

  return `Yes boss. ${appointments.length} appointment booking${appointments.length === 1 ? '' : 's'} created ${label}.\n\n${formatAdminAppointmentList(appointments)}`
}

async function buildEmergencySummary(supabase: ReturnType<typeof getSupabaseClient>): Promise<string> {
  const { data } = await supabase
    .from('emergency_alerts')
    .select('id, alert_type, severity, created_at, patients(name, phone_number)')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(10)

  if (!data || data.length === 0) {
    return 'Yes boss. There are no open urgent alerts right now.'
  }

  const rows = data.map((alert, index) => {
    const patient = alert.patients as { name?: string | null; phone_number?: string | null } | null
    return `${index + 1}. ${patient?.name ?? 'Unknown patient'} - ${alert.severity ?? 'urgent'} ${String(alert.alert_type ?? 'alert').replace(/_/g, ' ')}. Phone: ${patient?.phone_number ?? 'Not provided'}`
  })

  return `Yes boss. There ${data.length === 1 ? 'is' : 'are'} ${data.length} open urgent alert${data.length === 1 ? '' : 's'}.\n\n${rows.join('\n')}`
}

async function sendAdminRequestedReminders(
  supabase: ReturnType<typeof getSupabaseClient>,
  range: AdminDateRange,
): Promise<string> {
  const appointments = await getAppointmentsByDateRange(supabase, range, {
    includeCancelled: false,
    status: 'confirmed',
  })

  if (appointments.length === 0) {
    return `Yes boss. I found no confirmed appointments needing reminders for ${range.label}.`
  }

  const results = { sent: 0, skipped: 0, failed: 0 }

  for (const appointment of appointments) {
    const patient = appointment.patients
    const doctor = appointment.doctors
    const phone = patient?.phone_number

    if (!phone) {
      results.skipped++
      continue
    }

    if (range.reminderType === '24h' && appointment.reminder_24h_sent) {
      results.skipped++
      continue
    }

    if (range.reminderType === '1week' && appointment.reminder_1week_sent) {
      results.skipped++
      continue
    }

    try {
      const formattedDate = formatDisplayDate(appointment.appointment_date)
      const time = appointment.appointment_time?.slice(0, 5) ?? '09:00'
      const center = appointment.center ?? 'Galadimawa'

      if (range.reminderType === '24h') {
        await sendAppointmentReminder24h(phone, patient?.name ?? 'Patient', formattedDate, time, center)
        await supabase.from('appointments').update({ reminder_24h_sent: true }).eq('id', appointment.id)
      } else if (range.reminderType === '1week') {
        await sendAppointmentReminder1Week(phone, patient?.name ?? 'Patient', formattedDate, time, center, doctor?.name ?? 'Serenity doctor')
        await supabase.from('appointments').update({ reminder_1week_sent: true }).eq('id', appointment.id)
      } else {
        await sendTextMessage(
          phone,
          `Dear ${patient?.name ?? 'Patient'}, this is an early reminder for your upcoming Serenity Royale Hospital appointment.\n\nDate: ${formattedDate}\nTime: ${time}\nCenter: ${center}\nDoctor: ${doctor?.name ?? 'Serenity doctor'}\n\nTo reschedule, reply here or call +234 806 219 7384.`,
        )
      }

      results.sent++
    } catch (err) {
      console.error(`[ai-assistant] Admin requested reminder failed for ${appointment.id}:`, (err as Error).message)
      results.failed++
    }
  }

  return `Yes boss. Reminder run for ${range.label} is complete.

Sent: ${results.sent}
Skipped: ${results.skipped}
Failed: ${results.failed}

${results.failed > 0 ? 'Some reminders failed. Please check the dashboard notification status or Twilio limits.' : 'All eligible reminders were handled.'}`
}

async function getAppointmentsByDateRange(
  supabase: ReturnType<typeof getSupabaseClient>,
  range: AdminDateRange,
  options: { includeCancelled?: boolean; status?: string } = {},
): Promise<AdminAppointmentRow[]> {
  let query = supabase
    .from('appointments')
    .select('id, appointment_date, appointment_time, center, service_type, status, created_at, reminder_1week_sent, reminder_24h_sent, patients(name, phone_number, email), doctors(name)')
    .gte('appointment_date', range.startDate)
    .lte('appointment_date', range.endDate)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true })
    .limit(50)

  if (!options.includeCancelled) query = query.neq('status', 'cancelled')
  if (options.status) query = query.eq('status', options.status)

  const { data } = await query
  return (data ?? []) as AdminAppointmentRow[]
}

function formatAdminAppointmentList(appointments: AdminAppointmentRow[]): string {
  const rows = appointments.slice(0, 12).map((appointment, index) => {
    const patient = appointment.patients
    const doctor = appointment.doctors
    return `${index + 1}. ${patient?.name ?? 'Unknown patient'} - ${appointment.service_type ?? 'Consultation'} on ${formatDisplayDate(appointment.appointment_date)} at ${appointment.appointment_time?.slice(0, 5) ?? '--:--'} (${appointment.center ?? 'Center not set'}). Doctor: ${doctor?.name ?? 'Not assigned'}. Status: ${appointmentStatusForAdmin(appointment.status)}. Phone: ${patient?.phone_number ?? 'Not provided'}`
  })

  if (appointments.length > 12) {
    rows.push(`...and ${appointments.length - 12} more in the dashboard.`)
  }

  return rows.join('\n')
}

function appointmentStatusForAdmin(status: string): string {
  switch (status) {
    case 'pending':
      return 'Needs secretary confirmation'
    case 'confirmed':
      return 'Confirmed'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    case 'no_show':
      return 'No-show'
    case 'rescheduled':
      return 'Rescheduled'
    default:
      return status
  }
}

function getLagosCreatedAtRange(offsetDays: number): { startIso: string; endIso: string } {
  const lagosDate = addDays(todayInLagos(), offsetDays)
  const startUtc = new Date(lagosDate.getTime() - 60 * 60 * 1000)
  const endUtc = new Date(startUtc.getTime() + 24 * 3600000)
  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() }
}

async function loadPatientMemoryContext(
  supabase: ReturnType<typeof getSupabaseClient>,
  patient: PatientContext,
): Promise<PatientMemoryContext> {
  const today = toIsoDate(todayInLagos())

  const { data: upcomingAppointments } = await supabase
    .from('appointments')
    .select('id, appointment_date, appointment_time, center, service_type, reason, status, created_at, created_from_whatsapp, doctors(name)')
    .eq('patient_id', patient.id)
    .in('status', ['pending', 'confirmed', 'rescheduled'])
    .gte('appointment_date', today)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true })
    .limit(1)

  let latestAppointment = (upcomingAppointments?.[0] ?? null) as AppointmentMemoryRow | null

  if (!latestAppointment) {
    const { data: latestAppointments } = await supabase
      .from('appointments')
      .select('id, appointment_date, appointment_time, center, service_type, reason, status, created_at, created_from_whatsapp, doctors(name)')
      .eq('patient_id', patient.id)
      .order('appointment_date', { ascending: false })
      .order('appointment_time', { ascending: false })
      .limit(1)

    latestAppointment = (latestAppointments?.[0] ?? null) as AppointmentMemoryRow | null
  }

  const { data: latestCompletedBooking } = await supabase
    .from('booking_sessions')
    .select('*')
    .eq('patient_id', patient.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const { data: unresolvedEmergency } = await supabase
    .from('emergency_alerts')
    .select('id, alert_type, severity, created_at')
    .eq('patient_id', patient.id)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const recentConversation = await getConversationHistory(supabase, patient.id, 8)

  return {
    patient,
    latestAppointment,
    latestCompletedBooking: latestCompletedBooking as BookingSessionRow | null,
    recentConversation,
    unresolvedEmergency: unresolvedEmergency as EmergencyMemoryRow | null,
  }
}

async function handleReturningPatientMemory(
  supabase: ReturnType<typeof getSupabaseClient>,
  context: PatientMemoryContext,
  message: string,
): Promise<TemplateResult | null> {
  const lower = normalizeDoctorMatchText(message)
  if (!lower) return null

  const appointment = context.latestAppointment
  const hasActiveAppointment = appointment ? isActiveAppointmentStatus(appointment.status) : false

  if (hasActiveAppointment && appointment && wasLastAssistantReschedulePrompt(context)) {
    const parsedDate = parseAppointmentDate(message)
    const parsedTime = parseAppointmentTime(message)
    if (parsedDate.error || parsedTime.error) {
      return {
        label: 'appointment_reschedule_retry',
        sentiment: 'neutral',
        response: `Please send both the new date and time in one message. For example: "Monday 10am" or "2026-06-17 14:30".\n\nYour current appointment is still saved until the secretary confirms a change.`,
      }
    }

    const { error } = await supabase
      .from('appointments')
      .update({
        appointment_date: parsedDate.value,
        appointment_time: parsedTime.value,
        status: 'pending',
        calendar_sync_status: 'pending_reschedule_review',
        reason: `${appointment.reason ?? 'Appointment'} | Patient requested reschedule via WhatsApp`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointment.id)
      .in('status', ['pending', 'confirmed', 'rescheduled'])

    if (error) throw new Error(`Failed to request reschedule for appointment ${appointment.id}: ${error.message}`)

    return {
      label: 'appointment_reschedule_saved',
      sentiment: 'neutral',
      response: `Your reschedule request has been saved for secretary confirmation.\n\nService: ${appointment.service_type ?? 'Consultation'}\nNew date: ${formatDisplayDate(parsedDate.value!)}\nNew time: ${parsedTime.value!.slice(0, 5)}\nCenter: ${appointment.center ?? 'Not selected'}\nDoctor: ${getAppointmentDoctorName(appointment) ?? 'Doctor not assigned yet'}\n\nOur team will confirm the final slot shortly.`,
    }
  }

  if (hasActiveAppointment && (isCancelAppointmentConfirmation(lower) || (isSimpleYes(lower) && wasLastAssistantCancelPrompt(context)))) {
    const { error } = await supabase
      .from('appointments')
      .update({
        status: 'cancelled',
        cancellation_reason: 'Cancelled by patient via WhatsApp',
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointment!.id)
      .in('status', ['pending', 'confirmed', 'rescheduled'])

    if (error) throw new Error(`Failed to cancel appointment ${appointment!.id}: ${error.message}`)

    return {
      label: 'appointment_cancel_confirmed',
      sentiment: 'neutral',
      response: `Your appointment has been cancelled.\n\n${formatAppointmentForPatient(appointment!, { includeStatus: false })}\n\nIf you need a new appointment, reply "Book an appointment" and I will help you start again.`,
    }
  }

  if (isCancelAppointmentIntent(lower)) {
    if (!hasActiveAppointment || !appointment) {
      return {
        label: 'appointment_cancel_no_active',
        sentiment: 'neutral',
        response: `I do not see an active appointment for you right now.\n\nIf you want to book one, reply "Book an appointment". For urgent help, call +234 806 219 7384.`,
      }
    }

    return {
      label: 'appointment_cancel_request',
      sentiment: 'neutral',
      response: `I can help cancel this appointment:\n\n${formatAppointmentForPatient(appointment)}\n\nPlease reply "YES CANCEL" to confirm, or "KEEP APPOINTMENT" to leave it unchanged.`,
    }
  }

  if (isKeepAppointmentIntent(lower) && hasActiveAppointment && appointment) {
    return {
      label: 'appointment_keep',
      sentiment: 'neutral',
      response: `No problem. Your appointment is still saved.\n\n${formatAppointmentForPatient(appointment)}\n\nIf you need to change it, reply "Reschedule appointment".`,
    }
  }

  if (hasActiveAppointment && isRescheduleIntent(lower) && appointment) {
    return {
      label: 'appointment_reschedule_request',
      sentiment: 'neutral',
      response: `I can help you request a change. Your current appointment is:\n\n${formatAppointmentForPatient(appointment)}\n\nPlease send your preferred new date and time. The secretary will review availability and confirm the final slot.`,
    }
  }

  if (isDoctorStatusIntent(lower)) {
    if (!appointment) {
      return {
        label: 'doctor_status_no_appointment',
        sentiment: 'neutral',
        response: `I do not see an appointment on your record yet. If you want to see a Serenity doctor, reply "Book an appointment".`,
      }
    }

    const doctorName = getAppointmentDoctorName(appointment)
    return {
      label: 'doctor_status',
      sentiment: 'neutral',
      response: doctorName
        ? `Your doctor is ${doctorName}.\n\n${formatAppointmentForPatient(appointment)}`
        : `A doctor has not been assigned yet. Your request is saved for secretary review.\n\n${formatAppointmentForPatient(appointment)}`,
    }
  }

  if (hasActiveAppointment && isBookAppointmentIntentWithExistingAppointment(lower) && appointment) {
    return {
      label: 'booking_intent_existing_appointment',
      sentiment: 'neutral',
      response: `Welcome back${context.patient.name ? `, ${firstName(context.patient.name)}` : ''}. I can see you already have an appointment request:\n\n${formatAppointmentForPatient(appointment)}\n\nReply "CHANGE APPOINTMENT" to update this request, or "START NEW BOOKING" if you want to book a separate appointment.`,
    }
  }

  if (isAppointmentStatusIntent(lower) || (isSimpleGreeting(lower) && hasActiveAppointment && appointment)) {
    return {
      label: 'appointment_status',
      sentiment: 'neutral',
      response: `Welcome back${context.patient.name ? `, ${firstName(context.patient.name)}` : ''}.\n\n${formatAppointmentForPatient(appointment!)}\n\nYou can reply "Cancel appointment", "Reschedule appointment", "Who is my doctor?", or "Speak to the team".`,
    }
  }

  if (isSpeakToTeamIntent(lower)) {
    return {
      label: 'speak_to_team',
      sentiment: 'neutral',
      response: `You can speak with Serenity Royale Hospital directly on +234 806 219 7384 or +234 811 689 1990.\n\nIf this is urgent, please call now. If you want an appointment, reply "Book an appointment".`,
    }
  }

  if (isSimpleGreeting(lower) && isKnownPatient(context.patient) && !appointment) {
    return {
      label: 'returning_patient_no_appointment',
      sentiment: 'positive',
      response: `Welcome back${context.patient.name ? `, ${firstName(context.patient.name)}` : ''}. I do not see an active appointment request for you right now.\n\nHow can I help today?\n\n• Book an appointment\n• Ask about our services\n• Learn about costs\n• Get emergency support`,
    }
  }

  return null
}

function buildPatientMemoryPrompt(context: PatientMemoryContext): AIMessage | null {
  if (!isKnownPatient(context.patient) && !context.latestAppointment && !context.unresolvedEmergency) return null

  const appointmentSummary = context.latestAppointment
    ? formatAppointmentForPatient(context.latestAppointment)
    : 'No appointment found.'
  const emergencySummary = context.unresolvedEmergency
    ? `${context.unresolvedEmergency.severity ?? 'Urgent'} ${context.unresolvedEmergency.alert_type ?? 'alert'} opened ${context.unresolvedEmergency.created_at}.`
    : 'No unresolved emergency alert.'

  return {
    role: 'system',
    content: `Patient context from Serenity database. Use only these verified facts; do not invent appointment details or doctor assignment.
Patient: ${context.patient.name ?? 'Unknown'} (${context.patient.phone_number ?? 'phone not available'})
Email: ${context.patient.email ?? 'Not provided'}
Gender: ${context.patient.gender ?? 'Not provided'}
Location: ${context.patient.location ?? 'Not provided'}
Consent: ${context.patient.consent_ndpr ? 'Recorded' : 'Not recorded'}
Latest appointment: ${appointmentSummary}
Emergency status: ${emergencySummary}`,
  }
}

function formatAppointmentForPatient(
  appointment: AppointmentMemoryRow,
  options: { includeStatus?: boolean } = {},
): string {
  const includeStatus = options.includeStatus ?? true
  const status = appointmentStatusForPatient(appointment.status)
  const doctorName = getAppointmentDoctorName(appointment) ?? 'Doctor not assigned yet'
  const date = appointment.appointment_date ? formatDisplayDate(appointment.appointment_date) : 'Date not set'
  const time = appointment.appointment_time?.slice(0, 5) ?? 'Time not set'
  const lines = [
    includeStatus ? `Status: ${status}` : null,
    `Service: ${appointment.service_type ?? 'Consultation'}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Center: ${appointment.center ?? 'Not selected'}`,
    `Doctor: ${doctorName}`,
  ]

  return lines.filter(Boolean).join('\n')
}

function appointmentStatusForPatient(status: AppointmentMemoryRow['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending secretary confirmation'
    case 'confirmed':
      return 'Confirmed'
    case 'rescheduled':
      return 'Rescheduled'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    case 'no_show':
      return 'Missed appointment'
    default:
      return 'Saved'
  }
}

function getAppointmentDoctorName(appointment: AppointmentMemoryRow): string | null {
  return appointment.doctors?.name ?? null
}

function isActiveAppointmentStatus(status: AppointmentMemoryRow['status']): boolean {
  return ['pending', 'confirmed', 'rescheduled'].includes(status)
}

function isKnownPatient(patient: PatientContext): boolean {
  return Boolean(patient.name || patient.email || patient.gender || patient.location)
}

function firstName(name: string): string {
  return normalizeWhitespace(name).split(' ')[0] ?? name
}

function isSimpleGreeting(message: string): boolean {
  return ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'].includes(message)
}

function isAppointmentStatusIntent(message: string): boolean {
  return matchesAny(message, [
    'my appointment',
    'appointment status',
    'did you book',
    'is it booked',
    'do i have appointment',
    'do i have an appointment',
    'when is my appointment',
    'what about my appointment',
    'confirm my appointment',
  ])
}

function isBookAppointmentIntentWithExistingAppointment(message: string): boolean {
  return matchesAny(message, ['book appointment', 'book an appointment', 'schedule appointment', 'see a doctor', 'book another appointment'])
}

function isCancelAppointmentIntent(message: string): boolean {
  return matchesAny(message, ['cancel appointment', 'cancel my appointment', 'cancel it', 'cancel booking'])
}

function isCancelAppointmentConfirmation(message: string): boolean {
  return ['yes cancel', 'confirm cancel', 'confirm cancel appointment', 'cancel it yes', 'yes cancel appointment'].some((phrase) => message.includes(phrase))
}

function isSimpleYes(message: string): boolean {
  return ['yes', 'y', 'confirm', 'ok', 'okay', 'proceed'].includes(message)
}

function wasLastAssistantCancelPrompt(context: PatientMemoryContext): boolean {
  const lastAssistantMessage = [...context.recentConversation].reverse().find((turn) => turn.role === 'assistant')
  return Boolean(lastAssistantMessage?.content.toLowerCase().includes('yes cancel'))
}

function wasLastAssistantReschedulePrompt(context: PatientMemoryContext): boolean {
  const lastAssistantMessage = [...context.recentConversation].reverse().find((turn) => turn.role === 'assistant')
  return Boolean(lastAssistantMessage?.content.toLowerCase().includes('preferred new date and time'))
}

function isKeepAppointmentIntent(message: string): boolean {
  return matchesAny(message, ['keep appointment', 'dont cancel', 'do not cancel', 'leave it', 'keep it'])
}

function isRescheduleIntent(message: string): boolean {
  return matchesAny(message, ['reschedule', 'change appointment', 'change my appointment', 'move appointment', 'move my appointment'])
}

function isDoctorStatusIntent(message: string): boolean {
  return matchesAny(message, ['who is my doctor', 'which doctor', 'doctor assigned', 'assigned doctor', 'my doctor'])
}

function isSpeakToTeamIntent(message: string): boolean {
  return matchesAny(message, ['speak to team', 'talk to staff', 'talk to human', 'speak to someone', 'call me', 'human'])
}

/**
 * Check if the patient's message is a reply to a feedback request.
 * If yes: save the rating/text to appointment_feedback, send thanks, return true.
 * If no: return false (caller continues to normal AI flow).
 */
async function detectAndHandleFeedbackReply(
  supabase: ReturnType<typeof getSupabaseClient>,
  patientId: string,
  phoneNumber: string,
  messageText: string,
  whatsappMessageId: string,
): Promise<boolean> {
  // Look for a completed appointment in last 3 days with no feedback yet
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600000).toISOString().split('T')[0]

  const { data: recentAppointment } = await supabase
    .from('appointments')
    .select('id, service_type')
    .eq('patient_id', patientId)
    .eq('status', 'completed')
    .gte('appointment_date', threeDaysAgo)
    .order('appointment_date', { ascending: false })
    .limit(1)
    .single()

  if (!recentAppointment) return false

  // Check no feedback already given
  const { data: existingFeedback } = await supabase
    .from('appointment_feedback')
    .select('id')
    .eq('appointment_id', recentAppointment.id)
    .single()

  if (existingFeedback) return false

  // Try to parse rating from message
  const rating = parseFeedbackRating(messageText)
  if (rating === null && messageText.trim().length < 3) return false // Too short and no rating — not a feedback reply

  // If message is a numeric rating OR has feedback-like keywords, treat as feedback
  const feedbackKeywords = ['excellent', 'good', 'great', 'amazing', 'bad', 'poor', 'okay', 'average', 'satisfied', 'happy', 'love', 'helpful', 'wonderful', 'terrible', 'awesome']
  const lower = messageText.toLowerCase()
  const looksLikeFeedback = rating !== null || feedbackKeywords.some((kw) => lower.includes(kw))

  if (!looksLikeFeedback) return false

  // Save feedback
  await supabase.from('appointment_feedback').insert({
    appointment_id: recentAppointment.id,
    patient_id: patientId,
    rating: rating,
    feedback_text: messageText,
  })

  // Save the conversation record
  await saveConversation(supabase, {
    patientId,
    messageType: 'text',
    patientMessage: messageText,
    patientMessageRedacted: messageText,
    aiResponse: null,
    mediaUrl: null,
    sentiment: rating !== null && rating >= 4 ? 'positive' : rating !== null && rating <= 2 ? 'distressed' : 'neutral',
    hasEmergencyKeywords: false,
    whatsappMessageId,
    transcription: null,
    transcriptionRedacted: null,
  })

  // Send thank-you
  const thankYou = rating !== null && rating >= 4
    ? `Thank you so much for your ${rating}-star rating! 🌟 We're delighted you had a positive experience at Serenity Royale Hospital. Your wellbeing is our priority. Feel free to reach out anytime.`
    : rating !== null && rating <= 2
    ? `Thank you for your honest feedback. We're sorry your experience didn't meet expectations. Please call us at +234 806 219 7384 so we can address your concerns directly.`
    : `Thank you for sharing your experience with us! 💚 Your feedback helps us improve our care at Serenity Royale Hospital.`

  await sendTextMessage(phoneNumber, thankYou)

  console.log(`[ai-assistant] Feedback saved for appointment ${recentAppointment.id}: rating=${rating ?? 'text-only'}`)
  return true
}

function getHybridTemplateResponse(message: string): TemplateResult | null {
  const lower = normalizeWhitespace(message).toLowerCase()
  if (!lower) return null

  if (matchesAny(lower, ['privacy', 'data', 'ndpr', 'consent', 'delete my data', 'remove my data', 'export my data'])) {
    return {
      label: 'privacy',
      sentiment: 'neutral',
      response: `Serenity Royale Hospital uses your information only to provide healthcare support, manage appointments, keep conversation history, and contact you when needed for care.

Your information is handled in line with Nigeria's NDPR/NDPA data protection expectations. You can ask our team about your records, correction, export, or deletion requests.

For privacy requests, contact info@serenityroyalehospital.com or call +234 806 219 7384.`,
    }
  }

  if (matchesAny(lower, ['cost', 'price', 'fee', 'fees', 'how much', 'charges', 'bill', 'billing'])) {
    return {
      label: 'costs',
      sentiment: 'neutral',
      response: `Here are the standard Serenity Royale Hospital costs available to me:

Registration: ₦30,000
Toxicology and profiling for substance-abuse care: ₦20,000

Monthly care costs vary by center, service, and patient needs. For the current rate, please call +234 806 219 7384 or ask here and I can help you book an appointment.`,
    }
  }

  if (matchesAny(lower, ['hour', 'open', 'close', 'sunday', 'weekend', 'location', 'address', 'where are you', 'contact', 'phone', 'email'])) {
    return {
      label: 'hours_locations_contact',
      sentiment: 'neutral',
      response: `Serenity Royale Hospital has two Abuja centers:

Galadimawa: No. 10 Royal Homes Estate, Galadinmawa, Abuja
Karu: No. 11 Ali Amodu Close, behind CBN Quarters, Karu, Abuja

Outpatient hours: 8:00am to 4:00pm, Monday to Saturday.
Emergency support: 24/7.

Phone: +234 806 219 7384 or +234 811 689 1990
Email: info@serenityroyalehospital.com`,
    }
  }

  if (matchesAny(lower, ['service', 'services', 'what do you do', 'treat', 'treatment', 'rehab', 'psychiatry', 'neurology', 'physiotherapy', 'eeg', 'dual diagnosis'])) {
    return {
      label: 'services',
      sentiment: 'positive',
      response: `Serenity Royale Hospital provides:

- Psychological Medicine and Psychiatry
- Drug Abuse Treatment and Rehabilitation
- Dual diagnosis support
- Neurology
- Encephalography (EEG)
- Physiotherapy
- General Medical Practice
- Consultancy Services

If you want to see a clinician, reply "Book an appointment" and I will collect the details step by step.`,
    }
  }

  if (matchesAny(lower, ['diagnose', 'diagnosis', 'prescribe', 'prescription', 'dosage', 'dose', 'drug should i take', 'medication should i take', 'can i take', 'symptoms mean'])) {
    return {
      label: 'medical_safety',
      sentiment: 'neutral',
      response: `I can share general guidance, but I cannot diagnose you, prescribe medication, or recommend a dosage over WhatsApp.

For symptoms, medication questions, or a possible diagnosis, please speak with a Serenity clinician. Reply "Book an appointment" and I can help set that up. If symptoms are severe or urgent, call +234 806 219 7384 now or go to the nearest emergency department.`,
    }
  }

  if (matchesAny(lower, ['cancel appointment', 'reschedule', 'change my appointment', 'move my appointment'])) {
    return {
      label: 'appointment_change',
      sentiment: 'neutral',
      response: `I can help with appointment changes. Please send the patient name, appointment date, and the new preferred date/time.

For urgent changes, call +234 806 219 7384. If you want a new appointment instead, reply "Book an appointment".`,
    }
  }

  return null
}

function matchesAny(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword))
}

function isBookingIntent(message: string): boolean {
  const lower = message.toLowerCase()
  return ['book', 'appointment', 'schedule', 'see a doctor', 'visit', 'consultation', 'reserve'].some((kw) => lower.includes(kw))
}

async function startBookingSession(
  supabase: ReturnType<typeof getSupabaseClient>,
  patientId: string,
  phoneNumber: string,
): Promise<string> {
  await supabase.from('booking_sessions')
    .update({ status: 'abandoned', abandoned_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
    .eq('patient_id', patientId)
    .eq('status', 'active')

  const { error } = await supabase.from('booking_sessions').insert({
    patient_id: patientId,
    patient_phone: phoneNumber,
    status: 'active',
    current_step: BOOKING_STEPS.NAME,
    last_message_at: new Date().toISOString(),
  })

  if (error) throw new Error(`Failed to start booking session: ${error.message}`)
  return FIRST_BOOKING_PROMPT
}

async function handleBookingSession(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: BookingSessionRow,
  userMessage: string,
  phoneNumber: string,
  patient: Pick<PatientRow, 'id' | 'name'> & { email?: string },
): Promise<BookingResult> {
  const msg = userMessage.trim()

  if (isCancelBooking(msg)) {
    await updateBookingSession(supabase, session.id, { status: 'abandoned', abandoned_at: new Date().toISOString() })
    return {
      response: "No problem. I have cancelled this booking request. Send 'Book an appointment' anytime you want to start again.",
      sentiment: 'neutral',
    }
  }

  switch (session.current_step) {
    case BOOKING_STEPS.NAME: {
      const parsed = parseFullName(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_name: parsed.value, current_step: BOOKING_STEPS.SEX })
      return { response: `Thanks, ${parsed.value!.split(' ')[0]}. What is your sex/gender? Reply Male, Female, or Prefer not to say.`, sentiment: 'neutral' }
    }
    case BOOKING_STEPS.SEX: {
      const parsed = parseSex(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_sex: parsed.value, current_step: BOOKING_STEPS.LOCATION })
      return { response: 'What area are you contacting us from? For example: Garki, Karu, Lagos, or outside Abuja.', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.LOCATION: {
      const parsed = parseLocation(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_location: parsed.value, current_step: BOOKING_STEPS.SERVICE_TYPE })
      return { response: getServicePrompt(), sentiment: 'neutral' }
    }
    case BOOKING_STEPS.SERVICE_TYPE: {
      const parsed = parseServiceType(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_service_type: parsed.value, current_step: BOOKING_STEPS.DOCTOR })
      return { response: 'Do you prefer a specific doctor? You can reply with a doctor name or say "any available doctor".', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.DOCTOR: {
      const parsed = parseDoctorPreference(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_doctor_preference: parsed.value, current_step: BOOKING_STEPS.DATE })
      return { response: 'What date would you prefer? Please use YYYY-MM-DD, DD/MM/YYYY, "tomorrow", "next week", or a weekday like Monday. Outpatient appointments are Monday to Saturday.', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.DATE: {
      const parsed = parseAppointmentDate(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_date: parsed.value, current_step: BOOKING_STEPS.TIME })
      return { response: 'What time would you prefer? Outpatient hours are 8:00am to 4:00pm. For example: 10am or 14:30.', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.TIME: {
      const parsed = parseAppointmentTime(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_time: parsed.value, current_step: BOOKING_STEPS.CENTER })
      return { response: 'Which center do you prefer: Karu or Galadimawa?', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.CENTER: {
      const parsed = parseCenter(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_center: parsed.value, current_step: BOOKING_STEPS.EMAIL })
      return { response: 'What email should we send confirmation to? Reply SKIP if none.', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.EMAIL: {
      const parsed = parseOptionalEmail(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      const nextSession = { ...session, collected_email: parsed.value }
      await updateBookingSession(supabase, session.id, { collected_email: parsed.value, current_step: BOOKING_STEPS.CONFIRM })
      return { response: buildBookingSummary(nextSession), sentiment: 'neutral' }
    }
    case BOOKING_STEPS.CONFIRM: {
      const confirmed = parseConfirmation(msg)
      if (confirmed === null) {
        return { response: `${buildBookingSummary(session)}\n\nPlease reply YES to submit this appointment request or NO to cancel.`, sentiment: 'neutral' }
      }
      if (!confirmed) {
        await updateBookingSession(supabase, session.id, { status: 'abandoned', abandoned_at: new Date().toISOString() })
        return { response: "No problem. I have cancelled this booking request. Send 'Book an appointment' anytime you want to start again.", sentiment: 'neutral' }
      }

      const response = await finalizeBooking(supabase, session, phoneNumber, patient)
      await updateBookingSession(supabase, session.id, { status: 'completed', completed_at: new Date().toISOString() })
      return { response, sentiment: 'positive' }
    }
    default:
      await updateBookingSession(supabase, session.id, { current_step: BOOKING_STEPS.NAME })
      return { response: FIRST_BOOKING_PROMPT, sentiment: 'neutral' }
  }
}

/**
 * Create appointment in DB + Google Calendar. Supabase remains source of truth.
 */
async function finalizeBooking(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: BookingSessionRow,
  phoneNumber: string,
  patient: Pick<PatientRow, 'id' | 'name'> & { email?: string },
): Promise<string> {
  const doctor = await findPreferredDoctor(supabase, session.collected_doctor_preference)
  const appointmentDate = session.collected_date ?? new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0]
  const appointmentTime = session.collected_time ?? '09:00'
  const center = normalizeCenter(session.collected_center ?? 'Galadimawa')
  const patientName = session.collected_name ?? patient.name ?? 'Patient'
  const patientEmail = session.collected_email
  const serviceType = normalizeServiceType(session.collected_service_type)
  const doctorName = doctor?.name ?? 'To be assigned'
  const formattedDate = formatDisplayDate(appointmentDate)
  const doctorCenterMismatch = Boolean(doctor?.location && !doctorServesCenter(doctor.location, center))
  const hasConflict = doctor?.id
    ? await hasDoctorSlotConflict(supabase, doctor.id, appointmentDate, appointmentTime)
    : false

  let calendarEventId: string | null = null
  let status: 'pending' | 'confirmed' = 'pending'
  let calendarStatus = 'not_checked'
  let calendarError: string | null = null

  if (!doctor?.id) {
    calendarStatus = 'pending_no_matched_doctor'
  } else if (doctorCenterMismatch) {
    calendarStatus = 'pending_doctor_center_mismatch'
    calendarError = `${doctor.name} is listed for ${doctor.location}, but patient selected ${center}`
  } else if (hasConflict) {
    calendarStatus = 'pending_database_conflict'
  } else if (!isCalendarConfigured()) {
    calendarStatus = 'pending_calendar_not_configured'
    calendarError = 'GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_CALENDAR_ID are required'
  } else {
    try {
      const calendarBusy = await checkCalendarConflict(appointmentDate, appointmentTime)
      if (calendarBusy) {
        calendarStatus = 'pending_calendar_busy'
      } else {
        calendarEventId = await createAppointmentEvent({ patientName, patientPhone: phoneNumber, doctorName, serviceType, center, appointmentDate, appointmentTime, reason: 'Booked via WhatsApp' })
        status = 'confirmed'
        calendarStatus = 'synced'
      }
    } catch (err) {
      calendarStatus = 'pending_calendar_error'
      calendarError = (err as Error).message
      console.error('[ai-assistant] Google Calendar check/sync failed; appointment will stay pending:', err)
    }
  }

  const doctorIdForInsert = hasConflict || doctorCenterMismatch ? null : doctor?.id ?? null
  const reason = [
    'Booked via WhatsApp AI',
    session.collected_doctor_preference ? `Doctor preference: ${session.collected_doctor_preference}` : null,
    calendarStatus !== 'synced' ? `Calendar status: ${calendarStatus}` : null,
    calendarError ? `Calendar note: ${formatCalendarStatusForStaff(calendarStatus)}` : null,
  ].filter(Boolean).join(' | ')

  const { data: appointment, error: appointmentError } = await supabase.from('appointments').insert({
    patient_id: session.patient_id,
    doctor_id: doctorIdForInsert,
    booking_session_id: session.id,
    appointment_date: appointmentDate,
    appointment_time: appointmentTime,
    center,
    service_type: serviceType,
    reason,
    status,
    google_calendar_event_id: calendarEventId,
    google_calendar_synced_at: calendarEventId ? new Date().toISOString() : null,
    calendar_sync_status: calendarStatus,
    calendar_sync_error: calendarError,
    confirmation_sent: false,
    created_from_whatsapp: true,
  }).select('id').single()

  if (appointmentError || !appointment) {
    if (calendarEventId) {
      await cancelAppointmentEvent(calendarEventId).catch((err) => {
        console.error('[ai-assistant] Failed to clean up orphaned calendar event:', err)
      })
    }
    throw new Error(`Failed to create appointment: ${appointmentError?.message}`)
  }

  const patientUpdates: Record<string, string> = {}
  if (session.collected_name) patientUpdates.name = session.collected_name
  if (session.collected_sex) patientUpdates.gender = session.collected_sex
  if (session.collected_location) patientUpdates.location = session.collected_location
  if (patientEmail) patientUpdates.email = patientEmail
  if (Object.keys(patientUpdates).length > 0) {
    await supabase.from('patients').update(patientUpdates).eq('id', session.patient_id)
  }

  await notifyStaffOfBookedAppointment(supabase, {
    appointmentId: appointment.id,
    patientId: session.patient_id,
    status,
    patientName,
    patientPhone: phoneNumber,
    patientEmail,
    serviceType,
    formattedDate,
    appointmentDate,
    appointmentTime,
    center,
    doctorName,
    assignedDoctor: doctorCenterMismatch ? null : doctor,
    doctorPreference: session.collected_doctor_preference ?? 'Any available doctor',
    calendarStatus,
    calendarError,
  })

  if (patientEmail) {
    try {
      await sendAppointmentConfirmationEmail({
        patientEmail,
        patientName,
        appointmentDate: formattedDate,
        appointmentTime: appointmentTime.slice(0, 5),
        center,
        centerAddress: CENTER_ADDRESSES[center] ?? center,
        doctorName,
        serviceType,
        status,
      })
      await logAppointmentNotification(supabase, {
        patientId: session.patient_id,
        appointmentId: appointment.id,
        notificationType: 'appointment_confirmation',
        templateName: 'appointment_confirmation',
        channel: 'email',
        message: `Patient appointment email sent to ${patientEmail}`,
        status: 'sent',
        recipientRole: 'patient',
        recipientName: patientName,
        recipientPhone: null,
      })
    } catch (err) {
      console.error('[ai-assistant] Email confirmation failed:', err)
      await logAppointmentNotification(supabase, {
        patientId: session.patient_id,
        appointmentId: appointment.id,
        notificationType: 'appointment_confirmation',
        templateName: 'appointment_confirmation',
        channel: 'email',
        message: `Patient appointment email failed for ${patientEmail}`,
        status: 'failed',
        errorMessage: (err as Error).message,
        recipientRole: 'patient',
        recipientName: patientName,
        recipientPhone: null,
      })
    }
  }

  console.log(`[ai-assistant] Booking ${status}: ${patientName} on ${appointmentDate} at ${appointmentTime} (${center})`)

  if (status === 'confirmed') {
    return `Your appointment is confirmed at Serenity Royale Hospital.\n\nName: ${patientName}\nService: ${serviceType}\nDate: ${formattedDate}\nTime: ${appointmentTime.slice(0, 5)}\nCenter: ${center}\nDoctor: ${doctorName}\n\nPlease arrive 10-15 minutes early. To reschedule, reply here or call +234 806 219 7384.`
  }

  return `Your appointment request has been received. Our team will confirm the exact slot shortly.\n\nName: ${patientName}\nService: ${serviceType}\nPreferred date: ${formattedDate}\nPreferred time: ${appointmentTime.slice(0, 5)}\nCenter: ${center}\nDoctor preference: ${session.collected_doctor_preference ?? 'Any available doctor'}\n\nFor urgent help, call +234 806 219 7384.`
}

async function notifyStaffOfBookedAppointment(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: {
    appointmentId: string
    patientId: string
    status: 'pending' | 'confirmed'
    patientName: string
    patientPhone: string
    patientEmail: string | null
    serviceType: string
    formattedDate: string
    appointmentDate: string
    appointmentTime: string
    center: string
    doctorName: string
    assignedDoctor: DoctorContact | null
    doctorPreference: string
    calendarStatus: string
    calendarError: string | null
  },
): Promise<void> {
  const dashboardUrl = getDashboardUrl(params.appointmentId)
  const recipients = getStaffNotificationRecipients(params.assignedDoctor)

  if (Deno.env.get('BOOKING_NOTIFY_WHATSAPP_ENABLED') !== 'false') {
    for (const recipient of recipients) {
      const whatsappBody = buildStaffWhatsAppMessage({ ...params, dashboardUrl, recipient })
      try {
        const sid = await sendTextMessage(recipient.phone, whatsappBody)
        await logAppointmentNotification(supabase, {
          patientId: params.patientId,
          appointmentId: params.appointmentId,
          channel: 'whatsapp',
          message: whatsappBody,
          status: 'sent',
          externalMessageId: sid,
          recipientRole: recipient.role,
          recipientName: recipient.name,
          recipientPhone: recipient.phone,
        })
      } catch (err) {
        console.error(`[ai-assistant] Staff WhatsApp booking alert failed for ${recipient.role}:`, err)
        const failure = notificationFailureFromError(err)
        await logAppointmentNotification(supabase, {
          patientId: params.patientId,
          appointmentId: params.appointmentId,
          channel: 'whatsapp',
          message: whatsappBody,
          status: failure.status,
          errorMessage: failure.message,
          recipientRole: recipient.role,
          recipientName: recipient.name,
          recipientPhone: recipient.phone,
        })
      }
    }
  }

  if (Deno.env.get('BOOKING_NOTIFY_EMAIL_ENABLED') !== 'false') {
    try {
      await sendStaffAppointmentBookedEmail({
        appointmentId: params.appointmentId,
        status: params.status,
        patientName: params.patientName,
        patientPhone: params.patientPhone,
        patientEmail: params.patientEmail,
        serviceType: params.serviceType,
        appointmentDate: params.formattedDate,
        appointmentTime: params.appointmentTime.slice(0, 5),
        center: params.center,
        doctorName: params.doctorName,
        doctorPreference: params.doctorPreference,
        calendarStatus: params.calendarStatus,
        calendarError: params.calendarError,
        dashboardUrl,
      })
      await logAppointmentNotification(supabase, {
        patientId: params.patientId,
        appointmentId: params.appointmentId,
        channel: 'email',
        message: `Staff booking email sent for ${params.patientName}`,
        status: 'sent',
        recipientRole: 'staff_email',
        recipientName: 'Staff email recipients',
        recipientPhone: null,
      })
    } catch (err) {
      console.error('[ai-assistant] Staff email booking alert failed:', err)
      await logAppointmentNotification(supabase, {
        patientId: params.patientId,
        appointmentId: params.appointmentId,
        channel: 'email',
        message: `Staff booking email failed for ${params.patientName}`,
        status: 'failed',
        errorMessage: (err as Error).message,
        recipientRole: 'staff_email',
        recipientName: 'Staff email recipients',
        recipientPhone: null,
      })
    }
  }
}

function getStaffNotificationRecipients(assignedDoctor: DoctorContact | null): StaffNotificationRecipient[] {
  const operationsPhone = Deno.env.get('OPERATIONS_MANAGER_WHATSAPP') ?? '+2348072023652'
  const operationsName = Deno.env.get('OPERATIONS_MANAGER_NAME') ?? 'Abdullahi Rahinatu'
  const primaryPhone = Deno.env.get('PRIMARY_DOCTOR_WHATSAPP') ??
    Deno.env.get('STAFF_BOOKING_WHATSAPP_TO') ??
    Deno.env.get('HOSPITAL_MD_WHATSAPP') ??
    Deno.env.get('HOSPITAL_MD_PHONE') ??
    '+2348062197384'
  const primaryName = Deno.env.get('PRIMARY_DOCTOR_NAME') ?? 'Dr. Adekunle Adesina'

  const recipients: StaffNotificationRecipient[] = [
    { role: 'operations_manager', name: operationsName, phone: operationsPhone },
    { role: 'primary_doctor', name: primaryName, phone: primaryPhone },
  ]

  if (assignedDoctor?.phone && !isSamePhone(assignedDoctor.phone, operationsPhone) && !isSamePhone(assignedDoctor.phone, primaryPhone)) {
    recipients.push({ role: 'assigned_doctor', name: assignedDoctor.name, phone: assignedDoctor.phone })
  }

  return recipients
}

function notificationFailureFromError(err: unknown): { status: 'pending' | 'failed'; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('63038') || message.toLowerCase().includes('daily messages limit')) {
    return {
      status: 'pending',
      message: 'WhatsApp delivery is queued. The Twilio daily message limit has been reached; retry after the limit resets or after the hospital sender is upgraded.',
    }
  }

  return { status: 'failed', message }
}

function isSamePhone(a: string, b: string): boolean {
  return a.replace(/\D/g, '') === b.replace(/\D/g, '')
}

function buildStaffWhatsAppMessage(params: {
  status: 'pending' | 'confirmed'
  patientName: string
  patientPhone: string
  patientEmail: string | null
  serviceType: string
  formattedDate: string
  appointmentTime: string
  center: string
  doctorName: string
  doctorPreference: string
  calendarStatus: string
  calendarError: string | null
  dashboardUrl: string | null
  recipient: StaffNotificationRecipient
}): string {
  const actionByRole: Record<StaffNotificationRecipient['role'], string> = {
    operations_manager: params.status === 'confirmed'
      ? 'Action required: review the dashboard and coordinate patient arrival.'
      : 'Action required: please review/confirm this appointment request in the dashboard.',
    primary_doctor: 'For oversight: Serenity AI booked/received this appointment request.',
    assigned_doctor: 'A patient requested/booked an appointment with you. Please review the details.',
  }
  const calendarSummary = formatCalendarStatusForStaff(params.calendarStatus)

  return `New Serenity AI appointment (${params.status.toUpperCase()})

${actionByRole[params.recipient.role]}

Patient: ${params.patientName}
Phone: ${params.patientPhone}
Email: ${params.patientEmail ?? 'Not provided'}
Service: ${params.serviceType}
Date: ${params.formattedDate}
Time: ${params.appointmentTime.slice(0, 5)}
Center: ${params.center}
Doctor: ${params.doctorName}
Preference: ${params.doctorPreference}
Calendar: ${calendarSummary}
${params.dashboardUrl ? `Dashboard: ${params.dashboardUrl}` : ''}`.trim()
}

function formatCalendarStatusForStaff(status: string | null): string {
  switch (status) {
    case 'synced':
      return 'Synced with Google Calendar.'
    case 'pending_no_matched_doctor':
      return 'Doctor not assigned yet. Secretary should assign a doctor in the dashboard.'
    case 'pending_doctor_center_mismatch':
      return 'Doctor and center need review. Secretary should confirm the correct doctor and branch.'
    case 'pending_database_conflict':
      return 'Possible schedule conflict. Secretary should review availability.'
    case 'pending_calendar_not_configured':
      return 'Calendar setup needs review. Appointment is saved for manual confirmation.'
    case 'pending_calendar_busy':
      return 'Requested time may be unavailable. Secretary should confirm another slot if needed.'
    case 'pending_calendar_error':
      return 'Calendar check needs review. Appointment is saved for manual confirmation.'
    case 'not_checked':
    case null:
      return 'Not checked yet. Please review in the dashboard.'
    default:
      return 'Needs review in the dashboard.'
  }
}

function getDashboardUrl(appointmentId: string): string | null {
  const baseUrl = Deno.env.get('ADMIN_DASHBOARD_URL') ?? Deno.env.get('NEXT_PUBLIC_APP_URL')
  if (!baseUrl) return null
  return `${baseUrl.replace(/\/+$/, '')}/dashboard/appointments?appointment=${appointmentId}`
}

async function logAppointmentNotification(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: {
    patientId: string
    appointmentId: string
    notificationType?: 'appointment_confirmation' | 'staff_booking_alert'
    templateName?: string
    channel: 'whatsapp' | 'email'
    message: string
    status: 'sent' | 'pending' | 'failed'
    externalMessageId?: string
    errorMessage?: string
    recipientRole?: 'primary_doctor' | 'operations_manager' | 'assigned_doctor' | 'patient' | 'staff_email'
    recipientName?: string | null
    recipientPhone?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    patient_id: params.patientId,
    appointment_id: params.appointmentId,
    notification_type: params.notificationType ?? 'staff_booking_alert',
    channel: params.channel,
    template_name: params.templateName ?? 'staff_booking_alert',
    message_content: params.message.slice(0, 2000),
    status: params.status,
    external_message_id: params.externalMessageId ?? null,
    sent_at: params.status === 'sent' ? new Date().toISOString() : null,
    error_message: params.errorMessage ?? null,
    recipient_role: params.recipientRole ?? null,
    recipient_name: params.recipientName ?? null,
    recipient_phone: params.recipientPhone ?? null,
  })

  if (error) {
    console.error('[ai-assistant] Failed to log staff booking notification:', error.message)
  }
}

function normalizeCenter(value: string): 'Karu' | 'Galadimawa' {
  return value.toLowerCase().includes('karu') ? 'Karu' : 'Galadimawa'
}

function normalizeServiceType(value?: string | null): string {
  return parseServiceType(value ?? '').value ?? 'Psychological Medicine and Psychiatry'
}

async function updateBookingSession(
  supabase: ReturnType<typeof getSupabaseClient>,
  sessionId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('booking_sessions')
    .update({ ...updates, last_message_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) throw new Error(`Failed to update booking session: ${error.message}`)
}

function getPromptForStep(session: BookingSessionRow): string {
  switch (session.current_step) {
    case BOOKING_STEPS.NAME: return FIRST_BOOKING_PROMPT
    case BOOKING_STEPS.SEX: return 'What is your sex/gender? Reply Male, Female, or Prefer not to say.'
    case BOOKING_STEPS.LOCATION: return 'What area are you contacting us from? For example: Garki, Karu, Lagos, or outside Abuja.'
    case BOOKING_STEPS.SERVICE_TYPE: return getServicePrompt()
    case BOOKING_STEPS.DOCTOR: return 'Do you prefer a specific doctor? You can reply with a doctor name or say "any available doctor".'
    case BOOKING_STEPS.DATE: return 'What date would you prefer? Please use YYYY-MM-DD, DD/MM/YYYY, "tomorrow", "next week", or a weekday like Monday.'
    case BOOKING_STEPS.TIME: return 'What time would you prefer? Outpatient hours are 8:00am to 4:00pm. For example: 10am or 14:30.'
    case BOOKING_STEPS.CENTER: return 'Which center do you prefer: Karu or Galadimawa?'
    case BOOKING_STEPS.EMAIL: return 'What email should we send confirmation to? Reply SKIP if none.'
    case BOOKING_STEPS.CONFIRM: return buildBookingSummary(session)
    default: return FIRST_BOOKING_PROMPT
  }
}

function getServicePrompt(): string {
  return 'What service do you need?\n\nReply with one option: Psychiatry, Drug rehabilitation, EEG, Neurology, Physiotherapy, General medicine, Dual diagnosis, or Consultation.'
}

function parseFullName(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message)
  const lower = cleaned.toLowerCase()
  const looksLikeMenu = /[\n•]/.test(message) || ['book appointment', 'ask about', 'learn about', 'emergency support'].some((kw) => lower.includes(kw))
  const parts = cleaned.split(' ').filter((part) => /[a-z]/i.test(part))

  if (looksLikeMenu || cleaned.length < 5 || cleaned.length > 80 || parts.length < 2) {
    return { value: null, error: 'Please send your full name, first name and surname. For example: Ada Okafor.' }
  }
  return { value: cleaned, error: null }
}

function parseSex(message: string): ValidationResult<string> {
  const lower = message.trim().toLowerCase()
  if (['male', 'm', 'man'].includes(lower)) return { value: 'Male', error: null }
  if (['female', 'f', 'woman'].includes(lower)) return { value: 'Female', error: null }
  if (['other', 'prefer not to say', 'rather not say', 'skip'].includes(lower)) return { value: 'Prefer not to say', error: null }
  return { value: null, error: 'Please reply with Male, Female, or Prefer not to say.' }
}

function parseLocation(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message)
  if (!cleaned || cleaned.length < 2 || cleaned.length > 120 || /[\n•]/.test(message)) {
    return { value: null, error: 'Please send your current area or city. For example: Garki, Karu, Lagos, or outside Abuja.' }
  }
  return { value: cleaned, error: null }
}

function parseServiceType(message: string): ValidationResult<string> {
  const lower = message.toLowerCase()
  if (lower.includes('drug') || lower.includes('addict') || lower.includes('rehab') || lower.includes('substance')) {
    return { value: 'Drug Abuse Treatment and Rehabilitation', error: null }
  }
  if (lower.includes('eeg') || lower.includes('encephal')) return { value: 'Encephalography (EEG)', error: null }
  if (lower.includes('neuro')) return { value: 'Neurology', error: null }
  if (lower.includes('physio')) return { value: 'Physiotherapy', error: null }
  if (lower.includes('general')) return { value: 'General Medical Practice', error: null }
  if (lower.includes('dual')) return { value: 'Dual Diagnosis', error: null }
  if (lower.includes('consult')) return { value: 'Consultancy Services', error: null }
  if (lower.includes('psych') || lower.includes('mental') || lower.includes('psychiat')) return { value: 'Psychological Medicine and Psychiatry', error: null }

  return { value: null, error: getServicePrompt() }
}

function parseDoctorPreference(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message)
  if (!cleaned || cleaned.length > 80 || /[\n•]/.test(message)) {
    return { value: null, error: 'Please reply with a doctor name or say "any available doctor".' }
  }
  return { value: isAnyDoctorPreference(cleaned) ? 'Any available doctor' : cleaned, error: null }
}

function parseAppointmentDate(message: string): ValidationResult<string> {
  const lower = message.toLowerCase()
  const today = todayInLagos()
  let candidate: Date | null = null

  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  const dmy = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/)

  if (iso) {
    candidate = makeUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  } else if (dmy) {
    candidate = makeUtcDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
  } else if (lower.includes('tomorrow')) {
    candidate = addDays(today, 1)
  } else if (lower.includes('next week')) {
    candidate = addDays(today, 7)
  } else {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const weekday = weekdays.findIndex((day) => lower.includes(day))
    if (weekday >= 0) {
      let daysAhead = (weekday - today.getUTCDay() + 7) % 7
      if (daysAhead === 0) daysAhead = 7
      candidate = addDays(today, daysAhead)
    }
  }

  if (!candidate) {
    return { value: null, error: 'Please send a valid future date, such as 2026-05-12, 12/05/2026, tomorrow, next week, or Monday.' }
  }

  const maxDate = addDays(today, 183)
  if (candidate <= today) return { value: null, error: 'Please choose a future appointment date.' }
  if (candidate > maxDate) return { value: null, error: 'Please choose a date within the next 6 months.' }
  if (candidate.getUTCDay() === 0) return { value: null, error: 'Outpatient appointments are Monday to Saturday. Please choose another date.' }

  return { value: toIsoDate(candidate), error: null }
}

function parseAppointmentTime(message: string): ValidationResult<string> {
  const match = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (!match) {
    return { value: null, error: 'Please send a valid time between 8:00am and 4:00pm. For example: 10am or 14:30.' }
  }

  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const period = match[3]?.toLowerCase()

  if (minute > 59) return { value: null, error: 'Please send a valid time. For example: 10am or 14:30.' }
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  if (!period && hour > 0 && hour < 8) {
    return { value: null, error: 'Please include am or pm for that time. Outpatient hours are 8:00am to 4:00pm.' }
  }
  if (hour < 8 || hour > 16 || (hour === 16 && minute > 0)) {
    return { value: null, error: 'Outpatient appointments are between 8:00am and 4:00pm. Please choose another time.' }
  }

  return { value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, error: null }
}

function parseCenter(message: string): ValidationResult<'Karu' | 'Galadimawa'> {
  const lower = message.toLowerCase()
  if (lower.includes('karu')) return { value: 'Karu', error: null }
  if (lower.includes('galad') || lower.includes('royal homes')) return { value: 'Galadimawa', error: null }
  return { value: null, error: 'Please choose one center: Karu or Galadimawa.' }
}

function parseOptionalEmail(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message).toLowerCase()
  if (['skip', 'no', 'none', 'no email', 'not now', 'n/a', 'na'].includes(cleaned)) {
    return { value: null, error: null }
  }

  const email = normalizeWhitespace(message)
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { value: null, error: 'Please send a valid email address, or reply SKIP if you do not want email confirmation.' }
  }

  return { value: email, error: null }
}

function parseConfirmation(message: string): boolean | null {
  const lower = message.trim().toLowerCase()
  if (['yes', 'y', 'confirm', 'book it', 'proceed', 'ok', 'okay', 'sure', 'yes please'].some((word) => lower.includes(word))) return true
  if (['no', 'n', 'cancel', 'stop', 'not now', 'decline'].some((word) => lower.includes(word))) return false
  return null
}

function buildBookingSummary(session: Partial<BookingSessionRow>): string {
  return `Please confirm these appointment details:\n\nName: ${session.collected_name ?? 'Not provided'}\nSex/Gender: ${session.collected_sex ?? 'Not provided'}\nLocation: ${session.collected_location ?? 'Not provided'}\nService: ${session.collected_service_type ?? 'Not provided'}\nDoctor: ${session.collected_doctor_preference ?? 'Any available doctor'}\nDate: ${session.collected_date ? formatDisplayDate(session.collected_date) : 'Not provided'}\nTime: ${session.collected_time?.slice(0, 5) ?? 'Not provided'}\nCenter: ${session.collected_center ?? 'Not provided'}\nEmail: ${session.collected_email ?? 'Not provided'}\n\nReply YES to submit this appointment request or NO to cancel.`
}

async function findPreferredDoctor(
  supabase: ReturnType<typeof getSupabaseClient>,
  preference: string | null,
): Promise<DoctorContact | null> {
  if (!preference || isAnyDoctorPreference(preference)) return null

  const { data } = await supabase
    .from('doctors')
    .select('id, name, phone, location')
    .eq('is_active', true)
    .limit(20)

  if (!data || data.length === 0) return null

  const normalizedPreference = normalizeDoctorMatchText(preference)
  const drKAliases = ['dr k', 'doctor k', 'kunle', 'kune', 'adekunle', 'adesina', 'adeshina', 'adishina', 'akide', 'kunle adesina', 'kunle adeshina', 'adekunle adesina']
  const shouldPreferDrK = drKAliases.some((alias) => normalizedPreference.includes(alias))

  if (shouldPreferDrK) {
    return (data as DoctorContact[]).find((doctor) => {
      const normalizedName = normalizeDoctorMatchText(doctor.name)
      return normalizedName.includes('adekunle') || (normalizedName.includes('kunle') && normalizedName.includes('adesina'))
    }) ?? null
  }

  return (data as DoctorContact[]).find((doctor) => {
    const normalizedName = normalizeDoctorMatchText(doctor.name)
    return normalizedName.includes(normalizedPreference) ||
      normalizedPreference.includes(normalizedName) ||
      doctorNameAliases(doctor.name).some((alias) => normalizedPreference.includes(alias))
  }) ?? null
}

function doctorNameAliases(name: string): string[] {
  const normalizedName = normalizeDoctorMatchText(name)
  if (normalizedName.includes('grace') && normalizedName.includes('ikeh')) return ['grace', 'ikeh', 'eke', 'grace ikeh', 'grace eke']
  if (normalizedName.includes('nnajiofor') && normalizedName.includes('osondu')) return ['nnajiofor', 'osondu', 'dr osondu', 'osundu']
  if (normalizedName.includes('olaleye') && normalizedName.includes('abiola')) return ['olaleye', 'abiola', 'olaleye abiola']
  if (normalizedName.includes('julson') && normalizedName.includes('jeles')) return ['julson', 'jeles', 'julson jeles']
  return []
}

async function hasDoctorSlotConflict(
  supabase: ReturnType<typeof getSupabaseClient>,
  doctorId: string,
  appointmentDate: string,
  appointmentTime: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('appointments')
    .select('id')
    .eq('doctor_id', doctorId)
    .eq('appointment_date', appointmentDate)
    .eq('appointment_time', appointmentTime)
    .neq('status', 'cancelled')
    .limit(1)

  return Boolean(data && data.length > 0)
}

async function sendTextMessageSafely(to: string, text: string, context: string): Promise<void> {
  try {
    await sendTextMessage(to, text)
  } catch (err) {
    console.error(`[ai-assistant] Twilio send failed for ${context}:`, err)
  }
}

function isCancelBooking(message: string): boolean {
  const lower = message.toLowerCase().trim()
  return ['cancel', 'stop booking', 'start over', 'abort', 'never mind', 'nevermind'].includes(lower)
}

function isAnyDoctorPreference(value: string): boolean {
  const lower = value.toLowerCase()
  return ['any', 'any doctor', 'any available doctor', 'no preference', 'anyone', 'no specific doctor'].some((phrase) => lower.includes(phrase))
}

function doctorServesCenter(location: string, center: string): boolean {
  const normalizedLocation = normalizeDoctorMatchText(location)
  const normalizedCenter = normalizeDoctorMatchText(center)
  return normalizedLocation === 'both' || normalizedLocation.includes(normalizedCenter)
}

function normalizeDoctorMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bdoctor\b/g, 'dr')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function todayInLagos(): Date {
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000)
  return new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate()))
}

function makeUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 3600000)
}

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function formatDisplayDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Africa/Lagos',
  })
}

async function triggerEmergencyAlert(
  _supabase: ReturnType<typeof getSupabaseClient>,
  params: {
    patientId: string
    conversationId: string
    phoneNumber: string
    patientName: string
    alertType: 'suicidal' | 'self_harm' | 'drug_overdose' | 'panic_attack'
    severity: 'critical' | 'high' | 'medium'
    keywords: string[]
    messageSnippet: string
    assignedDoctorName?: string | null
    assignedDoctorPhone?: string | null
  },
): Promise<void> {
  const supabaseUrl = getSupabaseUrl()
  const serviceKey = getSupabaseServiceRoleKey()
  if (!supabaseUrl || !serviceKey) return

  fetch(`${supabaseUrl}/functions/v1/emergency-alert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch((err) => console.error('[ai-assistant] Failed to trigger emergency alert:', err))
}
