export type NotificationStatus = 'pending' | 'synced' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'none'

export type NotificationLike = {
  status: string | null
  error_message: string | null
  recipient_name: string | null
  recipient_phone: string | null
}

export function formatNotificationDetail(notification: NotificationLike | undefined, fallback: string): string {
  if (!notification) return fallback
  const recipient = [notification.recipient_name, notification.recipient_phone].filter(Boolean).join(' · ')
  const status = humanizeProviderError(notification.error_message)
    ?? notificationStatusDetail(notification.status)
  return recipient ? `${recipient}: ${status}` : status
}

export function formatCalendarDetail(status: string | null, error: string | null): string {
  if (status === 'synced') return 'Saved on the hospital calendar.'
  if (status === 'checked_available') return 'The time was checked. Calendar saving is still pending.'
  if (status === 'pending_no_matched_doctor') return 'Doctor not assigned yet. Secretary should assign a doctor before confirming.'
  if (status === 'pending_doctor_center_mismatch') return 'Doctor and branch need review before confirmation.'
  if (status === 'pending_database_conflict') return 'Possible appointment conflict. Review the schedule before confirming.'
  if (status === 'pending_calendar_not_configured') return 'Hospital calendar setup needs review. Appointment is saved for manual confirmation.'
  if (status === 'pending_calendar_busy') return 'Requested time may already be booked. Review availability before confirming.'
  if (status === 'pending_calendar_error') return 'Hospital calendar check needs review. Appointment is saved for manual confirmation.'
  return humanizeProviderError(error) ?? status ?? 'No hospital calendar update recorded yet.'
}

export function formatAppointmentReason(reason: string): string {
  return reason
    .split(' | ')
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower.startsWith('calendar error:')) {
        return 'Calendar note: Hospital calendar check needs review. Appointment is saved for manual confirmation.'
      }
      if (lower.startsWith('calendar status:')) {
        return `Calendar note: ${formatCalendarDetail(part.split(':').slice(1).join(':').trim(), null)}`
      }
      if (part === 'Booked via WhatsApp AI') return 'Booked by WhatsApp'
      return humanizeProviderError(part) ?? part
    })
    .join(' · ')
}

export function humanizeProviderError(error?: string | null): string | null {
  if (!error) return null
  const normalized = error.toLowerCase()
  if (normalized.includes('63038')) {
    return 'WhatsApp sending limit reached. Use Resend updates after the limit resets.'
  }
  if (normalized.includes('daily message limit') || normalized.includes('delivery is queued')) {
    return 'WhatsApp is waiting to send because the current sender has reached its message limit. Use Resend updates after the limit resets.'
  }
  if (normalized.includes('twilio whatsapp send failed')) {
    return 'WhatsApp was not sent. Check the recipient phone number, then resend updates.'
  }
  if (normalized.includes('google calendar') || normalized.includes('freebusy')) {
    return 'Hospital calendar check failed. Appointment is saved and needs manual review.'
  }
  if (error.includes('{') || error.includes('}') || normalized.includes('"error"')) {
    return 'Something went wrong behind the scenes. A manager should review details.'
  }
  return error.length > 140 ? `${error.slice(0, 137)}...` : error
}

export function humanizeNotificationStatus(status?: string | null): string {
  if (status === 'synced') return 'Saved'
  if (status === 'sent') return 'Waiting for delivery'
  if (status === 'delivered') return 'Delivered'
  if (status === 'read') return 'Read'
  if (status === 'failed') return 'Failed'
  if (status === 'pending') return 'Waiting to send'
  if (status === 'skipped') return 'Skipped'
  return status ?? 'No status'
}

function notificationStatusDetail(status?: string | null): string {
  if (status === 'sent') return 'Sent to WhatsApp. Waiting for delivery confirmation.'
  return humanizeNotificationStatus(status)
}

export function normalizeNotificationStatus(status?: string | null): NotificationStatus {
  if (status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed' || status === 'pending') return status
  return 'none'
}

export function calendarStatus(status: string | null): NotificationStatus {
  if (status === 'synced') return 'synced'
  if (!status) return 'pending'
  if (status === 'checked_available') return 'pending'
  if (status.includes('error') || status.includes('conflict') || status.includes('busy')) return 'failed'
  return 'pending'
}

export function staffNotificationLabel(role: string | null): string {
  switch (role) {
    case 'operations_manager':
      return 'Secretary'
    case 'primary_doctor':
      return 'Dr K'
    case 'assigned_doctor':
      return 'Doctor'
    case 'patient':
      return 'Patient'
    case 'staff_email':
      return 'Email'
    default:
      return 'Staff'
  }
}
