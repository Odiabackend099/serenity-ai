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
}

const HOSPITAL_WHATSAPP = Deno.env.get('HOSPITAL_PHONE_PRIMARY') ?? '+2348062197384'
const HOSPITAL_EMAIL = Deno.env.get('HOSPITAL_EMAIL') ?? 'info@serenityroyalehospital.com'

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

  // ── Multi-channel notification — all parallel ─────────────────────────────
  const notifications = await Promise.allSettled([
    // 1. WhatsApp to hospital admin
    notifyWhatsApp(payload, alertTypeDisplay, timestamp).then(async () => {
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
      await supabase
        .from('emergency_alerts')
        .update({ email_notified_at: new Date().toISOString() })
        .eq('id', alert.id)
    }),

    // 3. SMS via Twilio
    sendSmsAlert(payload, alertTypeDisplay).then(async () => {
      await supabase
        .from('emergency_alerts')
        .update({ sms_notified_at: new Date().toISOString() })
        .eq('id', alert.id)
    }),
  ])

  // Log notification results
  const results = {
    whatsapp: notifications[0].status === 'fulfilled',
    email: notifications[1].status === 'fulfilled',
    sms: notifications[2].status === 'fulfilled',
  }

  const channelNames = ['whatsapp', 'email', 'sms']
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
  payload: EmergencyPayload,
  alertTypeDisplay: string,
  timestamp: string,
): Promise<void> {
  const adminPhone = HOSPITAL_WHATSAPP.replace('+', '')

  const message = `🚨 *EMERGENCY ALERT — ${alertTypeDisplay}*

*Patient:* ${payload.patientName || 'Unknown'}
*Phone:* ${payload.phoneNumber}
*Severity:* ${payload.severity.toUpperCase()}
*Keywords:* ${payload.keywords.join(', ')}
*Time:* ${timestamp}

*Message snippet:*
_"${payload.messageSnippet.slice(0, 150)}"_

⚠️ Immediate action required. Log in to admin dashboard to acknowledge.
👉 Call patient: ${payload.phoneNumber}`

  await sendTextMessage(adminPhone, message)
}

/**
 * Send SMS alert via Twilio REST API.
 */
async function sendSmsAlert(payload: EmergencyPayload, alertTypeDisplay: string): Promise<void> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const fromPhone = Deno.env.get('TWILIO_PHONE_NUMBER')
  const toPhone = Deno.env.get('HOSPITAL_PHONE_PRIMARY') ?? HOSPITAL_WHATSAPP

  if (!accountSid || !authToken || !fromPhone) {
    console.warn('[emergency-alert] Twilio not configured — SMS skipped')
    return
  }

  const body = `SERENITY EMERGENCY: ${alertTypeDisplay} alert for ${payload.patientName || payload.phoneNumber}. Call immediately: ${payload.phoneNumber}. Severity: ${payload.severity.toUpperCase()}`

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: fromPhone,
        To: toPhone,
        Body: body,
      }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio SMS failed: ${err}`)
  }
}
