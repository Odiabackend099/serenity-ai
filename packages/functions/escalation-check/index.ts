/**
 * Escalation Check Edge Function
 *
 * Called by pg_cron every 5 minutes.
 * Finds unacknowledged emergency alerts and escalates through 3 levels:
 *
 * Level 1 → Level 2 (at 5 min): SMS reminder to hospital admin phone
 * Level 2 → Level 3 (at 10 min): WhatsApp + SMS to backup on-call doctor
 * Level 3+ (at 15 min): Log to escalated_to = 'switchboard', flag for manual followup
 *
 * Stops escalating once alert is acknowledged or resolved.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, isAuthorizedInternalRequest } from '../_shared/supabase.ts'
import { sendTextMessage } from '../_shared/whatsapp.ts'

const HOSPITAL_PHONE = Deno.env.get('HOSPITAL_PHONE_PRIMARY') ?? '+2348062197384'
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
const TWILIO_FROM = Deno.env.get('TWILIO_PHONE_NUMBER')

serve(async (req: Request) => {
  if (!isAuthorizedInternalRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = getSupabaseClient()
  const now = new Date()

  // Find unacknowledged, unresolved alerts
  const { data: alerts } = await supabase
    .from('emergency_alerts')
    .select('id, patient_id, alert_type, severity, escalation_level, created_at, patients(name, phone_number)')
    .is('acknowledged_at', null)
    .is('resolved_at', null)
    .order('created_at', { ascending: true })

  if (!alerts || alerts.length === 0) {
    return Response.json({ checked: 0, escalated: 0 })
  }

  let escalated = 0

  for (const alert of alerts) {
    const ageMinutes = (now.getTime() - new Date(alert.created_at).getTime()) / 60000
    const patient = alert.patients as { name?: string; phone_number?: string } | null
    const patientName = patient?.name ?? 'Unknown Patient'
    const patientPhone = patient?.phone_number ?? 'Unknown'
    const alertType = (alert.alert_type ?? 'crisis').replace('_', ' ').toUpperCase()

    // ── Level 1 → 2 (5 minutes, no acknowledgment) ────────────────────────
    if (ageMinutes >= 5 && ageMinutes < 10 && alert.escalation_level < 2) {
      try {
        await sendSms(
          HOSPITAL_PHONE,
          `⚠️ ESCALATION L2: Emergency alert for ${patientName} (${alertType}) has NOT been acknowledged for 5+ minutes. Call: ${patientPhone}. Log into admin dashboard immediately.`
        )

        await supabase.from('emergency_alerts').update({
          escalation_level: 2,
          escalated_to: 'admin_sms_reminder',
        }).eq('id', alert.id)

        console.log(`[escalation-check] Alert ${alert.id} escalated to level 2 (age: ${ageMinutes.toFixed(1)} min)`)
        escalated++
      } catch (err) {
        console.error(`[escalation-check] Level 2 escalation failed for ${alert.id}:`, err)
      }
    }

    // ── Level 2 → 3 (10 minutes, still no acknowledgment) ────────────────
    else if (ageMinutes >= 10 && ageMinutes < 15 && alert.escalation_level < 3) {
      try {
        // Find on-call backup doctor
        const { data: onCall } = await supabase
          .from('on_call_schedule')
          .select('doctors(name, phone)')
          .eq('is_primary', false)
          .lte('start_date', now.toISOString().split('T')[0])
          .gte('end_date', now.toISOString().split('T')[0])
          .limit(1)
          .single()

        const backupDoctor = (onCall?.doctors as { name?: string; phone?: string } | null)
        const backupPhone = backupDoctor?.phone ?? HOSPITAL_PHONE
        const backupName = backupDoctor?.name ?? 'Backup Doctor'

        // WhatsApp to backup doctor
        const waPhone = backupPhone.replace('+', '')
        await sendTextMessage(waPhone,
          `🚨 *URGENT ESCALATION — 10 MINUTES UNACKNOWLEDGED*\n\nEmergency alert for *${patientName}* (${alertType}) has NOT been acknowledged for 10 minutes.\n\n📞 Patient phone: ${patientPhone}\n⚠️ Severity: ${(alert.severity ?? 'HIGH').toUpperCase()}\n\nPlease take immediate action and log into the admin dashboard.`
        )

        // Also SMS
        await sendSms(backupPhone,
          `SERENITY ESCALATION L3: ${alertType} for ${patientName} UNACKNOWLEDGED 10+ MIN. Patient: ${patientPhone}. Take action NOW.`
        )

        await supabase.from('emergency_alerts').update({
          escalation_level: 3,
          escalated_to: backupName,
        }).eq('id', alert.id)

        console.log(`[escalation-check] Alert ${alert.id} escalated to level 3 → ${backupName} (age: ${ageMinutes.toFixed(1)} min)`)
        escalated++
      } catch (err) {
        console.error(`[escalation-check] Level 3 escalation failed for ${alert.id}:`, err)
      }
    }

    // ── Level 3+ (15+ minutes, maximum escalation) ───────────────────────
    else if (ageMinutes >= 15 && alert.escalation_level < 4) {
      try {
        // Final escalation: notify switchboard and log
        await sendSms(
          HOSPITAL_PHONE,
          `🚨 CRITICAL: Emergency alert for ${patientName} (${alertType}) has NOT been acknowledged for 15+ minutes. CALL SWITCHBOARD AND TAKE MANUAL ACTION. Patient: ${patientPhone}`
        )

        await supabase.from('emergency_alerts').update({
          escalation_level: 4,
          escalated_to: 'switchboard_manual_required',
        }).eq('id', alert.id)

        console.log(`[escalation-check] Alert ${alert.id} at level 4 — manual intervention required (age: ${ageMinutes.toFixed(1)} min)`)
        escalated++
      } catch (err) {
        console.error(`[escalation-check] Level 4 escalation failed for ${alert.id}:`, err)
      }
    }
  }

  return Response.json({ checked: alerts.length, escalated })
})

async function sendSms(to: string, body: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
    console.warn('[escalation-check] Twilio not configured — SMS skipped')
    return
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio SMS failed: ${err}`)
  }
}
