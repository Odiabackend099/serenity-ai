import { describe, expect, it } from 'vitest'
import {
  buildPendingWhatsAppBookingRequestState,
  getWhatsAppBookingCreationNotificationPlan,
} from './whatsapp-booking-request-flow.ts'

describe('WhatsApp booking request flow', () => {
  it('always creates WhatsApp bookings as pending requests without an assigned doctor', () => {
    expect(buildPendingWhatsAppBookingRequestState({ doctorPreference: 'Dr. Grace Ikeh' })).toEqual({
      doctorId: null,
      heldSlotId: null,
      status: 'pending',
      calendarSyncStatus: 'pending_no_matched_doctor',
      calendarSyncError: null,
      reason: 'Booked via WhatsApp AI | Doctor preference: Dr. Grace Ikeh | Calendar status: pending_no_matched_doctor',
    })
  })

  it('does not send patient or chosen-doctor confirmations during request creation', () => {
    expect(getWhatsAppBookingCreationNotificationPlan()).toEqual({
      notifyStaffRequest: true,
      notifyPatientConfirmation: false,
      notifyPatientEmail: false,
      notifyAssignedDoctor: false,
    })
  })
})
