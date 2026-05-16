import { describe, expect, it } from 'vitest'
import {
  confirmDashboardAppointmentWithDeps,
  type DashboardAppointmentRecord,
  type NotificationLogInput,
  type StaffRecipient,
} from './appointment-confirmation-flow.ts'
import { buildAppointmentEventRequest, buildFreeBusyRequest } from './calendar-requests.ts'

const fixedNow = new Date('2026-05-09T10:00:00.000Z')

const baseAppointment: DashboardAppointmentRecord = {
  id: 'appt-1',
  patient_id: 'patient-1',
  doctor_id: 'doctor-grace',
  appointment_date: '2026-06-17',
  appointment_time: '10:10',
  center: 'Galadimawa',
  service_type: 'Consultancy Services',
  reason: 'Booked via WhatsApp AI',
  google_calendar_event_id: null,
  google_calendar_synced_at: null,
  calendar_sync_status: null,
  patients: {
    name: 'QA Selected Doctor Two',
    phone_number: '+15558794614849',
    email: 'qa@example.com',
  },
  doctors: {
    name: 'Dr. Grace Ikeh',
    phone: '+2349137565087',
    location: 'Galadimawa',
  },
}

const staffRecipients: StaffRecipient[] = [
  { role: 'operations_manager', name: 'Abdullahi Rahinatu', phone: '+2348072023652' },
  { role: 'primary_doctor', name: 'Dr. Adekunle Adesina', phone: '+2348062197384' },
]

function makeDeps(options: {
  appointment?: DashboardAppointmentRecord
  calendarConfigured?: boolean
  calendarInsertError?: Error
  calendarCheckError?: Error
  calendarBusy?: boolean
  activeAppointments?: Array<{ id: string; appointment_time: string | null; status?: string | null }>
  whatsappErrorFor?: string
  hasDashboardConfirmationNotifications?: boolean
} = {}) {
  const logs: NotificationLogInput[] = []
  const updates: Record<string, unknown>[] = []
  const sentTexts: Array<{ to: string; text: string }> = []
  const emails: unknown[] = []
  const appointment = options.appointment ?? baseAppointment

  return {
    logs,
    updates,
    sentTexts,
    emails,
    deps: {
      now: () => fixedNow,
      loadAppointment: async () => appointment,
      markPendingMissingDoctor: async (_appointmentId: string, reason: string) => {
        updates.push({
          status: 'pending',
          calendar_sync_status: 'pending_no_matched_doctor',
          calendar_sync_error: null,
          reason,
        })
      },
      markPendingAvailabilityIssue: async (_appointmentId: string, payload: { calendarSyncStatus: string; calendarSyncError: string | null; reason: string }) => {
        updates.push({
          status: 'pending',
          calendar_sync_status: payload.calendarSyncStatus,
          calendar_sync_error: payload.calendarSyncError,
          reason: payload.reason,
        })
      },
      listActiveAppointments: async () => options.activeAppointments ?? [],
      listActiveSlotHolds: async () => [],
      isCalendarConfigured: () => options.calendarConfigured ?? true,
      checkCalendarConflict: async () => {
        if (options.calendarCheckError) throw options.calendarCheckError
        return options.calendarBusy ?? false
      },
      createAppointmentEvent: async () => {
        if (options.calendarInsertError) throw options.calendarInsertError
        return 'google-event-1'
      },
      updateAppointment: async (_appointmentId: string, payload: Record<string, unknown>) => {
        updates.push(payload)
      },
      sendAppointmentConfirmation: async (to: string) => {
        if (options.whatsappErrorFor === to) throw new Error('Twilio WhatsApp send failed (429): 63038 daily messages limit')
        return `sid-patient-${to}`
      },
      markPatientConfirmationSent: async (appointmentId: string) => {
        updates.push({ appointmentId, confirmation_sent: true })
      },
      sendAppointmentConfirmationEmail: async (params: unknown) => {
        emails.push(params)
      },
      sendTextMessage: async (to: string, text: string) => {
        if (options.whatsappErrorFor === to) throw new Error('Twilio WhatsApp send failed (429): 63038 daily messages limit')
        sentTexts.push({ to, text })
        return `sid-${to}`
      },
      getStaffRecipients: () => staffRecipients,
      hasDashboardConfirmationNotifications: async () => options.hasDashboardConfirmationNotifications ?? false,
      logNotification: async (params: NotificationLogInput) => {
        logs.push(params)
      },
    },
  }
}

