import {
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  checkAppointmentAvailability,
  type AvailabilityDeps,
} from './appointment-availability.ts'

export type NotificationChannel = 'whatsapp' | 'sms' | 'email'
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

export type StaffRecipient = {
  role: 'operations_manager' | 'primary_doctor'
  name: string
  phone: string
}

export type DashboardAppointmentRecord = {
  id: string
  patient_id: string
  doctor_id: string | null
  appointment_date: string
  appointment_time: string | null
  center: string | null
  service_type: string | null
  reason: string | null
  google_calendar_event_id: string | null
  google_calendar_synced_at?: string | null
  calendar_sync_status: string | null
  patients: { name?: string | null; phone_number?: string | null; email?: string | null } | null
  doctors: { name?: string | null; phone?: string | null; location?: string | null } | null
}

export type NotificationLogInput = {
  patientId: string
  appointmentId: string
  notificationType: string
  channel: NotificationChannel
  message: string
  status: NotificationStatus
  externalMessageId?: string
  errorMessage?: string
  recipientRole?: 'primary_doctor' | 'operations_manager' | 'assigned_doctor' | 'patient' | 'staff_email' | 'on_call_backup'
  recipientName?: string | null
  recipientPhone?: string | null
}

export type DashboardConfirmationDeps = {
  loadAppointment: (appointmentId: string) => Promise<DashboardAppointmentRecord | null>
  markPendingMissingDoctor: (appointmentId: string, reason: string) => Promise<void>
  markPendingAvailabilityIssue: (appointmentId: string, payload: { calendarSyncStatus: string; calendarSyncError: string | null; reason: string }) => Promise<void>
  listActiveAppointments: AvailabilityDeps['listActiveAppointments']
  listActiveSlotHolds?: AvailabilityDeps['listActiveSlotHolds']
  isCalendarConfigured: () => boolean
  checkCalendarConflict: (date: string, time: string, durationMinutes: number) => Promise<boolean>
  createAppointmentEvent: (params: {
    patientName: string
    patientPhone: string
    doctorName: string
    serviceType: string
    center: string
    appointmentDate: string
    appointmentTime: string
    reason?: string
  }) => Promise<string>
  updateAppointment: (appointmentId: string, payload: Record<string, unknown>) => Promise<void>
  sendAppointmentConfirmation: (
    to: string,
    patientName: string,
    appointmentDate: string,
    appointmentTime: string,
    center: string,
    doctorName: string,
    serviceType: string,
  ) => Promise<string>
  markPatientConfirmationSent: (appointmentId: string) => Promise<void>
  sendAppointmentConfirmationEmail: (params: {
    patientEmail: string
    patientName: string
    appointmentDate: string
    appointmentTime: string
    center: string
    centerAddress: string
    doctorName: string
    serviceType: string
    status: 'confirmed'
  }) => Promise<void>
  sendTextMessage: (to: string, text: string) => Promise<string>
  getStaffRecipients: () => StaffRecipient[]
  logNotification: (params: NotificationLogInput) => Promise<void>
  now?: () => Date
}

