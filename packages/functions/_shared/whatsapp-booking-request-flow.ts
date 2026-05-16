export type WhatsAppBookingRequestState = {
  doctorId: null
  heldSlotId: null
  status: 'pending'
  calendarSyncStatus: 'pending_no_matched_doctor'
  calendarSyncError: null
  reason: string
}

export type WhatsAppBookingCreationNotificationPlan = {
  notifyStaffRequest: true
  notifyPatientConfirmation: false
  notifyPatientEmail: false
  notifyAssignedDoctor: false
}

export function buildPendingWhatsAppBookingRequestState(params: {
  doctorPreference: string | null | undefined
}): WhatsAppBookingRequestState {
  return {
    doctorId: null,
    heldSlotId: null,
    status: 'pending',
    calendarSyncStatus: 'pending_no_matched_doctor',
    calendarSyncError: null,
    reason: [
      'Booked via WhatsApp AI',
      `Doctor preference: ${params.doctorPreference ?? 'Any available doctor'}`,
      'Calendar status: pending_no_matched_doctor',
    ].join(' | '),
  }
}

export function getWhatsAppBookingCreationNotificationPlan(): WhatsAppBookingCreationNotificationPlan {
  return {
    notifyStaffRequest: true,
    notifyPatientConfirmation: false,
    notifyPatientEmail: false,
    notifyAssignedDoctor: false,
  }
}
