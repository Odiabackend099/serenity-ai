/**
 * Send Notification Edge Function
 *
 * General-purpose notification dispatcher.
 * Uses a discriminated union payload so each type carries only what it needs.
 *
 * Types handled:
 *  - appointment_confirmation  → WhatsApp template + email (requires patientId)
 *  - appointment_cancellation  → Cancel Google Calendar event (requires calendarEventId)
 *  - manual_message            → Send plain text to a phone directly (requires phone + message)
 *  - custom                    → Free-form WhatsApp text to a patient (requires patientId)
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'
import { sendTextMessage, sendAppointmentConfirmation } from '../_shared/whatsapp.ts'
import { sendAppointmentConfirmationEmail } from '../_shared/email.ts'
import { cancelAppointmentEvent } from '../_shared/calendar.ts'

// ── Discriminated union payload ───────────────────────────────────────────────

type AppointmentConfirmationPayload = {
  type: 'appointment_confirmation'
  patientId: string
  appointmentId?: string
  data: {
    appointmentDate: string
    appointmentTime: string
    center: string
    centerAddress?: string
    doctorName: string
    serviceType: string
    smsBody?: string
  }
  channels: ('whatsapp' | 'email' | 'sms')[]
}

type AppointmentCancellationPayload = {
  type: 'appointment_cancellation'
  calendarEventId: string
  // Optional: notify patient too
  patientPhone?: string
  patientName?: string
}

type ManualMessagePayload = {
  type: 'manual_message'
  phone: string   // E.164 without +, e.g. "2348062197384"
  message: string
}

type CustomPayload = {
  type: 'custom'
  patientId: string
  data: { message: string }
}

type NotificationPayload =
  | AppointmentConfirmationPayload
  | AppointmentCancellationPayload
  | ManualMessagePayload
  | CustomPayload

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.includes(serviceKey?.slice(0, 20) ?? '')) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  let payload: NotificationPayload
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── Route by type ─────────────────────────────────────────────────────────

  switch (payload.type) {

    // ── Manual message: send plain text directly to a phone ─────────────────
    case 'manual_message': {
      if (!payload.phone || !payload.message) {
        return Response.json({ error: 'phone and message are required' }, { status: 400 })
      }
      try {
        await sendTextMessage(payload.phone, payload.message)
        return Response.json({ sent: true })
      } catch (err) {
        console.error('[send-notification] manual_message failed:', (err as Error).message)
        return Response.json({ error: (err as Error).message }, { status: 500 })
      }
    }

    // ── Cancel Google Calendar event ─────────────────────────────────────────
    case 'appointment_cancellation': {
      if (!payload.calendarEventId) {
        return Response.json({ cancelled: false, reason: 'no calendarEventId' })
      }
      try {
        await cancelAppointmentEvent(payload.calendarEventId)
        console.log(`[send-notification] Cancelled calendar event ${payload.calendarEventId}`)

        // Optionally notify patient via plain text (inside 24h window only — no template for cancellation)
        if (payload.patientPhone && payload.patientName) {
          const phone = payload.patientPhone.replace('+', '')
          await sendTextMessage(
            phone,
            `Dear ${payload.patientName}, your appointment at Serenity Royale Hospital has been cancelled. Please call us at +234 806 219 7384 to reschedule or for any queries. We apologise for any inconvenience.`,
          ).catch((err) => console.warn('[send-notification] Patient cancellation notify failed (non-fatal):', err.message))
        }

        return Response.json({ cancelled: true })
      } catch (err) {
        console.error('[send-notification] Calendar cancellation failed:', (err as Error).message)
        return Response.json({ cancelled: false, error: (err as Error).message }, { status: 500 })
      }
    }

    // ── Appointment confirmation: WhatsApp template + email ──────────────────
    case 'appointment_confirmation': {
      const supabase = getSupabaseClient()

      const { data: patient } = await supabase
        .from('patients')
        .select('name, phone_number, email')
        .eq('id', payload.patientId)
        .single()

      if (!patient) {
        return Response.json({ error: 'Patient not found' }, { status: 404 })
      }

      const results: Record<string, boolean> = {}
      const d = payload.data

      for (const channel of payload.channels) {
        try {
          switch (channel) {
            case 'whatsapp':
              if (patient.phone_number) {
                await sendAppointmentConfirmation(
                  patient.phone_number.replace('+', ''),
                  patient.name ?? 'Patient',
                  d.appointmentDate,
                  d.appointmentTime,
                  d.center,
                  d.doctorName,
                  d.serviceType,
                )
                results.whatsapp = true
              }
              break

            case 'email':
              if (patient.email) {
                await sendAppointmentConfirmationEmail({
                  patientEmail: patient.email,
                  patientName: patient.name ?? 'Patient',
                  appointmentDate: d.appointmentDate,
                  appointmentTime: d.appointmentTime,
                  center: d.center,
                  centerAddress: d.centerAddress ?? d.center,
                  doctorName: d.doctorName,
                  serviceType: d.serviceType,
                })
                results.email = true
              }
              break

            case 'sms':
              if (patient.phone_number && d.smsBody) {
                await sendTwilioSms(patient.phone_number, d.smsBody)
                results.sms = true
              }
              break
          }

          // Log notification
          if (payload.appointmentId) {
            await supabase.from('notifications').insert({
              patient_id: payload.patientId,
              appointment_id: payload.appointmentId,
              notification_type: payload.type,
              channel,
              status: 'sent',
              sent_at: new Date().toISOString(),
            }).catch(() => {})
          }
        } catch (err) {
          console.error(`[send-notification] ${channel} failed:`, (err as Error).message)
          results[channel] = false

          if (payload.appointmentId) {
            await supabase.from('notifications').insert({
              patient_id: payload.patientId,
              appointment_id: payload.appointmentId,
              notification_type: payload.type,
              channel,
              status: 'failed',
              error_message: (err as Error).message,
            }).catch(() => {})
          }
        }
      }

      return Response.json({ results })
    }

    // ── Custom free-form text to a patient ───────────────────────────────────
    case 'custom': {
      const supabase = getSupabaseClient()

      const { data: patient } = await supabase
        .from('patients')
        .select('phone_number')
        .eq('id', payload.patientId)
        .single()

      if (!patient?.phone_number) {
        return Response.json({ error: 'Patient not found or no phone' }, { status: 404 })
      }

      try {
        await sendTextMessage(patient.phone_number.replace('+', ''), payload.data.message)
        return Response.json({ sent: true })
      } catch (err) {
        return Response.json({ error: (err as Error).message }, { status: 500 })
      }
    }

    default:
      return Response.json({ error: 'Unknown notification type' }, { status: 400 })
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendTwilioSms(to: string, body: string): Promise<void> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const fromPhone = Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!accountSid || !authToken || !fromPhone) {
    throw new Error('Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER')
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: fromPhone, To: to, Body: body }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio SMS error: ${err}`)
  }
}
