/**
 * Emergency Alert Edge Function
 *
 * Triggered by ai-assistant when crisis keywords are detected.
 * Responsibilities:
 * 1. Deduplication — same patient + alert type within 10 minutes = 1 alert
 * 2. Create emergency_alerts record
 * 3. Send multi-channel notifications: WhatsApp (admin), Email, SMS (Twilio)
 * 4. Escalation timeout cascade (5min → 10min → 15min) via pg_cron
 *
 * All channels fire in parallel for maximum response speed.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, isAuthorizedInternalRequest } from '../_shared/supabase.ts'
import { sendTextMessage } from '../_shared/whatsapp.ts'
import { sendEmergencyAlertEmail } from '../_shared/email.ts'

interface EmergencyPayload {
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
}

const HOSPITAL_EMAIL = Deno.env.get('HOSPITAL_EMAIL') ?? 'info@serenityroyalehospital.com'

type EmergencyRecipient = {
  role: 'operations_manager' | 'primary_doctor' | 'assigned_doctor'
  name: string
  phone: string
}

serve(async (req: Request) => {
  if (!isAuthorizedInternalRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const payload: EmergencyPayload = await req.json()
  const supabase = getSupabaseClient()
  const startTime = Date.now()

  // ── Deduplication ─────────────────────────────────────────────────────────
  // Same patient + same alert type within 10 minutes = suppress duplicate
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  const { data: existing } = await supabase
    .from('emergency_alerts')
    .select('id, escalation_level')
    .eq('patient_id', payload.patientId)
    .eq('alert_type', payload.alertType)
    .gte('created_at', tenMinutesAgo)
    .is('resolved_at', null)
    .single()

  if (existing) {
    console.log(`[emergency-alert] Duplicate alert suppressed for patient ${payload.patientId} (existing: ${existing.id})`)
    return Response.json({ suppressed: true, existingAlertId: existing.id })
  }

  // ── Create alert record ───────────────────────────────────────────────────
  const { data: alert, error: alertError } = await supabase
    .from('emergency_alerts')
    .insert({
      patient_id: payload.patientId,
      conversation_id: payload.conversationId,
      alert_type: payload.alertType,
      keywords_detected: payload.keywords,
      severity: payload.severity,
      alert_message: payload.messageSnippet,
      escalation_level: 1,
    })
    .select('id')
    .single()

  if (alertError || !alert) {
    console.error('[emergency-alert] Failed to create alert record:', alertError?.message)
    return Response.json({ error: 'Failed to create alert' }, { status: 500 })
  }

  console.log(`[emergency-alert] Alert ${alert.id} created for patient ${payload.patientId} — ${payload.alertType} (${payload.severity})`)

  const timestamp = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) + ' WAT'
  const alertTypeDisplay = payload.alertType.replace('_', ' ').toUpperCase()

  // ── Multi-channel notification — WhatsApp + email immediately ─────────────
  // SMS remains reserved for escalation fallback in escalation-check.
  const whatsappRecipients = getEmergencyRecipients(payload)
  const notifications = await Promise.allSettled([
    // 1. WhatsApp to operations, primary doctor, and selected doctor when known
    Promise.all(whatsappRecipients.map((recipient) => notifyWhatsApp(recipient, payload, alertTypeDisplay, timestamp)
      .then(async (sid) => {
        await logEmergencyNotification(supabase, {
          patientId: payload.patientId,
          emergencyAlertId: alert.id,
          recipient,
          message: `Emergency WhatsApp sent to ${recipient.name}`,
          status: 'sent',
          externalMessageId: sid,
        })
      })
      .catch(async (err) => {
        const failure = notificationFailureFromError(err)
        await logEmergencyNotification(supabase, {
          patientId: payload.patientId,
          emergencyAlertId: alert.id,
          recipient,
          message: `Emergency WhatsApp failed for ${recipient.name}`,
          status: failure.status,
          errorMessage: failure.message,
        })
        throw err
      }))).then(async () => {
      await supabase
        .from('emergency_alerts')
        .update({ whatsapp_notified_at: new Date().toISOString() })
        .eq('id', alert.id)
    }),

    // 2. Email to hospital team
    sendEmergencyAlertEmail({
      patientName: payload.patientName,
      patientPhone: payload.phoneNumber,
      alertType: payload.alertType,
      severity: payload.severity,
      keywords: payload.keywords,
      messageSnippet: payload.messageSnippet,
      timestamp,
    }).then(async () => {
      await supabase.from('notifications').insert({
        patient_id: payload.patientId,
        emergency_alert_id: alert.id,
        notification_type: 'emergency_alert',
        channel: 'email',
        template_name: 'emergency_alert',
        message_content: `Emergency email sent for ${payload.patientName || payload.phoneNumber}`,
        status: 'sent',
        sent_at: new Date().toISOString(),
        recipient_role: 'staff_email',
        recipient_name: 'Hospital emergency email recipients',
      })
      await supabase
        .from('emergency_alerts')
        .update({ email_notified_at: new Date().toISOString() })
        .eq('id', alert.id)
    }).catch(async (err) => {
      await supabase.from('notifications').insert({
        patient_id: payload.patientId,
        emergency_alert_id: alert.id,
        notification_type: 'emergency_alert',
        channel: 'email',
        template_name: 'emergency_alert',
        message_content: `Emergency email failed for ${payload.patientName || payload.phoneNumber}`,
        status: 'failed',
        error_message: (err as Error).message,
        recipient_role: 'staff_email',
        recipient_name: 'Hospital emergency email recipients',
      })
      throw err
    }),
  ])

  // Log notification results
  const results = {
    whatsapp: notifications[0].status === 'fulfilled',
    email: notifications[1].status === 'fulfilled',
    sms: 'reserved_for_escalation',
  }

  const channelNames = ['whatsapp', 'email']
  for (let i = 0; i < notifications.length; i++) {
    const settled = notifications[i]
    if (settled.status === 'rejected') {
      console.error(`[emergency-alert] ${channelNames[i]} notification failed:`, settled.reason)
    }
  }

  // Track response time
  const responseTimeMs = Date.now() - startTime
  await supabase
    .from('emergency_alerts')
    .update({ response_time_ms: responseTimeMs })
    .eq('id', alert.id)

  // ── Schedule escalation checks ─────────────────────────────────────────────
  // pg_cron will check for unacknowledged alerts at 5min, 10min, 15min
  // The escalation logic runs in the escalation-check function (triggered by pg_cron)
  // Storing alert ID in a way pg_cron can find it by querying unacknowledged alerts

  return Response.json({
    alertId: alert.id,
    notifications: results,
    responseTimeMs,
  })
})

/**
 * Send WhatsApp notification to hospital admin.
 */
