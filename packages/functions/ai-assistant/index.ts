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
  sendAudioMessage,
  downloadMedia,
  sendAppointmentReminder1Week,
  sendAppointmentReminder24h,
} from '../_shared/whatsapp.ts'
import {
  sendStaffAppointmentBookedEmail,
} from '../_shared/email.ts'
import { sendStaffWhatsAppNotification, staffTemplateName } from '../_shared/staff-whatsapp.ts'
import {
  buildPendingWhatsAppBookingRequestState,
  getWhatsAppBookingCreationNotificationPlan,
} from '../_shared/whatsapp-booking-request-flow.ts'
import {
  callDrAde,
  analyzeImageWithDrAde,
  detectEmergency,
  buildConsentMessage,
  isConsentResponse,
} from '../_shared/ai-provider.ts'
import {
  transcribeAudio,
  synthesizeSpeechForWhatsApp,
  redactPII,
  parseFeedbackRating,
} from '../_shared/deepgram.ts'
import { sendPatientReplyWithDeps } from '../_shared/patient-reply-sender.ts'
import type { PatientReplyRoute } from '../_shared/voice-reply-policy.ts'
import {
  checkCalendarConflict,
  isCalendarConfigured,
} from '../_shared/calendar.ts'
import {
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  SLOT_HOLD_MINUTES,
  checkAppointmentAvailability,
  formatSuggestedSlot,
  isNonBlockingAppointmentStatus,
  type AppointmentAvailabilityResult,
  type AvailabilityDoctor,
  type BusyAppointment,
  type BusySlotHold,
  type SuggestedSlot,
} from '../_shared/appointment-availability.ts'
import type {
  AIMessage,
  BookingSessionRow,
  MessageQueueRow,
  PatientRow,
} from '../_shared/types.ts'
import { BOOKING_STEPS } from '../_shared/types.ts'
import {
  addDays,
  buildAdminHelpResponse,
  buildAppointmentStatusReply,
  buildBookingSummary,
  buildPatientMemoryPrompt,
  buildWelcomeBackGreeting,
  doctorServesCenter,
  formatAppointmentForPatient,
  formatDisplayDate,
  getAppointmentDoctorName,
  getPatientGreetingName,
  getServicePrompt,
  isAdminHelpIntent,
  isAdminInstruction,
  isAnyDoctorPreference,
  isAppointmentStatusIntent,
  isBookAppointmentIntentWithExistingAppointment,
  isCancelAppointmentConfirmation,
  isCancelAppointmentIntent,
  isCancelBooking,
  isDoctorStatusIntent,
  isKeepAppointmentIntent,
  isCurrentOrUpcomingAppointment,
  isKnownPatient,
  isPhoneAuthorizedForAdminCommand,
  isRescheduleIntent,
  isReturningPatientMemoryIntent,
  isSimpleGreeting,
  isSimpleYes,
  isSpeakToTeamIntent,
  matchPreferredDoctor,
  normalizeCenter,
  normalizeDoctorMatchText,
  normalizeServiceType,
  normalizeWhitespace,
  parseAppointmentDate,
  parseAppointmentTime,
  parseCenter,
  parseConfirmation,
  parseDoctorPreference,
  parseFullName,
  parseLocation,
  parseOptionalEmail,
  parseServiceType,
  parseSex,
  shouldAssignDoctorDuringBooking,
  todayInLagos,
  toIsoDate,
  wasLastAssistantCancelPrompt,
  wasLastAssistantReschedulePrompt,
} from '../_shared/mvp-logic.ts'
import type {
  AppointmentMemoryRow,
  DoctorContact,
  EmergencyMemoryRow,
  PatientContext,
  PatientMemoryContext,
} from '../_shared/mvp-logic.ts'

const BATCH_SIZE = 5
const MAX_RETRY_COUNT = 3

const FIXED_CRISIS_RESPONSE = `I'm really sorry you're feeling this way. You're not alone, and immediate help is available.

Please call Serenity Royale Hospital now: +234 806 219 7384 or +234 811 689 1990. If you are in immediate danger, please go to the nearest emergency department or ask someone near you to stay with you while you call.`

const FIRST_BOOKING_PROMPT = 'Sure. I can help book your appointment. What is your full name?'

type BookingResult = {
  response: string
  sentiment?: 'positive' | 'neutral' | 'distressed' | 'crisis' | null
}

type FinalizeBookingResult = {
  response: string
  completed: boolean
  sentiment: 'positive' | 'neutral'
}

type TemplateResult = {
  response: string
  sentiment: 'positive' | 'neutral' | 'distressed' | 'crisis' | null
  label: string
}

type AssistantRequestBody = {
  queueItemId?: string
}

