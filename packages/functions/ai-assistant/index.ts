/**
 * AI Assistant Edge Function
 *
 * Picks up queued messages from message_queue and processes them:
 * 1. Check NDPR consent — if not given, ask for it first
 * 2. Download and transcribe voice notes via Deepgram (PII redacted)
 * 3. Check if this is a feedback reply → save rating, skip AI
 * 4. Detect emergency keywords → abort booking session if active
 * 5. Build conversation history and call NVIDIA AI (Dr Ade)
 * 6. Detect/update booking session state
 * 7. Save conversation to DB
 * 8. Send AI response back via WhatsApp
 * 9. If emergency: trigger emergency-alert function
 *
 * Called by pg_cron every 1 minute OR directly via Supabase scheduled trigger.
 * Processes up to 5 queued messages per invocation to stay within CPU budget.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import {
  getSupabaseClient,
  getConversationHistory,
  saveConversation,
  recordConsent,
  trackApiUsage,
} from '../_shared/supabase.ts'
import {
  sendTextMessage,
  sendAppointmentConfirmation,
  downloadMedia,
} from '../_shared/whatsapp.ts'
import {
  sendAppointmentConfirmationEmail,
} from '../_shared/email.ts'
import {
  callDrAde,
  detectEmergency,
  buildConsentMessage,
  isConsentResponse,
} from '../_shared/nvidia-ai.ts'
import {
  transcribeAudio,
  redactPII,
  parseFeedbackRating,
} from '../_shared/deepgram.ts'
import {
  createAppointmentEvent,
} from '../_shared/calendar.ts'
import type {
  AIMessage,
  BookingSessionRow,
  PatientRow,
} from '../_shared/types.ts'
import { BOOKING_STEPS } from '../_shared/types.ts'

const BATCH_SIZE = 5

const CENTER_ADDRESSES: Record<string, string> = {
  Karu: 'No. 11 Ali Amodu Close (behind CBN Quarters), Karu, Abuja',
  Galadimawa: 'No. 10 Royal Homes Estate, Galadinmawa, Abuja',
}

serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authHeader?.includes(serviceKey?.slice(0, 20) ?? '')) {
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET')
    if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const supabase = getSupabaseClient()
  let processed = 0
  let errors = 0

  const { data: queuedMessages } = await supabase
    .from('message_queue')
    .select('*')
    .eq('status', 'queued')
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (!queuedMessages || queuedMessages.length === 0) {
    return Response.json({ processed: 0, message: 'No queued messages' })
  }

  for (const queueItem of queuedMessages) {
    await supabase.from('message_queue').update({ status: 'processing' }).eq('id', queueItem.id)

    try {
      await processMessage(supabase, queueItem)
      await supabase.from('message_queue').update({ status: 'completed' }).eq('id', queueItem.id)
      processed++
    } catch (err) {
      const error = err as Error
      console.error(`[ai-assistant] Failed queue item ${queueItem.id}:`, error.message)

      const retryCount = (queueItem.retry_count ?? 0) + 1
      if (retryCount >= 3) {
        await supabase.from('message_queue').update({ status: 'dead_letter', last_error: error.message, retry_count: retryCount }).eq('id', queueItem.id)
      } else {
        const backoffMs = Math.pow(2, retryCount - 1) * 1000
        await supabase.from('message_queue').update({
          status: 'queued',
          last_error: error.message,
          retry_count: retryCount,
          next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
        }).eq('id', queueItem.id)
      }
      errors++
    }
  }

  return Response.json({ processed, errors, total: queuedMessages.length })
})

async function processMessage(
  supabase: ReturnType<typeof getSupabaseClient>,
  queueItem: Record<string, unknown>,
): Promise<void> {
  const phoneNumber = queueItem.phone_number as string
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

  // ── Feedback reply detection ──────────────────────────────────────────────
  // Check BEFORE calling AI — if patient is responding to feedback request,
  // save the rating and thank them without burning an NVIDIA API call.
  const feedbackHandled = await detectAndHandleFeedbackReply(supabase, patientId, phoneNumber, messageText ?? '', whatsappMessageId)
  if (feedbackHandled) return

  // ── Emergency detection ───────────────────────────────────────────────────
  const emergencyCheck = detectEmergency(messageText ?? '')

  // ── Check active booking session ─────────────────────────────────────────
  const { data: activeBooking } = await supabase
    .from('booking_sessions')
    .select('*')
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .single() as { data: BookingSessionRow | null }

  // ── CRITICAL: Abort booking on crisis ────────────────────────────────────
  if (emergencyCheck.isEmergency && activeBooking) {
    await supabase.from('booking_sessions')
      .update({ status: 'abandoned', last_message_at: new Date().toISOString() })
      .eq('id', activeBooking.id)
    console.log(`[ai-assistant] Booking session ${activeBooking.id} abandoned — emergency detected`)
  }

  // ── Build conversation history for AI ────────────────────────────────────
  const history = await getConversationHistory(supabase, patientId, 8)

  const systemAddendum = (activeBooking && !emergencyCheck.isEmergency)
    ? buildBookingContext(activeBooking)
    : ''

  const messages: AIMessage[] = [
    ...(systemAddendum ? [{ role: 'system' as const, content: systemAddendum }] : []),
    ...history,
    { role: 'user', content: messageText ?? '[media]' },
  ]

  // ── Call Dr Ade AI ────────────────────────────────────────────────────────
  const aiResult = await callDrAde(messages, phoneNumber)
  await trackApiUsage(supabase, 'nvidia', 0)

  // ── Emergency response override ───────────────────────────────────────────
  let finalResponse = aiResult.message
  if (emergencyCheck.isEmergency) {
    finalResponse = `${aiResult.message}\n\n🚨 *Emergency Line (24/7): +234 806 219 7384*\n\nPlease call us now or come in immediately. You are not alone.`
  }

  // ── Update booking session state (only if no emergency) ──────────────────
  if (activeBooking && !emergencyCheck.isEmergency && messageText) {
    await advanceBookingSession(supabase, activeBooking, messageText, phoneNumber, patient)
  } else if (!emergencyCheck.isEmergency && isBookingIntent(messageText ?? '')) {
    await supabase.from('booking_sessions').insert({
      patient_id: patientId,
      status: 'active',
      current_step: 0,
      last_message_at: new Date().toISOString(),
    })
  }

  // ── Save conversation ─────────────────────────────────────────────────────
  const conversationId = await saveConversation(supabase, {
    patientId,
    messageType,
    patientMessage: messageText,
    patientMessageRedacted: messageRedacted,
    aiResponse: finalResponse,
    mediaUrl: queueItem.media_url as string | null,
    sentiment: aiResult.sentiment,
    hasEmergencyKeywords: emergencyCheck.isEmergency,
    whatsappMessageId,
    transcription,
    transcriptionRedacted,
  })

  // ── Send AI response ──────────────────────────────────────────────────────
  await sendTextMessage(phoneNumber, finalResponse)

  // ── Trigger emergency alert ───────────────────────────────────────────────
  if (emergencyCheck.isEmergency) {
    await triggerEmergencyAlert(supabase, {
      patientId,
      conversationId,
      phoneNumber,
      patientName: patient.name ?? 'Unknown',
      alertType: emergencyCheck.alertType!,
      severity: emergencyCheck.severity!,
      keywords: emergencyCheck.keywordsFound,
      messageSnippet: (messageText ?? '').slice(0, 200),
    })
  }
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

/**
 * Build context string for AI when patient is mid-booking.
 */
