export const manualReminderTypes = ['1week', '24h', '2h'] as const

export type ManualReminderType = typeof manualReminderTypes[number]

export type ReminderMetadata = {
  type: ManualReminderType
  label: string
  sentField: 'reminder_1week_sent' | 'reminder_24h_sent' | 'reminder_2h_sent'
  sentAtField: 'reminder_1week_sent_at' | 'reminder_24h_sent_at' | 'reminder_2h_sent_at'
  statusField?: 'reminder_1week_status' | 'reminder_24h_status'
  notificationType: 'appointment_reminder_1week' | 'appointment_reminder_24h' | 'appointment_reminder_2h'
  sentNotice: 'reminder-1week-sent' | 'reminder-24h-sent' | 'reminder-2h-sent'
}

export type ManualReminderPayloadInput = {
  appointmentId: string
  reminderType: ManualReminderType
  patientPhone: string
  patientName?: string | null
  appointmentDate: string
  appointmentTime?: string | null
  center?: string | null
  doctorName?: string | null
}

export type ManualReminderPayload = {
  manual: true
  appointmentId: string
  reminderType: ManualReminderType
  phone: string
  patientName: string
  appointmentDate: string
  appointmentTime: string
  center: string
  doctorName: string
}

export type ReminderActionStatus =
  | 'sent'
  | 'missing_phone'
  | 'not_confirmed'
  | 'past_appointment'
  | 'not_found'
  | 'function_unavailable'
  | 'provider_failed'
  | 'update_failed'
  | 'audit_failed'
  | 'not_authorized'

const metadata: Record<ManualReminderType, ReminderMetadata> = {
  '1week': {
    type: '1week',
    label: '1-week reminder',
    sentField: 'reminder_1week_sent',
    sentAtField: 'reminder_1week_sent_at',
    statusField: 'reminder_1week_status',
    notificationType: 'appointment_reminder_1week',
    sentNotice: 'reminder-1week-sent',
  },
  '24h': {
    type: '24h',
    label: '24-hour reminder',
    sentField: 'reminder_24h_sent',
    sentAtField: 'reminder_24h_sent_at',
    statusField: 'reminder_24h_status',
    notificationType: 'appointment_reminder_24h',
    sentNotice: 'reminder-24h-sent',
  },
  '2h': {
    type: '2h',
    label: '2-hour reminder',
    sentField: 'reminder_2h_sent',
    sentAtField: 'reminder_2h_sent_at',
    notificationType: 'appointment_reminder_2h',
    sentNotice: 'reminder-2h-sent',
  },
}

export function isManualReminderType(value: string): value is ManualReminderType {
  return manualReminderTypes.includes(value as ManualReminderType)
}

export function reminderMetadata(reminderType: ManualReminderType): ReminderMetadata {
  return metadata[reminderType]
}

export function normalizeReminderPhone(phone: string | null | undefined): string {
  return (phone ?? '').replace(/[^\d]/g, '')
}

export function buildManualReminderPayload(input: ManualReminderPayloadInput): ManualReminderPayload {
  return {
    manual: true,
    appointmentId: input.appointmentId,
    reminderType: input.reminderType,
    phone: normalizeReminderPhone(input.patientPhone),
    patientName: input.patientName?.trim() || 'Patient',
    appointmentDate: input.appointmentDate,
    appointmentTime: input.appointmentTime?.slice(0, 5) || '09:00',
    center: input.center || 'Galadimawa',
    doctorName: input.doctorName?.trim() || 'Dr. Kunle Adesina',
  }
}

export function markReminderSentPayload(
  reminderType: ManualReminderType,
  sentAt: string,
): Record<string, boolean | string> {
  const item = reminderMetadata(reminderType)
  return {
    [item.sentField]: true,
    [item.sentAtField]: sentAt,
    ...(item.statusField ? { [item.statusField]: 'sent' } : {}),
  }
}

export function markReminderFailedPayload(
  reminderType: ManualReminderType,
): Record<string, string> {
  const item = reminderMetadata(reminderType)
  return item.statusField ? { [item.statusField]: 'failed' } : {}
}

export function reminderNoticeForStatus(
  status: ReminderActionStatus,
  reminderType?: ManualReminderType,
): string {
  if (status === 'sent' && reminderType) return reminderMetadata(reminderType).sentNotice

  switch (status) {
    case 'missing_phone':
      return 'missing-phone'
    case 'not_confirmed':
      return 'reminder-not-confirmed'
    case 'past_appointment':
      return 'reminder-past'
    case 'not_found':
      return 'not-found'
    case 'function_unavailable':
      return 'reminder-unavailable'
    case 'provider_failed':
      return 'reminder-failed'
    case 'update_failed':
      return 'could-not-save'
    case 'audit_failed':
      return 'reminder-audit-issue'
    case 'not_authorized':
      return 'not-authorized'
    default:
      return 'could-not-save'
  }
}