type StaffNotificationRecipient = {
  role: 'operations_manager' | 'primary_doctor' | 'assigned_doctor'
  name: string
  phone: string
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

    await sendPatientReply(supabase, phoneNumber, adminCommand.response, messageType, 'admin', `admin command: ${adminCommand.label}`)
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

    await sendPatientReply(supabase, phoneNumber, FIXED_CRISIS_RESPONSE, messageType, 'emergency', 'pre-consent emergency')

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
      await sendPatientReply(
        supabase,
        phoneNumber,
        `Thank you! Your consent has been recorded. 🌿\n\nI'm Dr Ade, your AI health assistant at Serenity Royale Hospital. How can I help you today?\n\n• Book an appointment\n• Ask about our services\n• Learn about costs\n• Get emergency support`,
        messageType,
        'consent',
        'consent recorded',
      )
      await saveConversation(supabase, { patientId, messageType: 'text', patientMessage: messageText, patientMessageRedacted: messageText, aiResponse: 'Consent recorded. Welcome message sent.', mediaUrl: null, sentiment: 'positive', hasEmergencyKeywords: false, whatsappMessageId, transcription: null, transcriptionRedacted: null })
      return
    }
    if (consentCheck === 'no') {
      await sendPatientReply(
        supabase,
        phoneNumber,
        `No problem. We respect your privacy. You can still reach us directly:\n📞 +234 806 219 7384\n📞 +234 811 689 1990\n📧 info@serenityroyalehospital.com\n\nWe're here 24/7 for emergencies. Stay well! 💚`,
        messageType,
        'consent',
        'consent declined',
      )
      return
    }
    await sendPatientReply(supabase, phoneNumber, buildConsentMessage(patient.name ?? undefined), messageType, 'consent', 'consent prompt')
    return
  }

  // ── Handle voice notes — transcribe via Deepgram ─────────────────────────
  let transcription: string | null = null
  let transcriptionRedacted: string | null = null

  if (messageType === 'audio' && queueItem.media_url) {
    try {
      const { data: mediaBytes, mimeType } = await downloadMedia(
        queueItem.media_url as string,
        queueItem.media_mime_type as string | null,
      )
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

    await sendPatientReply(supabase, phoneNumber, FIXED_CRISIS_RESPONSE, messageType, 'emergency', 'emergency response')

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

    await sendPatientReply(supabase, phoneNumber, bookingResult.response, messageType, 'booking', 'booking response')
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

    await sendPatientReply(supabase, phoneNumber, memoryResult.response, messageType, 'memory', `patient memory: ${memoryResult.label}`)
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

    await sendPatientReply(supabase, phoneNumber, response, messageType, 'booking_start', 'booking start')
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

    await sendPatientReply(supabase, phoneNumber, templateResult.response, messageType, 'hybrid_template', `hybrid template: ${templateResult.label}`)
    return
  }

  // ── Handle images — download from WhatsApp and analyze with vision AI ─────
  if (messageType === 'image' && queueItem.media_url) {
    const { response, provider, sentiment, tokensUsed } = await analyzeImageMessage(
      queueItem.media_url as string,
      queueItem.media_mime_type as string | null,
      messageText,
      phoneNumber,
    )

    await saveConversation(supabase, {
      patientId,
      messageType,
      patientMessage: messageText,
      patientMessageRedacted: messageRedacted,
      aiResponse: response,
      mediaUrl: queueItem.media_url as string | null,
      sentiment,
      hasEmergencyKeywords: false,
      whatsappMessageId,
      transcription,
      transcriptionRedacted,
    })

    await trackApiUsage(supabase, provider, tokensUsed)
    await sendPatientReply(supabase, phoneNumber, response, messageType, 'image_analysis', 'image analysis')
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
  await sendPatientReply(supabase, phoneNumber, finalResponse, messageType, 'general_ai', 'general AI response')
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

function isAuthorizedAdminPhone(phoneNumber: string): boolean {
  return isPhoneAuthorizedForAdminCommand(phoneNumber, [
    Deno.env.get('PRIMARY_DOCTOR_WHATSAPP') ?? '+2348062197384',
    Deno.env.get('OPERATIONS_MANAGER_WHATSAPP') ?? '+2348072023652',
    Deno.env.get('HOSPITAL_MD_WHATSAPP'),
    Deno.env.get('HOSPITAL_MD_PHONE'),
    Deno.env.get('STAFF_BOOKING_WHATSAPP_TO'),
    ...(Deno.env.get('ADMIN_COMMAND_WHATSAPP_NUMBERS') ?? '').split(','),
  ])
}

async function analyzeImageMessage(
  mediaReference: string,
  fallbackMimeType: string | null,
  patientMessage: string | null,
  phoneNumber: string,
): Promise<{
  response: string
  provider: string
  sentiment: 'positive' | 'neutral' | 'distressed' | 'crisis' | null
  tokensUsed: number
}> {
  try {
    const { data: mediaBytes, mimeType } = await downloadMedia(mediaReference, fallbackMimeType)
    const result = await analyzeImageWithDrAde(mediaBytes, mimeType, patientMessage, phoneNumber)
    return {
      response: result.message,
      provider: result.provider || 'groq:vision',
      sentiment: result.sentiment,
      tokensUsed: result.tokensUsed,
    }
  } catch (err) {
    console.error('[ai-assistant] Image analysis failed:', err)
    return {
      response: 'I received the image, but I could not review it clearly here. Please type what you want help with, or call Serenity Royale Hospital at +234 806 219 7384 if it is urgent.',
      provider: 'vision',
      sentiment: null,
      tokensUsed: 0,
    }
  }
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
  const hasActiveAppointment = appointment ? isCurrentOrUpcomingAppointment(appointment, todayInLagos()) : false
  const hasVerifiedPatientContext = isKnownPatient(context.patient) ||
    Boolean(context.latestAppointment) ||
    Boolean(context.latestCompletedBooking) ||
    context.recentConversation.length > 0

  if (isReturningPatientMemoryIntent(lower)) {
    const greetingName = getPatientGreetingName(context.patient.name)
    const intro = greetingName ? `Yes, ${greetingName}.` : 'Yes.'
    return {
      label: 'returning_patient_memory_confirmation',
      sentiment: 'positive',
      response: hasVerifiedPatientContext
        ? `${intro} I can see the details you have already shared with Serenity, so you do not need to start from scratch each time. ${appointment ? 'I can also check your latest appointment update whenever you need it.' : 'If anything has changed, just tell me and I will update it.'}`
        : 'I can use any details already saved in your Serenity record and this chat. If I do not have something yet, I will ask for it and keep things simple.',
    }
  }

  if (hasActiveAppointment && appointment && wasLastAssistantReschedulePrompt(context)) {
    const parsedDate = parseAppointmentDate(message)
    const parsedTime = parseAppointmentTime(message)
    if (parsedDate.error || parsedTime.error) {
      return {
        label: 'appointment_reschedule_retry',
        sentiment: 'neutral',
        response: `Please send both the new date and time in one message. For example: "Monday 10am" or "2026-06-17 14:30".\n\nYour current appointment is still saved while our team reviews the change.`,
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
      response: `Your reschedule request has been received.\n\nService: ${appointment.service_type ?? 'Consultation'}\nNew date: ${formatDisplayDate(parsedDate.value!)}\nNew time: ${parsedTime.value!.slice(0, 5)}\nCenter: ${appointment.center ?? 'Not selected'}\nDoctor: ${getAppointmentDoctorName(appointment) ?? 'Doctor not assigned yet'}\n\nOur team will confirm the final slot shortly.`,
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
      response: `I can help you request a change. Your current appointment is:\n\n${formatAppointmentForPatient(appointment)}\n\nPlease send your preferred new date and time. Our team will review availability and confirm the final slot.`,
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
        : `A doctor has not been assigned yet. Your appointment request has been received, and our team will confirm the doctor shortly.\n\n${formatAppointmentForPatient(appointment)}`,
    }
  }

  if (hasActiveAppointment && isBookAppointmentIntentWithExistingAppointment(lower) && appointment) {
    return {
      label: 'booking_intent_existing_appointment',
      sentiment: 'neutral',
      response: `${buildWelcomeBackGreeting(context.patient.name)} I can see your current appointment request:\n\n${formatAppointmentForPatient(appointment)}\n\nReply "CHANGE APPOINTMENT" to update this request, or "START NEW BOOKING" if you want to book a separate appointment.`,
    }
  }

  if (isAppointmentStatusIntent(lower) || (isSimpleGreeting(lower) && hasActiveAppointment && appointment)) {
    return {
      label: 'appointment_status',
      sentiment: 'neutral',
      response: buildAppointmentStatusReply(context, appointment!),
    }
  }

  if (isSpeakToTeamIntent(lower)) {
    return {
      label: 'speak_to_team',
      sentiment: 'neutral',
      response: `You can speak with Serenity Royale Hospital directly on +234 806 219 7384 or +234 811 689 1990.\n\nIf this is urgent, please call now. If you want an appointment, reply "Book an appointment".`,
    }
  }

  if (isSimpleGreeting(lower) && isKnownPatient(context.patient) && !hasActiveAppointment) {
    return {
      label: 'returning_patient_no_appointment',
      sentiment: 'positive',
      response: `${buildWelcomeBackGreeting(context.patient.name)}\n\nI still have your details on file, and there is no active appointment request at the moment.\n\nHow can I help today?\n\n• Book an appointment\n• Ask about our services\n• Learn about costs\n• Get emergency support`,
    }
  }

  return null
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
  const asksCosts = matchesAny(lower, ['cost', 'price', 'fee', 'fees', 'how much', 'charges', 'bill', 'billing'])
  const asksServices = matchesAny(lower, ['service', 'services', 'what do you do', 'treat', 'treatment', 'rehab', 'psychiatry', 'neurology', 'physiotherapy', 'eeg', 'dual diagnosis'])

  if (matchesAny(lower, ['privacy', 'data', 'ndpr', 'consent', 'delete my data', 'remove my data', 'export my data'])) {
    return {
      label: 'privacy',
      sentiment: 'neutral',
      response: `Serenity Royale Hospital uses your information only to provide healthcare support, manage appointments, keep conversation history, and contact you when needed for care.

Your information is handled in line with Nigeria's NDPR/NDPA data protection expectations. You can ask our team about your records, correction, export, or deletion requests.

For privacy requests, contact info@serenityroyalehospital.com or call +234 806 219 7384.`,
    }
  }

  if (asksCosts && asksServices) {
    return {
      label: 'services_and_costs',
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

Standard charges:
- Registration: ₦30,000
- Toxicology and profiling for substance-abuse care: ₦20,000

Monthly care costs vary by center, service, and patient needs. If you want an appointment, reply "Book an appointment" and I will help step by step.`,
    }
  }

  if (asksCosts) {
    return {
      label: 'costs',
      sentiment: 'neutral',
      response: `Here are the standard Serenity Royale Hospital charges:

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

  if (asksServices) {
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
      await updateBookingSession(supabase, session.id, { collected_time: parsed.value, current_step: BOOKING_STEPS.EMAIL })
      return { response: 'What email should we send confirmation to? Reply SKIP if none.', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.EMAIL: {
      const parsed = parseOptionalEmail(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      await updateBookingSession(supabase, session.id, { collected_email: parsed.value, current_step: BOOKING_STEPS.CENTER })
      return { response: 'Which center do you prefer: Karu or Galadimawa?', sentiment: 'neutral' }
    }
    case BOOKING_STEPS.CENTER: {
      const parsed = parseCenter(msg)
      if (parsed.error) return { response: parsed.error, sentiment: 'neutral' }
      const nextSession = { ...session, collected_center: parsed.value }
      const availability = await checkAvailabilityForBookingSession(supabase, nextSession)

      if (availability.status === 'available' || availability.status === 'needs_review') {
        const shouldAssignDoctor = shouldAssignDoctorDuringBooking(nextSession.collected_doctor_preference)
        const holdId = shouldAssignDoctor && availability.doctor
          ? await createOrRefreshSlotHold(supabase, nextSession, availability.doctor, availability.appointmentDate, availability.appointmentTime)
          : null
        if (shouldAssignDoctor && availability.doctor && !holdId) {
          const refreshed = await checkAvailabilityForBookingSession(supabase, nextSession)
          await updateBookingSession(supabase, session.id, {
            collected_center: parsed.value,
            current_step: BOOKING_STEPS.CONFIRM,
            availability_status: refreshed.status,
            availability_checked_at: new Date().toISOString(),
            availability_doctor_id: refreshed.doctor?.id ?? null,
            availability_alternatives: refreshed.alternatives,
            held_slot_id: null,
          })
          return { response: buildUnavailableSlotMessage(refreshed), sentiment: 'neutral' }
        }
        await updateBookingSession(supabase, session.id, {
          collected_center: parsed.value,
          current_step: BOOKING_STEPS.CONFIRM,
          availability_status: availability.status,
          availability_checked_at: new Date().toISOString(),
          availability_doctor_id: availability.doctor?.id ?? null,
          availability_alternatives: [],
          held_slot_id: holdId,
        })
        return { response: buildAvailabilityConfirmationMessage({ ...nextSession, held_slot_id: holdId }, availability), sentiment: 'neutral' }
      }

      await updateBookingSession(supabase, session.id, {
        collected_center: parsed.value,
        current_step: BOOKING_STEPS.CONFIRM,
        availability_status: availability.status,
        availability_checked_at: new Date().toISOString(),
        availability_doctor_id: availability.doctor?.id ?? null,
        availability_alternatives: availability.alternatives,
        held_slot_id: null,
      })
      return { response: buildUnavailableSlotMessage(availability), sentiment: 'neutral' }
    }
    case BOOKING_STEPS.CONFIRM: {
      if (session.availability_status === 'unavailable') {
        return handleUnavailableSlotReply(supabase, session, msg)
      }

      const confirmed = parseConfirmation(msg)
      if (confirmed === null) {
        return { response: `${buildBookingSummary(session)}\n\nPlease reply YES to confirm this appointment or NO to cancel.`, sentiment: 'neutral' }
      }
      if (!confirmed) {
        await releaseSlotHold(supabase, session.held_slot_id ?? null)
        await updateBookingSession(supabase, session.id, { status: 'abandoned', abandoned_at: new Date().toISOString(), held_slot_id: null })
        return { response: "No problem. I have cancelled this booking request. Send 'Book an appointment' anytime you want to start again.", sentiment: 'neutral' }
      }

      const result = await finalizeBooking(supabase, session, phoneNumber, patient)
      if (result.completed) {
        await updateBookingSession(supabase, session.id, { status: 'completed', completed_at: new Date().toISOString() })
      }
      return { response: result.response, sentiment: result.sentiment }
    }
    default:
      await updateBookingSession(supabase, session.id, { current_step: BOOKING_STEPS.NAME })
      return { response: FIRST_BOOKING_PROMPT, sentiment: 'neutral' }
  }
}

async function handleUnavailableSlotReply(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: BookingSessionRow,
  msg: string,
): Promise<BookingResult> {
  const selected = parseAlternativeSelection(msg, getStoredAlternatives(session))

  if (selected) {
    const doctor = await findDoctorById(supabase, selected.doctorId)
    if (!doctor) {
      return {
        response: 'I could not find that doctor record anymore. Please choose another option or send a new date and time.',
        sentiment: 'neutral',
      }
    }

    const nextSession = {
      ...session,
      collected_date: selected.appointmentDate,
      collected_time: selected.appointmentTime,
      availability_doctor_id: selected.doctorId,
    }
    const availability = await checkAvailabilityForBookingSession(supabase, nextSession, doctor)
    if (availability.status === 'available' || availability.status === 'needs_review') {
      const shouldAssignDoctor = shouldAssignDoctorDuringBooking(nextSession.collected_doctor_preference)
      const holdId = shouldAssignDoctor
        ? await createOrRefreshSlotHold(supabase, nextSession, doctor, availability.appointmentDate, availability.appointmentTime)
        : null
      if (shouldAssignDoctor && !holdId) {
        const refreshed = await checkAvailabilityForBookingSession(supabase, nextSession, doctor)
        await updateBookingSession(supabase, session.id, {
          availability_status: refreshed.status,
          availability_checked_at: new Date().toISOString(),
          availability_alternatives: refreshed.alternatives,
          held_slot_id: null,
        })
        return { response: buildUnavailableSlotMessage(refreshed), sentiment: 'neutral' }
      }
      await updateBookingSession(supabase, session.id, {
        collected_date: selected.appointmentDate,
        collected_time: selected.appointmentTime,
        availability_status: availability.status,
        availability_checked_at: new Date().toISOString(),
        availability_doctor_id: doctor.id,
        availability_alternatives: [],
        held_slot_id: holdId,
      })
      return { response: buildAvailabilityConfirmationMessage({ ...nextSession, held_slot_id: holdId }, availability), sentiment: 'neutral' }
    }

    await updateBookingSession(supabase, session.id, {
      availability_status: availability.status,
      availability_checked_at: new Date().toISOString(),
      availability_alternatives: availability.alternatives,
      held_slot_id: null,
    })
    return { response: buildUnavailableSlotMessage(availability), sentiment: 'neutral' }
  }

  const parsedDate = parseAppointmentDate(msg)
  const parsedTime = parseAppointmentTime(msg)
  if (!parsedDate.error && !parsedTime.error) {
    const nextSession = {
      ...session,
      collected_date: parsedDate.value,
      collected_time: parsedTime.value,
    }
    const availability = await checkAvailabilityForBookingSession(supabase, nextSession)
    if (availability.status === 'available' || availability.status === 'needs_review') {
      const shouldAssignDoctor = shouldAssignDoctorDuringBooking(nextSession.collected_doctor_preference)
      const holdId = shouldAssignDoctor && availability.doctor
        ? await createOrRefreshSlotHold(supabase, nextSession, availability.doctor, availability.appointmentDate, availability.appointmentTime)
        : null
      if (shouldAssignDoctor && availability.doctor && !holdId) {
        const refreshed = await checkAvailabilityForBookingSession(supabase, nextSession)
        await updateBookingSession(supabase, session.id, {
          collected_date: parsedDate.value,
          collected_time: parsedTime.value,
          availability_status: refreshed.status,
          availability_checked_at: new Date().toISOString(),
          availability_doctor_id: refreshed.doctor?.id ?? null,
          availability_alternatives: refreshed.alternatives,
          held_slot_id: null,
        })
        return { response: buildUnavailableSlotMessage(refreshed), sentiment: 'neutral' }
      }
      await updateBookingSession(supabase, session.id, {
        collected_date: parsedDate.value,
        collected_time: parsedTime.value,
        availability_status: availability.status,
        availability_checked_at: new Date().toISOString(),
        availability_doctor_id: availability.doctor?.id ?? null,
        availability_alternatives: [],
        held_slot_id: holdId,
      })
      return { response: buildAvailabilityConfirmationMessage({ ...nextSession, held_slot_id: holdId }, availability), sentiment: 'neutral' }
    }

    await updateBookingSession(supabase, session.id, {
      collected_date: parsedDate.value,
      collected_time: parsedTime.value,
      availability_status: availability.status,
      availability_checked_at: new Date().toISOString(),
      availability_doctor_id: availability.doctor?.id ?? null,
      availability_alternatives: availability.alternatives,
      held_slot_id: null,
    })
    return { response: buildUnavailableSlotMessage(availability), sentiment: 'neutral' }
  }

  return {
    response: `${buildUnavailableSlotMessage({ alternatives: getStoredAlternatives(session) } as AppointmentAvailabilityResult)}\n\nReply with 1, 2, or 3, or send another date and time like "Monday 10am".`,
    sentiment: 'neutral',
  }
}

function parseAlternativeSelection(message: string, alternatives: SuggestedSlot[]): SuggestedSlot | null {
  const normalized = message.trim().toLowerCase()
  const match = normalized.match(/^[#\s]*(\d)$/)
  if (!match) return null
  const index = Number(match[1]) - 1
  return alternatives[index] ?? null
}

function getStoredAlternatives(session: BookingSessionRow): SuggestedSlot[] {
  if (!Array.isArray(session.availability_alternatives)) return []
  return session.availability_alternatives
    .map((item) => item && typeof item === 'object' ? item as Partial<SuggestedSlot> : null)
    .filter((item): item is SuggestedSlot => Boolean(
      item?.doctorId &&
      item?.doctorName &&
      item?.appointmentDate &&
      item?.appointmentTime &&
      item?.center,
    ))
}

async function checkAvailabilityForBookingSession(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: Partial<BookingSessionRow>,
  forcedDoctor?: AvailabilityDoctor | null,
): Promise<AppointmentAvailabilityResult> {
  const appointmentDate = session.collected_date ?? ''
  const appointmentTime = session.collected_time ?? ''
  const center = normalizeCenter(session.collected_center ?? 'Galadimawa')
  const doctor = forcedDoctor ?? await resolveDoctorForAvailability(supabase, session, center)
  const candidateDoctors = doctor ? [doctor] : await loadDoctorsForCenter(supabase, center)

  return checkAppointmentAvailability({
    appointmentDate,
    appointmentTime,
    center,
    doctor,
    candidateDoctors,
    excludeBookingSessionId: session.id ?? null,
    durationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
  }, buildAvailabilityDeps(supabase))
}

async function resolveDoctorForAvailability(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: Partial<BookingSessionRow>,
  _center: string,
): Promise<AvailabilityDoctor | null> {
  if (session.availability_doctor_id) return findDoctorById(supabase, session.availability_doctor_id)
  if (session.collected_doctor_preference && !isAnyDoctorPreference(session.collected_doctor_preference)) {
    return findPreferredDoctor(supabase, session.collected_doctor_preference)
  }

  return null
}

function buildAvailabilityDeps(supabase: ReturnType<typeof getSupabaseClient>) {
  return {
    listActiveAppointments: (params: { doctorId: string; appointmentDate: string; excludeAppointmentId?: string | null }) =>
      listActiveAppointmentsForDoctor(supabase, params),
    listActiveSlotHolds: (params: { doctorId: string; appointmentDate: string; excludeBookingSessionId?: string | null }) =>
      listActiveSlotHoldsForDoctor(supabase, params),
    isCalendarConfigured,
    checkCalendarConflict,
  }
}

async function listActiveAppointmentsForDoctor(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: { doctorId: string; appointmentDate: string; excludeAppointmentId?: string | null },
): Promise<BusyAppointment[]> {
  let query = supabase
    .from('appointments')
    .select('id, appointment_time, status')
    .eq('doctor_id', params.doctorId)
    .eq('appointment_date', params.appointmentDate)

  if (params.excludeAppointmentId) query = query.neq('id', params.excludeAppointmentId)

  const { data, error } = await query
  if (error) throw new Error(`Failed to check appointment conflicts: ${error.message}`)
  return ((data ?? []) as BusyAppointment[]).filter((appointment) => !isNonBlockingAppointmentStatus(appointment.status))
}

async function listActiveSlotHoldsForDoctor(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: { doctorId: string; appointmentDate: string; excludeBookingSessionId?: string | null },
): Promise<BusySlotHold[]> {
  let query = supabase
    .from('appointment_slot_holds')
    .select('id, appointment_time, duration_minutes, booking_session_id, expires_at, status')
    .eq('doctor_id', params.doctorId)
    .eq('appointment_date', params.appointmentDate)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  if (params.excludeBookingSessionId) query = query.neq('booking_session_id', params.excludeBookingSessionId)

  const { data, error } = await query
  if (error) throw new Error(`Failed to check slot holds: ${error.message}`)
  return (data ?? []) as BusySlotHold[]
}

async function loadDoctorsForCenter(
  supabase: ReturnType<typeof getSupabaseClient>,
  center: string,
): Promise<AvailabilityDoctor[]> {
  const { data, error } = await supabase
    .from('doctors')
    .select('id, name, phone, location')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(50)

  if (error) throw new Error(`Failed to load doctors: ${error.message}`)
  return ((data ?? []) as AvailabilityDoctor[]).filter((doctor) => doctorServesCenter(doctor.location ?? 'Both', center))
}

async function findDoctorById(
  supabase: ReturnType<typeof getSupabaseClient>,
  doctorId: string,
): Promise<AvailabilityDoctor | null> {
  const { data, error } = await supabase
    .from('doctors')
    .select('id, name, phone, location')
    .eq('id', doctorId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new Error(`Failed to load doctor: ${error.message}`)
  return data as AvailabilityDoctor | null
}

async function createOrRefreshSlotHold(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: Partial<BookingSessionRow>,
  doctor: AvailabilityDoctor,
  appointmentDate: string,
  appointmentTime: string,
): Promise<string | null> {
  if (!session.id || !session.patient_id) return null

  await supabase
    .from('appointment_slot_holds')
    .update({ status: 'released' })
    .eq('booking_session_id', session.id)
    .eq('status', 'active')

  const { data, error } = await supabase
    .rpc('create_appointment_slot_hold_with_lock', {
      p_patient_id: session.patient_id,
      p_doctor_id: doctor.id,
      p_booking_session_id: session.id,
      p_appointment_date: appointmentDate,
      p_appointment_time: appointmentTime,
      p_duration_minutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
      p_hold_minutes: SLOT_HOLD_MINUTES,
    })

  if (error) throw new Error(`Failed to hold appointment slot: ${error.message}`)
  return typeof data === 'string' ? data : null
}

async function releaseSlotHold(
  supabase: ReturnType<typeof getSupabaseClient>,
  holdId: string | null,
): Promise<void> {
  if (!holdId) return
  await supabase.from('appointment_slot_holds').update({ status: 'released' }).eq('id', holdId).eq('status', 'active')
}

async function createWhatsAppAppointmentWithLock(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: {
    patientId: string
    doctorId: string | null
    bookingSessionId: string
    heldSlotId: string | null
    appointmentDate: string
    appointmentTime: string
    center: string
    serviceType: string
    reason: string
    status: 'pending' | 'confirmed'
    calendarSyncStatus: string | null
    calendarSyncError: string | null
  },
): Promise<string | null> {
  const payload = params.doctorId && params.heldSlotId
    ? {
      p_patient_id: params.patientId,
      p_doctor_id: params.doctorId,
      p_booking_session_id: params.bookingSessionId,
      p_held_slot_id: params.heldSlotId,
      p_appointment_date: params.appointmentDate,
      p_appointment_time: params.appointmentTime,
      p_center: params.center,
      p_service_type: params.serviceType,
      p_reason: params.reason,
      p_status: params.status,
      p_calendar_sync_status: params.calendarSyncStatus,
      p_calendar_sync_error: params.calendarSyncError,
      p_created_from_whatsapp: true,
    }
    : {
      p_patient_id: params.patientId,
      p_doctor_id: params.doctorId,
      p_booking_session_id: params.bookingSessionId,
      p_appointment_date: params.appointmentDate,
      p_appointment_time: params.appointmentTime,
      p_center: params.center,
      p_service_type: params.serviceType,
      p_reason: params.reason,
      p_status: params.status,
      p_calendar_sync_status: params.calendarSyncStatus,
      p_calendar_sync_error: params.calendarSyncError,
      p_created_from_whatsapp: true,
    }

  const { data, error } = await supabase.rpc('create_whatsapp_appointment_with_lock', payload)

  if (error) throw new Error(`Failed to create appointment: ${error.message}`)
  return typeof data === 'string' ? data : null
}

function buildAvailabilityConfirmationMessage(
  session: Partial<BookingSessionRow>,
  availability: AppointmentAvailabilityResult,
): string {
  const patientName = session.collected_name ?? 'Patient'
  const serviceType = normalizeServiceType(session.collected_service_type)
  const center = normalizeCenter(session.collected_center ?? 'Galadimawa')
  const doctorPreference = session.collected_doctor_preference ?? 'Any available doctor'
  const date = formatDisplayDate(availability.appointmentDate)
  const time = availability.appointmentTime.slice(0, 5)
  const statusLine = availability.status === 'available'
    ? 'That time is available. Please confirm these details if you would like me to submit your appointment request:'
    : 'That time looks available. Please confirm these details if you would like me to submit your appointment request. Our team will send the final confirmation shortly.'

  return `Let me check that for you.\n\n${statusLine}\n\nName: ${patientName}\nService: ${serviceType}\nDate: ${date}\nTime: ${time}\nCenter: ${center}\nDoctor preference: ${doctorPreference}\nEmail: ${session.collected_email ?? 'Not provided'}\n\nReply YES to submit this appointment request or NO to cancel.`
}

function buildUnavailableSlotMessage(availability: Pick<AppointmentAvailabilityResult, 'alternatives'>): string {
  const alternatives = availability.alternatives ?? []
  if (alternatives.length === 0) {
    return 'Let me check that for you.\n\nThat time is not available. Please send another date and time, for example "Monday 10am".'
  }

  const rows = alternatives.slice(0, 3).map((slot, index) => `${index + 1}. ${formatSuggestedSlot(slot)}`)
  return `Let me check that for you.\n\nThat time is not available. The closest available options are:\n\n${rows.join('\n')}\n\nReply 1, 2, or 3 to choose a slot, or send another date and time.`
}

/**
 * Create appointment in DB + Google Calendar. Supabase remains source of truth.
 */
async function finalizeBooking(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: BookingSessionRow,
  phoneNumber: string,
  patient: Pick<PatientRow, 'id' | 'name'> & { email?: string },
): Promise<FinalizeBookingResult> {
  const appointmentDate = session.collected_date ?? new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0]
  const appointmentTime = session.collected_time ?? '09:00'
  const center = normalizeCenter(session.collected_center ?? 'Galadimawa')
  const patientName = session.collected_name ?? patient.name ?? 'Patient'
  const patientEmail = session.collected_email
  const serviceType = normalizeServiceType(session.collected_service_type)
  const formattedDate = formatDisplayDate(appointmentDate)

  const availability = await checkAvailabilityForBookingSession(supabase, session)

  if (availability.status === 'invalid' || availability.status === 'unavailable' || availability.status === 'no_doctor') {
    await updateBookingSession(supabase, session.id, {
      availability_status: availability.status,
      availability_checked_at: new Date().toISOString(),
      availability_doctor_id: availability.doctor?.id ?? null,
      availability_alternatives: availability.alternatives,
      held_slot_id: null,
    })
    return {
      response: availability.alternatives.length > 0
        ? buildUnavailableSlotMessage(availability)
        : `${availability.patientMessage}\n\nPlease send another date/time or reply NO to cancel.`,
      completed: false,
      sentiment: 'neutral',
    }
  }

  const requestState = buildPendingWhatsAppBookingRequestState({
    doctorPreference: session.collected_doctor_preference ?? 'Any available doctor',
  })
  const notificationPlan = getWhatsAppBookingCreationNotificationPlan()
  const doctorName = 'To be assigned'
  const calendarStatusBeforeInsert = requestState.calendarSyncStatus
  const calendarErrorBeforeInsert = requestState.calendarSyncError

  const appointmentId = await createWhatsAppAppointmentWithLock(supabase, {
    patientId: session.patient_id,
    doctorId: requestState.doctorId,
    bookingSessionId: session.id,
    heldSlotId: requestState.heldSlotId,
    appointmentDate,
    appointmentTime,
    center,
    serviceType,
    reason: requestState.reason,
    status: requestState.status,
    calendarSyncStatus: requestState.calendarSyncStatus,
    calendarSyncError: requestState.calendarSyncError,
  })

  if (!appointmentId) {
    const refreshedAvailability = await checkAvailabilityForBookingSession(supabase, session)
    await updateBookingSession(supabase, session.id, {
      availability_status: refreshedAvailability.status,
      availability_checked_at: new Date().toISOString(),
      availability_alternatives: refreshedAvailability.alternatives,
      held_slot_id: null,
    })
    return {
      response: refreshedAvailability.alternatives.length > 0
        ? buildUnavailableSlotMessage(refreshedAvailability)
        : 'That time was just taken by another appointment. Please send another date/time and I will check again.',
      completed: false,
      sentiment: 'neutral',
    }
  }

  await releaseSlotHold(supabase, session.held_slot_id ?? null)
  const status: 'pending' = requestState.status
  const calendarStatus = calendarStatusBeforeInsert
  const calendarError = calendarErrorBeforeInsert

  const patientUpdates: Record<string, string> = {}
  if (session.collected_name) patientUpdates.name = session.collected_name
  if (session.collected_sex) patientUpdates.gender = session.collected_sex
  if (session.collected_location) patientUpdates.location = session.collected_location
  if (patientEmail) patientUpdates.email = patientEmail
  if (Object.keys(patientUpdates).length > 0) {
    await supabase.from('patients').update(patientUpdates).eq('id', session.patient_id)
  }

  if (notificationPlan.notifyStaffRequest) {
    await notifyStaffOfBookedAppointment(supabase, {
      appointmentId,
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
      assignedDoctor: null,
      doctorPreference: session.collected_doctor_preference ?? 'Any available doctor',
      calendarStatus,
      calendarError,
    })
  }

  console.log(`[ai-assistant] Booking ${status}: ${patientName} on ${appointmentDate} at ${appointmentTime} (${center})`)

  return {
    response: `Thank you. Your appointment request has been received.\n\nName: ${patientName}\nService: ${serviceType}\nPreferred date: ${formattedDate}\nPreferred time: ${appointmentTime.slice(0, 5)}\nCenter: ${center}\nDoctor preference: ${session.collected_doctor_preference ?? 'Any available doctor'}\n\nOur team will confirm the exact slot shortly. For urgent help, call +234 806 219 7384.`,
    completed: true,
    sentiment: 'positive',
  }
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
        const staffSend = await sendStaffWhatsAppNotification({
          kind: 'booking_request',
          to: recipient.phone,
          text: whatsappBody,
          bodyParameters: buildStaffBookingTemplateParameters({ ...params, dashboardUrl, recipient }),
        })
        await logAppointmentNotification(supabase, {
          patientId: params.patientId,
          appointmentId: params.appointmentId,
          channel: 'whatsapp',
          message: staffSend.messageContent,
          status: 'sent',
          externalMessageId: staffSend.externalMessageId,
          templateName: staffSend.templateName,
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
          templateName: staffTemplateName('booking_request') ?? 'booking_request_freeform',
          recipientRole: recipient.role,
          recipientName: recipient.name,
          recipientPhone: recipient.phone,
        })
      }
    }
  }

  if (params.status === 'confirmed' && Deno.env.get('BOOKING_NOTIFY_EMAIL_ENABLED') !== 'false') {
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

function buildStaffBookingTemplateParameters(params: {
  patientName: string
  patientPhone: string
  serviceType: string
  formattedDate: string
  appointmentTime: string
  center: string
  doctorName: string
  dashboardUrl: string | null
}): string[] {
  return [
    params.patientName,
    params.patientPhone || 'Not provided',
    params.serviceType,
    params.formattedDate,
    params.appointmentTime.slice(0, 5),
    params.center,
    params.doctorName,
    params.dashboardUrl ?? 'Open the dashboard',
  ]
}

function formatCalendarStatusForStaff(status: string | null): string {
  switch (status) {
    case 'synced':
      return 'Synced with Google Calendar.'
    case 'checked_available':
      return 'Availability checked. Calendar event is not synced yet.'
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
  const appointmentPath = `/dashboard/appointments?appointment=${encodeURIComponent(appointmentId)}`
  return `${baseUrl.replace(/\/+$/, '')}/auth/login?next=${encodeURIComponent(appointmentPath)}`
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
    case BOOKING_STEPS.EMAIL: return 'What email should we send confirmation to? Reply SKIP if none.'
    case BOOKING_STEPS.CENTER: return 'Which center do you prefer: Karu or Galadimawa?'
    case BOOKING_STEPS.CONFIRM: return buildBookingSummary(session)
    default: return FIRST_BOOKING_PROMPT
  }
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

  return matchPreferredDoctor(preference, data as DoctorContact[])
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
    console.error(`[ai-assistant] WhatsApp text send failed for ${context}:`, err)
  }
}

async function sendPatientReply(
  supabase: ReturnType<typeof getSupabaseClient>,
  to: string,
  text: string,
  inboundMessageType: string | null,
  route: PatientReplyRoute,
  context: string,
): Promise<void> {
  const result = await sendPatientReplyWithDeps({
    to,
    text,
    inboundMessageType,
    route,
    deps: {
      sendText: (recipient, message) => sendTextMessageSafely(recipient, message, context),
      synthesizeSpeech: synthesizeSpeechForWhatsApp,
      sendAudio: sendAudioMessage,
      trackUsage: (provider, costUsd) => trackApiUsage(supabase, provider, costUsd),
    },
  })

  if (result.audioMessageId) {
    console.log(`[ai-assistant] WhatsApp audio reply sent for ${context}: ${result.audioMessageId}`)
  }

  if (result.audioError) {
    console.error(`[ai-assistant] WhatsApp audio reply failed for ${context}:`, result.audioError)
  }
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
