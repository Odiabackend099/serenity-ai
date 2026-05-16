'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { confirmAppointmentWithDeps, type ConfirmAppointmentResult } from '@/lib/appointment-actions-flow'
import { callInternalEdgeFunction } from '@/lib/edge-functions'
import { DashboardActionError, requireDashboardUser, type DashboardRole } from '@/lib/dashboard-action-auth'
import { createAdminSupabaseClient } from '@/lib/supabase-admin'
import {
  buildManualReminderPayload,
  markReminderFailedPayload,
  markReminderSentPayload,
  reminderMetadata,
  reminderNoticeForStatus,
  type ManualReminderType,
} from '@/lib/appointment-reminder-flow'
import { buildReminderNotificationAuditRecord } from '@/lib/reminder-notification-audit'

type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

const APPOINTMENT_ACTION_ROLES: DashboardRole[] = ['super_admin', 'admin', 'doctor', 'staff']

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

async function requireAppointmentActionUser(appointmentId: string) {
  try {
    return await requireDashboardUser(APPOINTMENT_ACTION_ROLES)
  } catch (err) {
    if (err instanceof DashboardActionError) {
      console.error(`[appointments] action blocked (${err.code}):`, err.message)
      redirect(appointmentNoticeUrl(appointmentId, err.code === 'not_authenticated' ? 'not-signed-in' : 'not-authorized'))
    }
    throw err
  }
}

export async function confirmAppointment(appointmentId: string, formData?: FormData): Promise<void> {
  const doctorId = formData?.get('doctor_id')?.toString() || null
  const resend = formData?.get('intent')?.toString() === 'resend'
  const { supabase } = await requireAppointmentActionUser(appointmentId)
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
      const res = await callInternalEdgeFunction('send-notification', {
        ...payload,
        ...(resend ? { resend: true } : {}),
      })
      if (!res) return null
      return {
        ok: res.ok,
        errorText: res.errorText,
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
  const { supabase } = await requireAppointmentActionUser(appointmentId)

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
  const { supabase } = await requireAppointmentActionUser(appointmentId)

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
      await callInternalEdgeFunction('send-notification', {
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
  reminderType: ManualReminderType,
): Promise<void> {
  const { supabase } = await requireAppointmentActionUser(appointmentId)

  const { data: appt, error: lookupError } = await supabase
    .from('appointments')
    .select('*, patients(name, phone_number), doctors(name)')
    .eq('id', appointmentId)
    .single()

  if (lookupError || !appt) {
    if (lookupError) console.error('[appointments] reminder lookup failed:', lookupError.message)
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('not_found')))
  }

  if (appt.status !== 'confirmed' || !appt.doctor_id) {
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('not_confirmed')))
  }

  const today = new Date().toISOString().split('T')[0]
  if (appt.appointment_date < today) {
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('past_appointment')))
  }

  const patient = appt.patients as { name?: string; phone_number?: string } | null
  const doctor = appt.doctors as { name?: string } | null
  const payload = buildManualReminderPayload({
    appointmentId,
    reminderType,
    patientPhone: patient?.phone_number ?? '',
    patientName: patient?.name,
    appointmentDate: appt.appointment_date,
    appointmentTime: appt.appointment_time,
    center: appt.center,
    doctorName: doctor?.name,
  })

  if (!payload.phone) {
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('missing_phone')))
  }

  const res = await callInternalEdgeFunction('appointment-reminder', payload)
  if (!res) {
    await markReminderFailedIfSupported(supabase, appointmentId, reminderType)
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('function_unavailable')))
  }

  if (!res.ok) {
    console.error('[appointments] manual reminder failed:', res.errorText ?? res.statusText)
    await markReminderFailedIfSupported(supabase, appointmentId, reminderType)
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('provider_failed')))
  }

  const sentAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('appointments')
    .update(markReminderSentPayload(reminderType, sentAt))
    .eq('id', appointmentId)

  if (updateError) {
    console.error('[appointments] reminder sent but database update failed:', updateError.message)
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('update_failed')))
  }

  const reminder = reminderMetadata(reminderType)
  let notificationLogErrorMessage: string | null = null
  const notificationAuditRecord = buildReminderNotificationAuditRecord({
    patientId: appt.patient_id,
    appointmentId,
    patientName: patient?.name,
    patientPhone: patient?.phone_number,
    reminderType,
    sentAt,
    edgeResponse: res.json,
  })

  try {
    const adminSupabase = createAdminSupabaseClient()
    const { data: notificationLog, error: notificationLogError } = await adminSupabase
      .from('notifications')
      .insert(notificationAuditRecord)
      .select('id')
      .single()

    if (notificationLogError) {
      notificationLogErrorMessage = notificationLogError.message
    } else if (!notificationLog?.id) {
      notificationLogErrorMessage = 'Notification audit insert returned no row'
    }
  } catch (err) {
    notificationLogErrorMessage = err instanceof Error ? err.message : 'Unknown notification audit error'
  }

  if (notificationLogErrorMessage) {
    console.error('[appointments] reminder notification log failed:', notificationLogErrorMessage, {
      appointmentId,
      notificationType: reminder.notificationType,
    })
    revalidatePath('/dashboard/appointments')
    revalidatePath('/dashboard')
    redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('audit_failed')))
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard')
  redirect(appointmentNoticeUrl(appointmentId, reminderNoticeForStatus('sent', reminderType)))
}

async function markReminderFailedIfSupported(
  supabase: Awaited<ReturnType<typeof requireDashboardUser>>['supabase'],
  appointmentId: string,
  reminderType: ManualReminderType,
): Promise<void> {
  const failedUpdate = markReminderFailedPayload(reminderType)
  if (Object.keys(failedUpdate).length === 0) return

  const { error } = await supabase
    .from('appointments')
    .update(failedUpdate)
    .eq('id', appointmentId)

  if (error) {
    console.error('[appointments] reminder failure status update failed:', error.message)
  }
}