function buildBookingContext(session: BookingSessionRow): string {
  const collected = [
    session.collected_name ? `Name: ${session.collected_name}` : null,
    session.collected_sex ? `Sex: ${session.collected_sex}` : null,
    session.collected_location ? `Location: ${session.collected_location}` : null,
    session.collected_service_type ? `Service: ${session.collected_service_type}` : null,
    session.collected_doctor_preference ? `Doctor preference: ${session.collected_doctor_preference}` : null,
    session.collected_date ? `Preferred date: ${session.collected_date}` : null,
    session.collected_time ? `Preferred time: ${session.collected_time}` : null,
    session.collected_center ? `Center: ${session.collected_center}` : null,
  ].filter(Boolean).join('\n')

  const stepNames = ['name', 'sex', 'location', 'service type', 'doctor preference', 'date', 'time', 'center', 'confirmation']
  const nextStep = stepNames[session.current_step] ?? 'unknown'

  return `[BOOKING IN PROGRESS — Step ${session.current_step + 1}/9]
Collected so far:
${collected || '(nothing yet)'}

Next: Ask for the patient's ${nextStep}.
If the patient provides it in this message, extract it and ask for the next field.
Do not restart the booking flow — continue from where we left off.`
}

function isBookingIntent(message: string): boolean {
  const lower = message.toLowerCase()
  return ['book', 'appointment', 'schedule', 'see a doctor', 'visit', 'consultation', 'reserve'].some((kw) => lower.includes(kw))
}

