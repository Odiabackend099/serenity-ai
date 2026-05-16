import { describe, expect, it } from 'vitest'
import { buildReminderNotificationAuditRecord } from './reminder-notification-audit'

describe('reminder notification audit records', () => {
  it('builds a complete notifications insert row for manual reminders', () => {
    const record = buildReminderNotificationAuditRecord({
      appointmentId: 'appt-123',
      patientId: 'patient-123',
      patientName: ' Ada Patient ',
      patientPhone: ' +234 702 674 3998 ',
      reminderType: '24h',
      sentAt: '2026-05-16T12:00:00.000Z',
      edgeResponse: { externalMessageId: 'wamid.123' },
    })

    expect(record).toEqual({
      patient_id: 'patient-123',
      appointment_id: 'appt-123',
      notification_type: 'appointment_reminder_24h',
      channel: 'whatsapp',
      template_name: 'appointment_reminder_24h',
      message_content: '24-hour reminder sent manually from dashboard',
      status: 'sent',
      sent_at: '2026-05-16T12:00:00.000Z',
      external_message_id: 'wamid.123',
      recipient_role: 'patient',
      recipient_name: 'Ada Patient',
      recipient_phone: '+234 702 674 3998',
    })
  })

  it('uses safe patient defaults and ignores malformed provider metadata', () => {
    const record = buildReminderNotificationAuditRecord({
      appointmentId: 'appt-123',
      patientId: 'patient-123',
      reminderType: '2h',
      sentAt: '2026-05-16T12:00:00.000Z',
      edgeResponse: { externalMessageId: '' },
    })

    expect(record.notification_type).toBe('appointment_reminder_2h')
    expect(record.external_message_id).toBeNull()
    expect(record.recipient_name).toBe('Patient')
    expect(record.recipient_phone).toBeNull()
  })
})
