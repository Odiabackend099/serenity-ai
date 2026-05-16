/**
 * Send Notification Edge Function
 *
 * General-purpose notification dispatcher.
 * Uses a discriminated union payload so each type carries only what it needs.
 *
 * Types handled:
 *  - appointment_confirmation  → Twilio WhatsApp + email (requires patientId)
 *  - appointment_cancellation  → Cancel Google Calendar event (requires calendarEventId)
 *  - manual_message            → Send plain text to a phone directly (requires phone + message)
 *  - custom                    → Free-form WhatsApp text to a patient (requires patientId)
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, isAuthorizedInternalRequest } from '../_shared/supabase.ts'
import { sendTextMessage, sendAppointmentConfirmation } from '../_shared/whatsapp.ts'
import { sendStaffWhatsAppNotification } from '../_shared/staff-whatsapp.ts'
import { sendAppointmentConfirmationEmail } from '../_shared/email.ts'
import {
  cancelAppointmentEvent,
  checkCalendarConflict,
  createAppointmentEvent,
  isCalendarConfigured,
} from '../_shared/calendar.ts'
import {
  confirmDashboardAppointmentWithDeps,
  notificationFailureFromError,
  type NotificationChannel,
  type NotificationStatus,
  type StaffRecipient,
} from '../_shared/appointment-confirmation-flow.ts'

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

type AppointmentDashboardConfirmationPayload = {
  type: 'appointment_dashboard_confirmation'
  appointmentId: string
  resend?: boolean
  dedupe?: boolean
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
  | AppointmentDashboardConfirmationPayload
  | ManualMessagePayload
  | CustomPayload

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (!isAuthorizedInternalRequest(req)) {
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

        // Optionally notify patient via Twilio WhatsApp plain text.
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

    // ── Dashboard confirmation: status + calendar + patient + assigned doctor notifications
    case 'appointment_dashboard_confirmation': {
      if (!payload.appointmentId) {
        return Response.json({ error: 'appointmentId is required' }, { status: 400 })
      }

      try {
        const result = await confirmAppointmentFromDashboard(payload.appointmentId, {
          resend: payload.resend === true,
          dedupe: payload.dedupe === true,
        })
        return Response.json(result)
      } catch (err) {
        console.error('[send-notification] dashboard confirmation failed:', (err as Error).message)
        return Response.json({ error: (err as Error).message }, { status: 500 })
      }
    }

    // ── Appointment confirmation: Twilio WhatsApp + email ────────────────────
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
            })
          }
        } catch (err) {
          console.error(`[send-notification] ${channel} failed:`, (err as Error).message)
          results[channel] = false

          if (payload.appointmentId) {
            const failure = notificationFailureFromError(err)
            await supabase.from('notifications').insert({
              patient_id: payload.patientId,
              appointment_id: payload.appointmentId,
              notification_type: payload.type,
              channel,
              status: failure.status,
              error_message: failure.message,
            })
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

async function confirmAppointmentFromDashboard(
  appointmentId: string,
  options: { resend?: boolean; dedupe?: boolean } = {},
): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient()
  return confirmDashboardAppointmentWithDeps(appointmentId, {
    loadAppointment: async (id) => {
      const { data: appointment, error } = await supabase
        .from('appointments')
        .select('*, patients(name, phone_number, email), doctors(name, phone, location)')
        .eq('id', id)
        .single()

      if (error) throw new Error(error.message)
      return appointment ?? null
    },
    markPendingMissingDoctor: async (id, reason) => {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'pending',
          calendar_sync_status: 'pending_no_matched_doctor',
          calendar_sync_error: null,
          reason,
        })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    markPendingAvailabilityIssue: async (id, payload) => {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'pending',
          calendar_sync_status: payload.calendarSyncStatus,
          calendar_sync_error: payload.calendarSyncError,
          reason: payload.reason,
        })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    listActiveAppointments,
    listActiveSlotHolds,
    isCalendarConfigured,
    checkCalendarConflict,
    createAppointmentEvent,
    updateAppointment: async (id, payload) => {
      const { error } = await supabase.from('appointments').update(payload).eq('id', id)
      if (error) throw new Error(error.message)
    },
    sendAppointmentConfirmation,
    sendStaffWhatsApp: async (input) => {
      const result = await sendStaffWhatsAppNotification(input)
      return {
        externalMessageId: result.externalMessageId,
        messageContent: result.messageContent,
        templateName: result.templateName,
      }
    },
    hasDashboardConfirmationNotifications: async (id) => {
      const { data, error } = await supabase
        .from('notifications')
        .select('template_name, message_content')
        .eq('appointment_id', id)
        .eq('notification_type', 'staff_booking_alert')
        .eq('channel', 'whatsapp')
        .limit(25)

      if (error) throw new Error(error.message)

      return (data ?? []).some((row) => {
        const templateName = String(row.template_name ?? '')
        const messageContent = String(row.message_content ?? '')
        return templateName.includes('dashboard_confirmation')
          || templateName.includes('assigned_doctor_confirmation')
          || messageContent.startsWith('Dashboard confirmation alert')
          || messageContent.startsWith('Dashboard assignment alert')
      })
    },
    markPatientConfirmationSent: async (id) => {
      const { error } = await supabase
        .from('appointments')
        .update({ confirmation_sent: true, confirmation_sent_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    sendAppointmentConfirmationEmail,
    sendTextMessage,
    getStaffRecipients: getDashboardConfirmationStaffRecipients,
    logNotification,
  }, options)
}

function getDashboardConfirmationStaffRecipients(): StaffRecipient[] {
  return [
    {
      role: 'operations_manager',
      name: Deno.env.get('OPERATIONS_MANAGER_NAME') ?? 'Abdullahi Rahinatu',
      phone: Deno.env.get('OPERATIONS_MANAGER_WHATSAPP') ?? '+2348072023652',
    },
    {
      role: 'primary_doctor',
      name: Deno.env.get('PRIMARY_DOCTOR_NAME') ?? 'Dr. Adekunle Adesina',
      phone: Deno.env.get('PRIMARY_DOCTOR_WHATSAPP') ??
        Deno.env.get('HOSPITAL_MD_WHATSAPP') ??
        Deno.env.get('HOSPITAL_MD_PHONE') ??
        Deno.env.get('HOSPITAL_PHONE_PRIMARY') ??
        '+2348062197384',
    },
  ]
}

async function listActiveAppointments(params: {
  doctorId: string
  appointmentDate: string
  excludeAppointmentId?: string | null
}) {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('appointments')
    .select('id, appointment_time, status')
    .eq('doctor_id', params.doctorId)
    .eq('appointment_date', params.appointmentDate)

  if (params.excludeAppointmentId) query = query.neq('id', params.excludeAppointmentId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

async function listActiveSlotHolds(params: {
  doctorId: string
  appointmentDate: string
  excludeBookingSessionId?: string | null
}) {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('appointment_slot_holds')
    .select('id, appointment_time, duration_minutes, booking_session_id, expires_at, status')
    .eq('doctor_id', params.doctorId)
    .eq('appointment_date', params.appointmentDate)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  if (params.excludeBookingSessionId) query = query.neq('booking_session_id', params.excludeBookingSessionId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

async function logNotification(params: {
  patientId: string
  appointmentId: string
  notificationType: string
  channel: NotificationChannel
  message: string
  status: NotificationStatus
  externalMessageId?: string
  errorMessage?: string
  templateName?: string
  recipientRole?: 'primary_doctor' | 'operations_manager' | 'assigned_doctor' | 'patient' | 'staff_email' | 'on_call_backup'
  recipientName?: string | null
  recipientPhone?: string | null
}): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('notifications').insert({
    patient_id: params.patientId,
    appointment_id: params.appointmentId,
    notification_type: params.notificationType,
    channel: params.channel,
    template_name: params.templateName ?? params.notificationType,
    message_content: params.message.slice(0, 2000),
    status: params.status,
    external_message_id: params.externalMessageId ?? null,
    sent_at: params.status === 'sent' ? new Date().toISOString() : null,
    error_message: params.errorMessage ?? null,
    recipient_role: params.recipientRole ?? null,
    recipient_name: params.recipientName ?? null,
    recipient_phone: params.recipientPhone ?? null,
  })

  if (error) console.error('[send-notification] notification log failed:', error.message)
}

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