export async function confirmDashboardAppointmentWithDeps(
  appointmentId: string,
  deps: DashboardConfirmationDeps,
): Promise<Record<string, unknown>> {
  const appointment = await deps.loadAppointment(appointmentId)

  if (!appointment) {
    throw new Error('Appointment not found')
  }

  const patient = appointment.patients
  const doctor = appointment.doctors
  const patientName = patient?.name ?? 'Patient'
  const patientPhone = patient?.phone_number ?? ''
  const doctorName = doctor?.name ?? 'To be assigned'
  const appointmentDate = appointment.appointment_date
  const appointmentTime = String(appointment.appointment_time ?? '09:00').slice(0, 5)
  const center = appointment.center ?? 'Galadimawa'
  const serviceType = appointment.service_type ?? 'Consultation'

  if (!appointment.doctor_id || !doctor) {
    await deps.markPendingMissingDoctor(
      appointmentId,
      buildDashboardConfirmationReason(appointment.reason, 'pending_no_matched_doctor'),
    )

    return {
      confirmed: false,
      appointmentId,
      calendarStatus: 'pending_no_matched_doctor',
      message: 'Doctor assignment is required before appointment confirmation.',
      results: { calendar: 'skipped', whatsapp: 'skipped', email: 'skipped', assignedDoctorWhatsapp: 'skipped' },
    }
  }

  let calendarEventId = appointment.google_calendar_event_id
  let calendarStatus = appointment.calendar_sync_status
  let calendarError: string | null = null

  if (calendarEventId) {
    calendarStatus = 'synced'
  } else if (!deps.isCalendarConfigured()) {
    calendarStatus = 'pending_calendar_not_configured'
    calendarError = 'Google Calendar service account or calendar ID is not configured'
    await deps.markPendingAvailabilityIssue(appointmentId, {
      calendarSyncStatus: calendarStatus,
      calendarSyncError: calendarError,
      reason: buildDashboardConfirmationReason(appointment.reason, calendarStatus),
    })
    return {
      confirmed: false,
      appointmentId,
      calendarStatus,
      calendarError,
      message: 'Calendar setup needs review before confirmation.',
      results: { calendar: 'skipped', whatsapp: 'skipped', email: 'skipped', assignedDoctorWhatsapp: 'skipped' },
    }
  } else {
    try {
      const availability = await checkAppointmentAvailability({
        appointmentDate,
        appointmentTime,
        center,
        doctor: {
          id: appointment.doctor_id,
          name: doctorName,
          phone: doctor.phone ?? null,
          location: doctor.location ?? null,
        },
        durationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
        excludeAppointmentId: appointmentId,
      }, {
        listActiveAppointments: deps.listActiveAppointments,
        listActiveSlotHolds: deps.listActiveSlotHolds,
        isCalendarConfigured: deps.isCalendarConfigured,
        checkCalendarConflict: deps.checkCalendarConflict,
        now: deps.now,
      })

      if (availability.status === 'unavailable' || availability.status === 'invalid' || availability.status === 'no_doctor') {
        calendarStatus = availability.calendarStatus === 'available' ? 'pending_database_conflict' : availability.calendarStatus
        calendarError = availability.patientMessage
        await deps.markPendingAvailabilityIssue(appointmentId, {
          calendarSyncStatus: calendarStatus,
          calendarSyncError: calendarError,
          reason: buildDashboardConfirmationReason(appointment.reason, calendarStatus),
        })
        return {
          confirmed: false,
          appointmentId,
          calendarStatus,
          calendarError,
          message: availability.patientMessage,
          results: { calendar: 'skipped', whatsapp: 'skipped', email: 'skipped', assignedDoctorWhatsapp: 'skipped' },
        }
      }

      if (availability.status === 'needs_review') {
        calendarStatus = availability.calendarStatus
        calendarError = availability.calendarError
        await deps.markPendingAvailabilityIssue(appointmentId, {
          calendarSyncStatus: calendarStatus,
          calendarSyncError: calendarError,
          reason: buildDashboardConfirmationReason(appointment.reason, calendarStatus),
        })
        return {
          confirmed: false,
          appointmentId,
          calendarStatus,
          calendarError,
          message: 'Calendar availability needs secretary review before confirmation.',
          results: { calendar: 'skipped', whatsapp: 'skipped', email: 'skipped', assignedDoctorWhatsapp: 'skipped' },
        }
      } else {
        calendarEventId = await deps.createAppointmentEvent({
          patientName,
          patientPhone,
          doctorName,
          serviceType,
          center,
          appointmentDate,
          appointmentTime,
          reason: 'Confirmed from Serenity AI dashboard',
        })
        calendarStatus = 'synced'
      }
    } catch (err) {
      calendarStatus = 'pending_calendar_error'
      calendarError = err instanceof Error ? err.message : String(err)
      await deps.markPendingAvailabilityIssue(appointmentId, {
        calendarSyncStatus: calendarStatus,
        calendarSyncError: calendarError,
        reason: buildDashboardConfirmationReason(appointment.reason, calendarStatus),
      })
      return {
        confirmed: false,
        appointmentId,
        calendarStatus,
        calendarError,
        message: 'Calendar check needs review before confirmation.',
        results: { calendar: 'skipped', whatsapp: 'skipped', email: 'skipped', assignedDoctorWhatsapp: 'skipped' },
      }
    }
  }

  await deps.updateAppointment(appointmentId, {
    status: 'confirmed',
    google_calendar_event_id: calendarEventId,
    google_calendar_synced_at: calendarEventId ? (deps.now?.() ?? new Date()).toISOString() : appointment.google_calendar_synced_at,
    calendar_sync_status: calendarStatus,
    calendar_sync_error: calendarError,
    reason: buildDashboardConfirmationReason(appointment.reason, calendarStatus),
  })

  const results: Record<string, boolean | 'skipped'> = {
    calendar: calendarStatus === 'synced',
    whatsapp: 'skipped',
    email: 'skipped',
  }

  if (patientPhone) {
    try {
      const sid = await deps.sendAppointmentConfirmation(
        patientPhone.replace('+', ''),
        patientName,
        appointmentDate,
        appointmentTime,
        center,
        doctorName,
        serviceType,
      )
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'appointment_confirmation',
        channel: 'whatsapp',
        message: `Dashboard confirmation sent to ${patientName}`,
        status: 'sent',
        externalMessageId: sid,
        recipientRole: 'patient',
        recipientName: patientName,
        recipientPhone: patientPhone,
      })
      await deps.markPatientConfirmationSent(appointmentId)
      results.whatsapp = true
    } catch (err) {
      const failure = notificationFailureFromError(err)
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'appointment_confirmation',
        channel: 'whatsapp',
        message: `Dashboard confirmation failed for ${patientName}`,
        status: failure.status,
        errorMessage: failure.message,
        recipientRole: 'patient',
        recipientName: patientName,
        recipientPhone: patientPhone,
      })
      results.whatsapp = false
    }
  }

  if (patient?.email) {
    try {
      await deps.sendAppointmentConfirmationEmail({
        patientEmail: patient.email,
        patientName,
        appointmentDate,
        appointmentTime,
        center,
        centerAddress: center,
        doctorName,
        serviceType,
        status: 'confirmed',
      })
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'appointment_confirmation',
        channel: 'email',
        message: `Dashboard confirmation email sent to ${patient.email}`,
        status: 'sent',
        recipientRole: 'patient',
        recipientName: patientName,
        recipientPhone: null,
      })
      results.email = true
    } catch (err) {
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'appointment_confirmation',
        channel: 'email',
        message: `Dashboard confirmation email failed for ${patient.email}`,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        recipientRole: 'patient',
        recipientName: patientName,
        recipientPhone: null,
      })
      results.email = false
    }
  }

  if (doctor?.phone) {
    try {
      const sid = await deps.sendTextMessage(
        doctor.phone,
        buildAssignedDoctorConfirmationMessage({ patientName, patientPhone, serviceType, appointmentDate, appointmentTime, center }),
      )
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'staff_booking_alert',
        channel: 'whatsapp',
        message: `Dashboard assignment alert sent to ${doctor.name ?? 'assigned doctor'}`,
        status: 'sent',
        externalMessageId: sid,
        recipientRole: 'assigned_doctor',
        recipientName: doctor.name ?? 'Assigned doctor',
        recipientPhone: doctor.phone,
      })
      results.assignedDoctorWhatsapp = true
    } catch (err) {
      const failure = notificationFailureFromError(err)
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'staff_booking_alert',
        channel: 'whatsapp',
        message: `Dashboard assignment alert failed for ${doctor.name ?? 'assigned doctor'}`,
        status: failure.status,
        errorMessage: failure.message,
        recipientRole: 'assigned_doctor',
        recipientName: doctor.name ?? 'Assigned doctor',
        recipientPhone: doctor.phone,
      })
      results.assignedDoctorWhatsapp = false
    }
  } else {
    results.assignedDoctorWhatsapp = 'skipped'
  }

  for (const recipient of deps.getStaffRecipients()) {
    try {
      const sid = await deps.sendTextMessage(
        recipient.phone,
        buildStaffDashboardConfirmationMessage({
          recipient,
          patientName,
          patientPhone,
          serviceType,
          appointmentDate,
          appointmentTime,
          center,
          doctorName,
        }),
      )
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'staff_booking_alert',
        channel: 'whatsapp',
        message: `Dashboard confirmation alert sent to ${recipient.name}`,
        status: 'sent',
        externalMessageId: sid,
        recipientRole: recipient.role,
        recipientName: recipient.name,
        recipientPhone: recipient.phone,
      })
      results[recipient.role] = true
    } catch (err) {
      const failure = notificationFailureFromError(err)
      await deps.logNotification({
        patientId: appointment.patient_id,
        appointmentId,
        notificationType: 'staff_booking_alert',
        channel: 'whatsapp',
        message: `Dashboard confirmation alert failed for ${recipient.name}`,
        status: failure.status,
        errorMessage: failure.message,
        recipientRole: recipient.role,
        recipientName: recipient.name,
        recipientPhone: recipient.phone,
      })
      results[recipient.role] = false
    }
  }

  return { confirmed: true, appointmentId, calendarStatus, calendarError, results }
}

