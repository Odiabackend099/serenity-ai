import { describe, expect, it } from 'vitest'
import {
  reminderNotificationType,
  validateManualReminderBody,
  type ManualReminderType,
} from './appointment-reminder-contract'

describe('appointment reminder Edge Function contract', () => {
  it.each(['1week', '24h', '2h'] as ManualReminderType[])('accepts manual %s reminder requests', (reminderType) => {
    const result = validateManualReminderBody({
      appointmentId: 'appt-contract',
      reminderType,
      phone: '2347026743998',
      patientName: 'Patient',
      appointmentDate: '2026-05-20',
      appointmentTime: '10:00',
      center: 'Galadimawa',
      doctorName: 'Dr. Adekunle',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.reminderType).toBe(reminderType)
      expect(reminderNotificationType(result.value.reminderType)).toBe(`appointment_reminder_${reminderType}`)
    }
  })

  it('rejects missing required fields before provider delivery', () => {
    const result = validateManualReminderBody({
      appointmentId: 'appt-contract',
      reminderType: '2h',
      appointmentDate: '2026-05-20',
    })

    expect(result).toEqual({
      ok: false,
      error: 'appointmentId, phone, reminderType, appointmentDate, and appointmentTime are required for manual reminders',
      allowedReminderTypes: ['1week', '24h', '2h'],
    })
  })

  it('rejects unsupported reminder types', () => {
    const result = validateManualReminderBody({
      appointmentId: 'appt-contract',
      reminderType: '12h',
      phone: '2347026743998',
      appointmentDate: '2026-05-20',
      appointmentTime: '10:00',
    })

    expect(result.ok).toBe(false)
  })
})
