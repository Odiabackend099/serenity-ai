/**
 * Appointment Reminder Edge Function
 *
 * Triggered by pg_cron at 9am WAT (08:00 UTC) daily.
 * Also generates and emails the daily appointment list to the MD.
 *
 * Logic:
 * - 1-week reminder: appointments exactly 7 days from today (not yet notified)
 * - 24h reminder: appointments tomorrow (not yet notified)
 * - Feedback: send feedback request for appointments completed yesterday
 * - Daily list: email MD the full schedule for today
 *
 * Uses the configured WhatsApp provider for reminder delivery.
 * Production business-initiated campaigns may need approved template messages.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, isAuthorizedInternalRequest, trackApiUsage } from '../_shared/supabase.ts'
import {
  sendAppointmentReminder1Week,
  sendAppointmentReminder24h,
  sendAppointmentReminder2h,
  sendFeedbackRequest,
} from '../_shared/whatsapp.ts'
import { sendDailyAppointmentList } from '../_shared/email.ts'
import {
  reminderNotificationType,
  validateManualReminderBody,
} from '../_shared/appointment-reminder-contract.ts'
import { format, addDays, subDays } from 'https://esm.sh/date-fns@3'

serve(async (req: Request) => {
  if (!isAuthorizedInternalRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const supabase = getSupabaseClient()

  // ── Manual reminder trigger (from admin dashboard) ────────────────────────
  // Payload: { manual: true, appointmentId, reminderType, phone, patientName, appointmentDate, appointmentTime, center, doctorName }
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // No body — treat as cron invocation
  }

  if (body.manual === true) {
    const validation = validateManualReminderBody(body)

    if (!validation.ok) {
      return Response.json({
        sent: false,
        error: validation.error,
        allowedReminderTypes: validation.allowedReminderTypes,
      }, { status: 400 })
    }

    const { appointmentId, reminderType, phone, patientName, appointmentDate, appointmentTime, center, doctorName } = validation.value

    try {
      const formattedDate = format(new Date(appointmentDate + 'T00:00:00'), 'EEEE, MMMM d, yyyy')

      if (reminderType === '1week') {
        await sendAppointmentReminder1Week(
          phone,
          patientName ?? 'Patient',
          formattedDate,
          appointmentTime ?? '09:00',
          center ?? 'Galadimawa',
          doctorName ?? 'Dr. Kunle Adesina',
        )
      } else if (reminderType === '24h') {
        await sendAppointmentReminder24h(
          phone,
          patientName ?? 'Patient',
          formattedDate,
          appointmentTime ?? '09:00',
          center ?? 'Galadimawa',
        )
      } else {
        await sendAppointmentReminder2h(
          phone,
          patientName ?? 'Patient',
          formattedDate,
          appointmentTime ?? '09:00',
          center ?? 'Galadimawa',
        )
      }

      console.log(`[appointment-reminder] Manual ${reminderType} reminder sent for appointment ${appointmentId}`)
      return Response.json({
        sent: true,
        reminderType,
        appointmentId,
        notificationType: reminderNotificationType(reminderType),
      })
    } catch (err) {
      console.error(`[appointment-reminder] Manual ${reminderType} reminder failed:`, (err as Error).message)
      return Response.json({
        sent: false,
        reminderType,
        appointmentId,
        error: (err as Error).message,
      }, { status: 500 })
    }
  }

  // ── Daily cron batch (pg_cron invocation) ─────────────────────────────────
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const tomorrowStr = format(addDays(today, 1), 'yyyy-MM-dd')
  const nextWeekStr = format(addDays(today, 7), 'yyyy-MM-dd')
  const yesterdayStr = format(subDays(today, 1), 'yyyy-MM-dd')

  const results = {
    weekReminders: 0,
    dayReminders: 0,
    feedbackRequests: 0,
    dailyListSent: false,
    errors: [] as string[],
  }

  // ── 1-Week Reminders ──────────────────────────────────────────────────────
  const { data: weekAppts } = await supabase
    .from('appointments')
    .select('id, appointment_date, appointment_time, center, service_type, patients(name, phone_number), doctors(name)')
    .eq('appointment_date', nextWeekStr)
    .eq('status', 'confirmed')
    .eq('reminder_1week_sent', false)

  for (const appt of weekAppts ?? []) {
    const patient = appt.patients as { name?: string; phone_number?: string } | null
    const doctor = appt.doctors as { name?: string } | null
    const phone = patient?.phone_number

    if (!phone) continue

    try {
      await sendAppointmentReminder1Week(
        phone.replace('+', ''),
        patient?.name ?? 'Patient',
        format(new Date(appt.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy'),
        appt.appointment_time?.slice(0, 5) ?? '09:00',
        appt.center ?? 'Galadimawa',
        doctor?.name ?? 'Dr. Kunle Adesina',
      )

      await supabase
        .from('appointments')
        .update({
          reminder_1week_sent: true,
          reminder_1week_sent_at: new Date().toISOString(),
          reminder_1week_status: 'sent',
        })
        .eq('id', appt.id)

      results.weekReminders++
    } catch (err) {
      const msg = `1-week reminder failed for appt ${appt.id}: ${(err as Error).message}`
      console.error(msg)
      results.errors.push(msg)

      // Log to reminder_failures table
      await supabase.from('reminder_failures').insert({
        appointment_id: appt.id,
        reminder_type: '1week',
        error_message: (err as Error).message,
        attempted_at: new Date().toISOString(),
        channel: 'whatsapp',
      })
    }
  }

  // ── 24-Hour Reminders ─────────────────────────────────────────────────────
  const { data: dayAppts } = await supabase
    .from('appointments')
    .select('id, appointment_date, appointment_time, center, service_type, patients(name, phone_number), doctors(name)')
    .eq('appointment_date', tomorrowStr)
    .eq('status', 'confirmed')
    .eq('reminder_24h_sent', false)

  for (const appt of dayAppts ?? []) {
    const patient = appt.patients as { name?: string; phone_number?: string } | null
    const phone = patient?.phone_number

    if (!phone) continue

    try {
      await sendAppointmentReminder24h(
        phone.replace('+', ''),
        patient?.name ?? 'Patient',
        format(new Date(appt.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy'),
        appt.appointment_time?.slice(0, 5) ?? '09:00',
        appt.center ?? 'Galadimawa',
      )

      await supabase
        .from('appointments')
        .update({
          reminder_24h_sent: true,
          reminder_24h_sent_at: new Date().toISOString(),
          reminder_24h_status: 'sent',
        })
        .eq('id', appt.id)

      results.dayReminders++
    } catch (err) {
      const msg = `24h reminder failed for appt ${appt.id}: ${(err as Error).message}`
      console.error(msg)
      results.errors.push(msg)

      await supabase.from('reminder_failures').insert({
        appointment_id: appt.id,
        reminder_type: '24h',
        error_message: (err as Error).message,
        attempted_at: new Date().toISOString(),
        channel: 'whatsapp',
      })
    }
  }

  // ── Feedback Requests (24h after appointment date) ────────────────────────
  const { data: completedAppts } = await supabase
    .from('appointments')
    .select('id, patient_id, patients(name, phone_number), doctors(name)')
    .eq('appointment_date', yesterdayStr)
    .eq('status', 'completed')

  for (const appt of completedAppts ?? []) {
    const patient = appt.patients as { name?: string; phone_number?: string } | null
    const doctor = appt.doctors as { name?: string } | null
    const phone = patient?.phone_number

    if (!phone) continue

    // Check if feedback already exists
    const { data: existingFeedback } = await supabase
      .from('appointment_feedback')
      .select('id')
      .eq('appointment_id', appt.id)
      .single()

    if (existingFeedback) continue

    try {
      await sendFeedbackRequest(
        phone.replace('+', ''),
        patient?.name ?? 'Patient',
        doctor?.name ?? 'Dr. Kunle Adesina',
      )
      results.feedbackRequests++
    } catch (err) {
      console.error(`Feedback request failed for appt ${appt.id}:`, (err as Error).message)
    }
  }

  // ── Daily Appointment List → MD via Email ─────────────────────────────────
  const { data: todayAppts } = await supabase
    .from('appointments')
    .select('appointment_time, center, service_type, status, patients(name, phone_number), doctors(name)')
    .eq('appointment_date', todayStr)
    .neq('status', 'cancelled')
    .order('appointment_time', { ascending: true })

  try {
    await sendDailyAppointmentList({
      date: format(today, 'EEEE, MMMM d, yyyy'),
      appointments: (todayAppts ?? []).map((a) => ({
        time: a.appointment_time?.slice(0, 5) ?? '--:--',
        patientName: (a.patients as { name?: string } | null)?.name ?? 'Unknown',
        serviceType: a.service_type ?? 'General',
        center: a.center ?? 'TBD',
        doctorName: (a.doctors as { name?: string } | null)?.name ?? 'Dr. Kunle Adesina',
        status: a.status,
      })),
    })
    results.dailyListSent = true
  } catch (err) {
    const msg = `Daily list email failed: ${(err as Error).message}`
    console.error(msg)
    results.errors.push(msg)
  }

  // Track WhatsApp API usage
  const totalWhatsAppMessages = results.weekReminders + results.dayReminders + results.feedbackRequests
  if (totalWhatsAppMessages > 0) {
    await trackApiUsage(supabase, 'whatsapp', 0)
  }

  console.log(`[appointment-reminder] Done: ${results.weekReminders} week reminders, ${results.dayReminders} 24h reminders, ${results.feedbackRequests} feedback requests, daily list: ${results.dailyListSent}`)

  return Response.json(results)
})