async function notifyWhatsApp(
  recipient: EmergencyRecipient,
  payload: EmergencyPayload,
  alertTypeDisplay: string,
  timestamp: string,
): Promise<string> {
  const message = `🚨 *EMERGENCY ALERT — ${alertTypeDisplay}*

*Recipient:* ${recipient.name} (${recipient.role.replace('_', ' ')})
*Patient:* ${payload.patientName || 'Unknown'}
*Phone:* ${payload.phoneNumber}
*Severity:* ${payload.severity.toUpperCase()}
*Keywords:* ${payload.keywords.join(', ')}
*Time:* ${timestamp}

*Message snippet:*
_"${payload.messageSnippet.slice(0, 150)}"_

⚠️ Immediate action required. Log in to admin dashboard to acknowledge.
👉 Call patient: ${payload.phoneNumber}`

  return await sendTextMessage(recipient.phone, message)
}

function getEmergencyRecipients(payload: EmergencyPayload): EmergencyRecipient[] {
  const operationsPhone = Deno.env.get('OPERATIONS_MANAGER_WHATSAPP') ?? '+2348072023652'
  const operationsName = Deno.env.get('OPERATIONS_MANAGER_NAME') ?? 'Abdullahi Rahinatu'
  const primaryPhone = Deno.env.get('PRIMARY_DOCTOR_WHATSAPP') ??
    Deno.env.get('HOSPITAL_MD_WHATSAPP') ??
    Deno.env.get('HOSPITAL_MD_PHONE') ??
    Deno.env.get('HOSPITAL_PHONE_PRIMARY') ??
    '+2348062197384'
  const primaryName = Deno.env.get('PRIMARY_DOCTOR_NAME') ?? 'Dr. Adekunle Adesina'

  const recipients: EmergencyRecipient[] = [
    { role: 'operations_manager', name: operationsName, phone: operationsPhone },
    { role: 'primary_doctor', name: primaryName, phone: primaryPhone },
  ]

  if (payload.assignedDoctorPhone && !isSamePhone(payload.assignedDoctorPhone, operationsPhone) && !isSamePhone(payload.assignedDoctorPhone, primaryPhone)) {
    recipients.push({
      role: 'assigned_doctor',
      name: payload.assignedDoctorName ?? 'Assigned doctor',
      phone: payload.assignedDoctorPhone,
    })
  }

  return recipients
}

function isSamePhone(a: string, b: string): boolean {
  return a.replace(/\D/g, '') === b.replace(/\D/g, '')
}

async function logEmergencyNotification(
  supabase: ReturnType<typeof getSupabaseClient>,
  params: {
    patientId: string
    emergencyAlertId: string
    recipient: EmergencyRecipient
    message: string
    status: 'sent' | 'pending' | 'failed'
    externalMessageId?: string
    errorMessage?: string
  },
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    patient_id: params.patientId,
    emergency_alert_id: params.emergencyAlertId,
    notification_type: 'emergency_alert',
    channel: 'whatsapp',
    template_name: 'emergency_alert',
    message_content: params.message.slice(0, 2000),
    status: params.status,
    external_message_id: params.externalMessageId ?? null,
    error_message: params.errorMessage ?? null,
    sent_at: params.status === 'sent' ? new Date().toISOString() : null,
    recipient_role: params.recipient.role,
    recipient_name: params.recipient.name,
    recipient_phone: params.recipient.phone,
  })

  if (error) console.error('[emergency-alert] notification log failed:', error.message)
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
