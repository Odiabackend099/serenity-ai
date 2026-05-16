import { describe, expect, it } from 'vitest'
import {
  buildManualReminderPayload,
  markReminderFailedPayload,
  markReminderSentPayload,
  normalizeReminderPhone,
  reminderMetadata,
  reminderNoticeForStatus,
  type ManualReminderType,
} from './appointment-reminder-flow'

describe('appointment reminder flow', () => {
  const reminderTypes: ManualReminderType[] = ['1week', '24h', '2h']

  it.each(reminderTypes)('builds a stable manual reminder payload for %s', (reminderType) => {
    const payload = buildManualReminderPayload({
      appointmentId: 'appt-123',
      reminderType,
      patientPhone: '+234 702 674 3998',
      patientName: '  Ada Patient  ',
      appointmentDate: '2026-05-20',
      appointmentTime: '14:30:00',
      center: 'Karu',
      doctorName: 'Dr. Adekunle',
    })

    expect(payload).toEqual({
      manual: true,
      appointmentId: 'appt-123',
      reminderType,
      phone: '2347026743998',
      patientName: 'Ada Patient',
      appointmentDate: '2026-05-20',
      appointmentTime: '14:30',
      center: 'Karu',
      doctorName: 'Dr. Adekunle',
    })
  })

  it('normalizes phone values for WhatsApp delivery', () => {
    expect(normalizeReminderPhone('whatsapp:+234 702 674 3998')).toBe('2347026743998')
    expect(normalizeReminderPhone(null)).toBe('')
  })

  it.each([
    ['1week', 'reminder_1week_sent', 'reminder_1week_sent_at', 'reminder_1week_status'],
    ['24h', 'reminder_24h_sent', 'reminder_24h_sent_at', 'reminder_24h_status'],
    ['2h', 'reminder_2h_sent', 'reminder_2h_sent_at', undefined],
  ] as const)('only marks %s reminder as sent with the supported fields', (reminderType, sentField, sentAtField, statusField) => {
    const update = markReminderSentPayload(reminderType, '2026-05-16T12:00:00.000Z')

    expect(update[sentField]).toBe(true)
    expect(update[sentAtField]).toBe('2026-05-16T12:00:00.000Z')
    if (statusField) {
      expect(update[statusField]).toBe('sent')
    } else {
      expect(Object.keys(update)).toEqual(['reminder_2h_sent', 'reminder_2h_sent_at'])
    }
  })

  it('records failure status without marking reminders as sent', () => {
    expect(markReminderFailedPayload('1week')).toEqual({ reminder_1week_status: 'failed' })
    expect(markReminderFailedPayload('24h')).toEqual({ reminder_24h_status: 'failed' })
    expect(markReminderFailedPayload('2h')).toEqual({})
  })

  it('maps reminder outcomes to staff-readable notices', () => {
    expect(reminderNoticeForStatus('sent', '2h')).toBe(reminderMetadata('2h').sentNotice)
    expect(reminderNoticeForStatus('not_confirmed')).toBe('reminder-not-confirmed')
    expect(reminderNoticeForStatus('function_unavailable')).toBe('reminder-unavailable')
    expect(reminderNoticeForStatus('provider_failed')).toBe('reminder-failed')
  })
})