/**
 * Advance the booking session state machine.
 * On confirmation: create appointment, send WhatsApp + email confirmations.
 */
async function advanceBookingSession(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: BookingSessionRow,
  userMessage: string,
  phoneNumber: string,
  patient: Pick<PatientRow, 'id' | 'name'> & { email?: string },
): Promise<void> {
  const updates: Partial<BookingSessionRow> = { last_message_at: new Date().toISOString() }
  const msg = userMessage.trim()

  switch (session.current_step) {
    case BOOKING_STEPS.NAME:
      updates.collected_name = msg
      updates.current_step = BOOKING_STEPS.SEX
      break
    case BOOKING_STEPS.SEX:
      updates.collected_sex = msg
      updates.current_step = BOOKING_STEPS.LOCATION
      break
    case BOOKING_STEPS.LOCATION:
      updates.collected_location = msg
      updates.current_step = BOOKING_STEPS.SERVICE_TYPE
      break
    case BOOKING_STEPS.SERVICE_TYPE:
      updates.collected_service_type = msg
      updates.current_step = BOOKING_STEPS.DOCTOR
      break
    case BOOKING_STEPS.DOCTOR:
      updates.collected_doctor_preference = msg
      updates.current_step = BOOKING_STEPS.DATE
      break
    case BOOKING_STEPS.DATE:
      updates.collected_date = extractDate(msg)
      updates.current_step = BOOKING_STEPS.TIME
      break
    case BOOKING_STEPS.TIME:
      updates.collected_time = extractTime(msg)
      updates.current_step = BOOKING_STEPS.CENTER
      break
    case BOOKING_STEPS.CENTER:
      updates.collected_center = msg.toLowerCase().includes('karu') ? 'Karu' : 'Galadimawa'
      updates.current_step = BOOKING_STEPS.CONFIRM
      break
    case BOOKING_STEPS.CONFIRM: {
      const confirmed = ['yes', 'confirm', 'book it', 'proceed', 'ok', 'okay', 'sure', 'yes please'].some((w) => msg.toLowerCase().includes(w))
      if (confirmed) {
        await finalizeBooking(supabase, session, phoneNumber, patient)
        await supabase.from('booking_sessions').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', session.id)
      } else {
        await supabase.from('booking_sessions').update({ status: 'abandoned' }).eq('id', session.id)
      }
      return
    }
  }

  await supabase.from('booking_sessions').update(updates).eq('id', session.id)
}

/**
 * Create appointment in DB + Google Calendar, then send confirmation via WhatsApp template + email.
 */