export function notificationFailureFromError(err: unknown): { status: NotificationStatus; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  if (isTwilioDailyLimitError(message)) {
    return {
      status: 'pending',
      message: 'WhatsApp delivery is queued. The Twilio daily message limit has been reached; retry after the limit resets or after the hospital sender is upgraded.',
    }
  }

  return { status: 'failed', message }
}

export function buildDashboardConfirmationReason(reason: string | null, calendarStatus: string | null): string {
  const baseParts = (reason ?? 'Confirmed from Serenity AI dashboard')
    .split(' | ')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const normalized = part.toLowerCase()
      return !normalized.startsWith('calendar status:')
        && !normalized.startsWith('calendar error:')
        && !normalized.startsWith('calendar note:')
        && !normalized.includes('google calendar availability check failed')
    })

  const status = calendarStatus === 'synced'
    ? 'synced'
    : calendarStatus ?? 'needs review'

  return [...baseParts, `Calendar status: ${status}`].join(' | ')
}

function isTwilioDailyLimitError(message: string): boolean {
  return message.includes('63038') || message.toLowerCase().includes('daily messages limit')
}

function buildAssignedDoctorConfirmationMessage(params: {
  patientName: string
  patientPhone: string
  serviceType: string
  appointmentDate: string
  appointmentTime: string
  center: string
}): string {
  return `Serenity AI appointment confirmed with you.\n\nPatient: ${params.patientName}\nPhone: ${params.patientPhone || 'Not provided'}\nService: ${params.serviceType}\nDate: ${params.appointmentDate}\nTime: ${params.appointmentTime}\nCenter: ${params.center}\n\nPlease review the dashboard for full details.`
}

function buildStaffDashboardConfirmationMessage(params: {
  recipient: StaffRecipient
  patientName: string
  patientPhone: string
  serviceType: string
  appointmentDate: string
  appointmentTime: string
  center: string
  doctorName: string
}): string {
  return `Serenity AI appointment confirmed from dashboard.\n\n${params.recipient.role === 'operations_manager' ? 'Action complete: appointment has been assigned/confirmed.' : 'For oversight: appointment has been assigned/confirmed by operations.'}\n\nPatient: ${params.patientName}\nPhone: ${params.patientPhone || 'Not provided'}\nService: ${params.serviceType}\nDate: ${params.appointmentDate}\nTime: ${params.appointmentTime}\nCenter: ${params.center}\nDoctor: ${params.doctorName}`
}
