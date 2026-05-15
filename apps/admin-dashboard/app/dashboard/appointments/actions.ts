'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { confirmAppointmentWithDeps, type ConfirmAppointmentResult } from '@/lib/appointment-actions-flow'

type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

function getInternalFunctionConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return null
  return { supabaseUrl, serviceKey }
}

async function callNotificationFunction(payload: Record<string, unknown>): Promise<Response | null> {
  const config = getInternalFunctionConfig()
  if (!config) return null

  return fetch(`${config.supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

function appointmentNoticeUrl(appointmentId: string, notice: string): string {
  return `/dashboard/appointments?appointment=${encodeURIComponent(appointmentId)}&notice=${encodeURIComponent(notice)}`
}

function confirmationNotice(result: ConfirmAppointmentResult): string {
  switch (result.status) {
    case 'confirmed':
      return 'confirmed'
    case 'missing_doctor':
      return 'missing-doctor'
    case 'notification_failed':
      return 'notification-issue'
    default:
      return 'could-not-save'
  }
}

export async function confirmAppointment(appointmentId: string, formData?: FormData): Promise<void> {
  const doctorId = formData?.get('doctor_id')?.toString() || null
  const supabase = await createServerSupabaseClient()
  const result = await confirmAppointmentWithDeps(appointmentId, doctorId, {
    assignDoctor: async (id, selectedDoctorId) => {
      const { error } = await supabase
        .from('appointments')
        .update({ doctor_id: selectedDoctorId })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    getAppointmentDoctorId: async (id) => {
      const { data: appointment, error } = await supabase
        .from('appointments')
        .select('doctor_id')
        .eq('id', id)
        .single()
      if (error || !appointment) throw new Error(error?.message ?? 'not found')
      return appointment.doctor_id
    },
    markNeedsDoctorAssignment: async (id) => {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'pending',
          calendar_sync_status: 'pending_no_matched_doctor',
          calendar_sync_error: null,
        })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    callNotificationFunction: async (payload) => {
      const res = await callNotificationFunction(payload)
      if (!res) return null
      return {
        ok: res.ok,
        errorText: res.ok ? undefined : await res.text().catch(() => res.statusText),
      }
    },
    logError: (message, error) => console.error(message, error),
    revalidate: () => {
      revalidatePath('/dashboard/appointments')
      revalidatePath('/dashboard')
    },
  })
  redirect(appointmentNoticeUrl(appointmentId, confirmationNotice(result)))
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<void> {
  const supabase = await createServerSupabaseClient()

  if (status === 'confirmed') {
    const { data: appointment, error: lookupError } = await supabase
      .from('appointments')
      .select('doctor_id')
      .eq('id', appointmentId)
      .single()

    if (lookupError || !appointment?.doctor_id) {
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'pending',
          calendar_sync_status: 'pending_no_matched_doctor',
          calendar_sync_error: null,
        })
        .eq('id', appointmentId)

      if (lookupError) console.error('[appointments] confirmation guard lookup failed:', lookupError.message)
      if (error) console.error('[appointments] confirmation guard update failed:', error.message)

      revalidatePath('/dashboard/appointments')
      revalidatePath('/dashboard')
      redirect(appointmentNoticeUrl(appointmentId, 'missing-doctor'))
      return
    }
  }

  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId)

  if (error) {
    console.error('[appointments] update status failed:', error.message)
    redirect(appointmentNoticeUrl(appointmentId, 'could-not-save'))
    return
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard')
  const notice = status === 'completed' ? 'completed' : status === 'no_show' ? 'did-not-attend' : status === 'confirmed' ? 'confirmed' : 'updated'
  redirect(appointmentNoticeUrl(appointmentId, notice))
}

export async function cancelAppointment(appointmentId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  // Get calendar event ID before cancelling
  const { data: appt } = await supabase
    .from('appointments')
    .select('google_calendar_event_id, patients(name, phone_number)')
    .eq('id', appointmentId)
    .single()

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)

  if (error) {
    console.error('[appointments] cancel failed:', error.message)
    redirect(appointmentNoticeUrl(appointmentId, 'could-not-save'))
    return
  }

  // Cancel Google Calendar event if linked (non-fatal)
  if (appt?.google_calendar_event_id) {
    try {
      const patient = appt.patients as { name?: string; phone_number?: string } | null
      await callNotificationFunction({
        type: 'appointment_cancellation',
        calendarEventId: appt.google_calendar_event_id,
        patientPhone: patient?.phone_number,
        patientName: patient?.name,
      })
    } catch {
      // Non-fatal — appointment is cancelled in DB regardless
    }
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard')
  redirect(appointmentNoticeUrl(appointmentId, 'cancelled'))
}

export async function sendManualReminder(
  appointmentId: string,
  reminderType: '24h' | '1week',
): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { data: appt } = await supabase
    .from('appointments')
    .select('*, patients(name, phone_number), doctors(name)')
    .eq('id', appointmentId)
    .single()

  if (!appt) return

  const patient = appt.patients as { name?: string; phone_number?: string } | null
  const doctor = appt.doctors as { name?: string } | null
  const phone = patient?.phone_number?.replace('+', '')

  if (!phone) {
    redirect(appointmentNoticeUrl(appointmentId, 'missing-phone'))
  }

  const config = getInternalFunctionConfig()
  if (!config) {
    redirect(appointmentNoticeUrl(appointmentId, 'notification-issue'))
  }

  const res = await fetch(`${config.supabaseUrl}/functions/v1/appointment-reminder`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      manual: true,
      appointmentId,
      reminderType,
      phone,
      patientName: patient?.name ?? 'Patient',
      appointmentDate: appt.appointment_date,
      appointmentTime: appt.appointment_time?.slice(0, 5) ?? '09:00',
      center: appt.center ?? 'Galadimawa',
      doctorName: doctor?.name ?? 'Dr. Kunle Adesina',
    }),
  })

  if (!res.ok) {
    console.error('[appointments] manual reminder failed:', await res.text().catch(() => res.statusText))
    redirect(appointmentNoticeUrl(appointmentId, 'notification-issue'))
    return
  }

  // Mark the reminder as sent
  const updateField = reminderType === '24h' ? 'reminder_24h_sent' : 'reminder_1week_sent'
  await supabase.from('appointments').update({ [updateField]: true }).eq('id', appointmentId)

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard')
  redirect(appointmentNoticeUrl(appointmentId, 'reminder-sent'))
}
