import { reminderMetadata, type ManualReminderType } from './appointment-reminder-flow'

type ReminderNotificationAuditInput = {
  appointmentId: string
  patientId: string
  patientName?: string | null
  patientPhone?: string | null
  reminderType: ManualReminderType
  sentAt: string
  edgeResponse?: unknown
}

export type ReminderNotificationAuditRecord = {
  patient_id: string
  appointment_id: string
  notification_type: string
  channel: 'whatsapp'
  template_name: string
  message_content: string
  status: 'sent'
  sent_at: string
  external_message_id: string | null
  recipient_role: 'patient'
  recipient_name: string
  recipient_phone: string | null
}

export function buildReminderNotificationAuditRecord(
  input: ReminderNotificationAuditInput,
): ReminderNotificationAuditRecord {
  const reminder = reminderMetadata(input.reminderType)

  return {
    patient_id: input.patientId,
    appointment_id: input.appointmentId,
    notification_type: reminder.notificationType,
    channel: 'whatsapp',
    template_name: reminder.notificationType,
    message_content: `${reminder.label} sent manually from dashboard`,
    status: 'sent',
    sent_at: input.sentAt,
    external_message_id: readExternalMessageId(input.edgeResponse),
    recipient_role: 'patient',
    recipient_name: input.patientName?.trim() || 'Patient',
    recipient_phone: input.patientPhone?.trim() || null,
  }
}

function readExternalMessageId(edgeResponse: unknown): string | null {
  if (!edgeResponse || typeof edgeResponse !== 'object') return null

  const value = (edgeResponse as { externalMessageId?: unknown }).externalMessageId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