describe('dashboard appointment confirmation integration flow', () => {
  it('confirms a selected-doctor appointment, creates calendar proof, and notifies all parties', async () => {
    const harness = makeDeps()

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps, { dedupe: true })

    expect(result).toMatchObject({
      confirmed: true,
      appointmentId: 'appt-1',
      calendarStatus: 'synced',
    })
    expect(harness.updates[0]).toMatchObject({
      status: 'confirmed',
      google_calendar_event_id: 'google-event-1',
      google_calendar_synced_at: fixedNow.toISOString(),
      calendar_sync_status: 'synced',
      calendar_sync_error: null,
    })
    expect(harness.emails).toHaveLength(1)
    expect(harness.sentTexts.map((message) => message.to)).toEqual([
      '+2349137565087',
      '+2348072023652',
      '+2348062197384',
    ])
    expect(harness.logs.map((log) => log.recipientRole).sort()).toEqual([
      'assigned_doctor',
      'operations_manager',
      'patient',
      'patient',
      'primary_doctor',
    ].sort())
    expect(harness.logs.every((log) => !log.errorMessage?.includes('{'))).toBe(true)
  })

  it('does not resend dashboard confirmations for an already-confirmed appointment unless resend is explicit', async () => {
    const harness = makeDeps({
      appointment: {
        ...baseAppointment,
        status: 'confirmed',
        google_calendar_event_id: 'google-event-existing',
        calendar_sync_status: 'synced',
      },
      hasDashboardConfirmationNotifications: true,
    })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps, { dedupe: true })

    expect(result).toMatchObject({
      confirmed: true,
      alreadyConfirmed: true,
    })
    expect(harness.sentTexts).toHaveLength(0)
    expect(harness.logs).toHaveLength(0)
  })

  it('allows explicit resend for an already-confirmed appointment', async () => {
    const harness = makeDeps({
      appointment: {
        ...baseAppointment,
        status: 'confirmed',
        google_calendar_event_id: 'google-event-existing',
        calendar_sync_status: 'synced',
      },
      hasDashboardConfirmationNotifications: true,
    })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps, { resend: true })

    expect(result).toMatchObject({ confirmed: true })
    expect(harness.sentTexts.map((message) => message.to)).toEqual([
      '+2349137565087',
      '+2348072023652',
      '+2348062197384',
    ])
  })

  it('keeps legacy resend calls working when no dedupe marker is provided', async () => {
    const harness = makeDeps({
      appointment: {
        ...baseAppointment,
        status: 'confirmed',
        google_calendar_event_id: 'google-event-existing',
        calendar_sync_status: 'synced',
      },
      hasDashboardConfirmationNotifications: true,
    })

    await confirmDashboardAppointmentWithDeps('appt-1', harness.deps)

    expect(harness.sentTexts.map((message) => message.to)).toEqual([
      '+2349137565087',
      '+2348072023652',
      '+2348062197384',
    ])
  })

  it('keeps appointment saved and pending for manual review when Google Calendar fails', async () => {
    const harness = makeDeps({
      calendarInsertError: new Error('Google Calendar event creation failed (400): {"error":{"reason":"badRequest"}}'),
    })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps)

    expect(result).toMatchObject({
      confirmed: false,
      calendarStatus: 'pending_calendar_error',
    })
    expect(harness.updates[0]).toMatchObject({
      status: 'pending',
      calendar_sync_status: 'pending_calendar_error',
    })
    expect(harness.sentTexts).toHaveLength(0)
  })

  it('prevents same-doctor double booking during dashboard confirmation', async () => {
    const harness = makeDeps({
      activeAppointments: [{ id: 'appt-existing', appointment_time: '10:30', status: 'confirmed' }],
    })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps)

    expect(result).toMatchObject({
      confirmed: false,
      calendarStatus: 'pending_database_conflict',
    })
    expect(harness.updates[0]).toMatchObject({
      status: 'pending',
      calendar_sync_status: 'pending_database_conflict',
    })
    expect(harness.logs).toHaveLength(0)
  })

  it('allows dashboard confirmation when shared hospital calendar is busy but the selected doctor is free', async () => {
    const harness = makeDeps({ calendarBusy: true })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps)

    expect(result).toMatchObject({
      confirmed: true,
      calendarStatus: 'synced',
    })
    expect(harness.updates[0]).toMatchObject({
      status: 'confirmed',
      calendar_sync_status: 'synced',
    })
    expect(harness.sentTexts.map((message) => message.to)).toEqual([
      '+2349137565087',
      '+2348072023652',
      '+2348062197384',
    ])
    expect(harness.emails).toHaveLength(1)
    expect(harness.logs.map((log) => log.recipientRole).sort()).toEqual([
      'assigned_doctor',
      'operations_manager',
      'patient',
      'patient',
      'primary_doctor',
    ].sort())
  })

  it('blocks dashboard confirmation when assigned doctor does not serve the appointment center', async () => {
    const harness = makeDeps({
      appointment: {
        ...baseAppointment,
        center: 'Karu',
        doctors: {
          name: 'Dr. Grace Ikeh',
          phone: '+2349137565087',
          location: 'Galadimawa',
        },
      },
    })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps)

    expect(result).toMatchObject({
      confirmed: false,
      calendarStatus: 'pending_doctor_center_mismatch',
    })
    expect(harness.updates[0]).toMatchObject({
      status: 'pending',
      calendar_sync_status: 'pending_doctor_center_mismatch',
    })
    expect(harness.logs).toHaveLength(0)
  })

  it('blocks dashboard confirmation until a doctor is assigned', async () => {
    const harness = makeDeps({
      appointment: {
        ...baseAppointment,
        doctor_id: null,
        doctors: null,
      },
    })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps)

    expect(result).toMatchObject({
      confirmed: false,
      calendarStatus: 'pending_no_matched_doctor',
    })
    expect(harness.updates[0]).toMatchObject({
      status: 'pending',
      calendar_sync_status: 'pending_no_matched_doctor',
    })
    expect(harness.logs).toHaveLength(0)
    expect(harness.sentTexts).toHaveLength(0)
  })

  it('logs WhatsApp limit failures as staff-readable queued notifications without losing confirmation', async () => {
    const harness = makeDeps({ whatsappErrorFor: '15558794614849' })

    const result = await confirmDashboardAppointmentWithDeps('appt-1', harness.deps)

    expect(result).toMatchObject({ confirmed: true })
    const patientLog = harness.logs.find((log) => log.recipientRole === 'patient' && log.channel === 'whatsapp')
    expect(patientLog).toMatchObject({
      status: 'pending',
      errorMessage: 'WhatsApp delivery is queued. The Twilio daily message limit has been reached; retry after the limit resets or after the hospital sender is upgraded.',
    })
  })
})