async function finalizeBooking(
  supabase: ReturnType<typeof getSupabaseClient>,
  session: BookingSessionRow,
  phoneNumber: string,
  patient: Pick<PatientRow, 'id' | 'name'> & { email?: string },
): Promise<void> {
  const { data: doctor } = await supabase
    .from('doctors')
    .select('id, name')
    .ilike('name', `%${session.collected_doctor_preference ?? 'Adesina'}%`)
    .eq('is_active', true)
    .single()

  const appointmentDate = session.collected_date ?? new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0]
  const appointmentTime = session.collected_time ?? '09:00'
  const center = session.collected_center ?? 'Galadimawa'
  const patientName = session.collected_name ?? patient.name ?? 'Patient'
  const serviceType = session.collected_service_type ?? 'Consultation'
  const doctorName = doctor?.name ?? 'Dr. Kunle Adesina'
  const formattedDate = new Date(appointmentDate + 'T00:00:00').toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // Create Google Calendar event (non-fatal if fails)
  let calendarEventId: string | null = null
  try {
    calendarEventId = await createAppointmentEvent({ patientName, patientPhone: phoneNumber, doctorName, serviceType, center, appointmentDate, appointmentTime, reason: 'Booked via WhatsApp' })
  } catch (err) {
    console.error('[ai-assistant] Google Calendar creation failed:', err)
  }

  // Insert appointment record
  await supabase.from('appointments').insert({
    patient_id: session.patient_id,
    doctor_id: doctor?.id ?? null,
    appointment_date: appointmentDate,
    appointment_time: appointmentTime,
    center,
    service_type: serviceType,
    reason: 'Booked via WhatsApp AI',
    status: 'confirmed',
    google_calendar_event_id: calendarEventId,
  })

  // Update patient name if collected
  if (session.collected_name) {
    await supabase.from('patients').update({ name: session.collected_name }).eq('id', session.patient_id)
  }

  // ── Send WhatsApp confirmation template ───────────────────────────────────
  try {
    await sendAppointmentConfirmation(
      phoneNumber.replace('+', ''),
      patientName,
      formattedDate,
      appointmentTime.slice(0, 5),
      center,
      doctorName,
      serviceType,
    )
  } catch (err) {
    console.error('[ai-assistant] WhatsApp confirmation template failed:', err)
    // Fallback to plain text
    await sendTextMessage(phoneNumber,
      `✅ *Appointment Confirmed!*\n\n` +
      `📅 Date: ${formattedDate}\n` +
      `🕐 Time: ${appointmentTime.slice(0, 5)}\n` +
      `🏥 Center: ${center}\n` +
      `👨‍⚕️ Doctor: ${doctorName}\n` +
      `📋 Service: ${serviceType}\n\n` +
      `Please arrive 10-15 minutes early. To reschedule, send us a message. 📞 +234 806 219 7384`
    )
  }

  // ── Send email confirmation if patient has email ───────────────────────────
  if (patient.email) {
    sendAppointmentConfirmationEmail({
      patientEmail: patient.email,
      patientName,
      appointmentDate: formattedDate,
      appointmentTime: appointmentTime.slice(0, 5),
      center,
      centerAddress: CENTER_ADDRESSES[center] ?? center,
      doctorName,
      serviceType,
    }).catch((err) => console.error('[ai-assistant] Email confirmation failed:', err))
  }

  console.log(`[ai-assistant] Booking finalized: ${patientName} on ${appointmentDate} at ${appointmentTime} (${center})`)
}

async function triggerEmergencyAlert(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: {
    patientId: string
    conversationId: string
    phoneNumber: string
    patientName: string
    alertType: 'suicidal' | 'self_harm' | 'drug_overdose' | 'panic_attack'
    severity: 'critical' | 'high' | 'medium'
    keywords: string[]
    messageSnippet: string
  },
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return

  fetch(`${supabaseUrl}/functions/v1/emergency-alert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch((err) => console.error('[ai-assistant] Failed to trigger emergency alert:', err))
}

function extractDate(text: string): string {
  const iso = text.match(/\d{4}-\d{2}-\d{2}/)
  if (iso) return iso[0]
  const dmy = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (dmy) {
    const [, d, m, y] = dmy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0]
}

function extractTime(text: string): string {
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!timeMatch) return '09:00'
  let hour = parseInt(timeMatch[1], 10)
  const minute = parseInt(timeMatch[2] ?? '0', 10)
  const period = timeMatch[3]?.toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
