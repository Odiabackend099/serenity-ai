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
    .select('id, name, consent_ndpr, email')
    .eq('id', patientId)
    .single() as { data: (Pick<PatientRow, 'id' | 'name' | 'consent_ndpr'> & { email?: string }) | null }

  if (!patient) throw new Error(`Patient ${patientId} not found`)

  const preConsentEmergencyCheck = detectEmergency(messageText ?? '')

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
  const history = await getConversationHistory(supabase, patientId, 8)

  const messages: AIMessage[] = [
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
        await logAppointmentNotification(supabase, {
          patientId: params.patientId,
          appointmentId: params.appointmentId,
          channel: 'whatsapp',
          message: whatsappBody,
          status: 'failed',
          errorMessage: (err as Error).message,
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
    status: 'sent' | 'failed'
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