describe('Google Calendar request body integration contracts', () => {
  it('builds the free/busy request Google Calendar expects', () => {
    expect(buildFreeBusyRequest('calendar-id', '2026-06-17', '10:10', 60)).toEqual({
      timeMin: '2026-06-17T10:10:00+01:00',
      timeMax: '2026-06-17T11:10:00+01:00',
      timeZone: 'Africa/Lagos',
      items: [{ id: 'calendar-id' }],
    })
  })

  it('builds an appointment event with patient, doctor, center, and reminders', () => {
    const event = buildAppointmentEventRequest({
      patientName: 'QA Selected Doctor Two',
      patientPhone: '+15558794614849',
      doctorName: 'Dr. Grace Ikeh',
      serviceType: 'Consultancy Services',
      center: 'Galadimawa',
      appointmentDate: '2026-06-17',
      appointmentTime: '10:10',
      reason: 'Confirmed from Serenity AI dashboard',
    })

    expect(event).toMatchObject({
      summary: 'Consultancy Services — QA Selected Doctor Two',
      location: 'No. 10 Royal Homes Estate, Galadinmawa, Abuja',
      start: { dateTime: '2026-06-17T10:10:00', timeZone: 'Africa/Lagos' },
      end: { dateTime: '2026-06-17T11:10:00', timeZone: 'Africa/Lagos' },
    })
    expect(String(event.description)).toContain('Doctor: Dr. Grace Ikeh')
    expect(String(event.description)).toContain('Booked via Serenity AI WhatsApp System')
  })
})
