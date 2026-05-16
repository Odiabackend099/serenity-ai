import { describe, expect, it } from 'vitest'
import {
  calendarStatus,
  formatAppointmentReason,
  formatCalendarDetail,
  formatNotificationDetail,
  humanizeProviderError,
  humanizeNotificationStatus,
  normalizeNotificationStatus,
  staffNotificationLabel,
} from './appointment-display'

describe('staff-friendly dashboard labels', () => {
  it('uses nontechnical recipient labels', () => {
    expect(staffNotificationLabel('operations_manager')).toBe('Secretary')
    expect(staffNotificationLabel('primary_doctor')).toBe('Dr K')
    expect(staffNotificationLabel('assigned_doctor')).toBe('Doctor')
    expect(staffNotificationLabel('patient')).toBe('Patient')
    expect(staffNotificationLabel('staff_email')).toBe('Email')
  })

  it('converts provider errors into staff-readable guidance', () => {
    expect(humanizeProviderError('Twilio WhatsApp send failed: sandbox recipient missing')).toContain('WhatsApp was not sent')
    expect(humanizeProviderError('Error 63038: daily message limit reached')).toBe('WhatsApp sending limit reached. Use Resend updates after the limit resets.')
    expect(humanizeProviderError('Google Calendar POST /freeBusy failed (400): {"error":{"reason":"badRequest"}}')).toBe('Hospital calendar check failed. Appointment is saved and needs manual review.')
    expect(humanizeProviderError('{"error":"raw json"}')).toBe('Something went wrong behind the scenes. A manager should review details.')
  })

  it('labels notification and calendar states for staff', () => {
    expect(humanizeNotificationStatus('pending')).toBe('Waiting to send')
    expect(humanizeNotificationStatus('sent')).toBe('Waiting for delivery')
    expect(humanizeNotificationStatus('synced')).toBe('Saved')
    expect(normalizeNotificationStatus('sent')).toBe('sent')
    expect(normalizeNotificationStatus('queued')).toBe('none')
    expect(calendarStatus('checked_available')).toBe('pending')
    expect(formatCalendarDetail('checked_available', null)).toBe('The time was checked. Calendar saving is still pending.')
    expect(calendarStatus('pending_calendar_error')).toBe('failed')
    expect(formatCalendarDetail('pending_calendar_error', '{"error":"bad"}')).toBe('Hospital calendar check needs review. Appointment is saved for manual confirmation.')
    expect(formatCalendarDetail(null, null)).toBe('No hospital calendar update recorded yet.')
  })

  it('keeps appointment reasons free of raw JSON details', () => {
    const reason = formatAppointmentReason('Booked via WhatsApp AI | Calendar error: {"error":{"reason":"bad"}}')
    expect(reason).toContain('Booked by WhatsApp')
    expect(reason).toContain('Calendar note: Hospital calendar check needs review')
    expect(reason).not.toContain('{"error"')
  })

  it('formats notification proof without developer-first wording', () => {
    const detail = formatNotificationDetail({
      recipient_name: 'Abdullahi Rahinatu',
      recipient_phone: '+2348072023652',
      status: 'failed',
      error_message: 'Twilio WhatsApp send failed',
    }, 'Secretary alert has not been sent yet')

    expect(detail).toContain('Abdullahi Rahinatu')
    expect(detail).toContain('WhatsApp was not sent')
    expect(detail.toLowerCase()).not.toContain('ops contact')
  })

  it('explains accepted WhatsApp sends as waiting for phone delivery', () => {
    const detail = formatNotificationDetail({
      recipient_name: 'Dr. Adekunle Adesina',
      recipient_phone: '+2348062197384',
      status: 'sent',
      error_message: null,
    }, 'Dr K update has not been sent yet')

    expect(detail).toContain('Sent to WhatsApp')
    expect(detail).toContain('Waiting for delivery confirmation')
  })

  it('falls back to the provided empty-state message when no notification exists', () => {
    expect(formatNotificationDetail(undefined, 'Patient update has not been sent yet')).toBe('Patient update has not been sent yet')
  })
})
