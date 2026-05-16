export const manualReminderTypes = ['1week', '24h', '2h'] as const

export type ManualReminderType = typeof manualReminderTypes[number]

export type ManualReminderRequest = {
  appointmentId: string
  reminderType: ManualReminderType
  phone: string
  patientName: string
  appointmentDate: string
  appointmentTime: string
  center: string
  doctorName: string
}

export type ManualReminderValidation =
  | { ok: true; value: ManualReminderRequest }
  | { ok: false; error: string; allowedReminderTypes: readonly ManualReminderType[] }

export function isManualReminderType(value: unknown): value is ManualReminderType {
  return typeof value === 'string' && manualReminderTypes.includes(value as ManualReminderType)
}

export function reminderNotificationType(reminderType: ManualReminderType): string {
  return `appointment_reminder_${reminderType}`
}

export function validateManualReminderBody(body: Record<string, unknown>): ManualReminderValidation {
  const appointmentId = stringValue(body.appointmentId)
  const reminderType = body.reminderType
  const phone = stringValue(body.phone)
  const appointmentDate = stringValue(body.appointmentDate)
  const appointmentTime = stringValue(body.appointmentTime)

  if (!appointmentId || !phone || !appointmentDate || !appointmentTime || !isManualReminderType(reminderType)) {
    return {
      ok: false,
      error: 'appointmentId, phone, reminderType, appointmentDate, and appointmentTime are required for manual reminders',
      allowedReminderTypes: manualReminderTypes,
    }
  }

  return {
    ok: true,
    value: {
      appointmentId,
      reminderType,
      phone,
      patientName: stringValue(body.patientName) || 'Patient',
      appointmentDate,
      appointmentTime,
      center: stringValue(body.center) || 'Galadimawa',
      doctorName: stringValue(body.doctorName) || 'Dr. Kunle Adesina',
    },
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
