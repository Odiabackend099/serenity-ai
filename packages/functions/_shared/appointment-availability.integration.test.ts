import { describe, expect, it } from 'vitest'
import {
  checkAppointmentAvailability,
  type AvailabilityDeps,
  type AvailabilityDoctor,
  type BusyAppointment,
} from './appointment-availability.ts'

const fixedNow = new Date('2026-05-13T08:00:00.000Z')
const grace: AvailabilityDoctor = { id: 'grace', name: 'Dr. Grace Ikeh', phone: '+2349137565087', location: 'Galadimawa' }

function makeDeps(appointments: BusyAppointment[] = [], calendar: { busy?: boolean; fail?: boolean } = {}): AvailabilityDeps {
  return {
    now: () => fixedNow,
    listActiveAppointments: async () => appointments,
    listActiveSlotHolds: async () => [],
    isCalendarConfigured: () => true,
    checkCalendarConflict: async () => {
      if (calendar.fail) throw new Error('Google Calendar FreeBusy failed')
      return calendar.busy ?? false
    },
  }
}

describe('appointment availability integration flow', () => {
  it('returns requested slot available when Supabase and Google Calendar are clear', async () => {
    const result = await checkAppointmentAvailability({
      appointmentDate: '2026-05-14',
      appointmentTime: '10:00',
      center: 'Galadimawa',
      doctor: grace,
    }, makeDeps())

    expect(result).toMatchObject({
      status: 'available',
      reason: 'available',
      calendarStatus: 'available',
      doctor: { id: 'grace' },
    })
  })

  it('returns unavailable with at least three alternatives when requested slot overlaps', async () => {
    const result = await checkAppointmentAvailability({
      appointmentDate: '2026-05-14',
      appointmentTime: '10:00',
      center: 'Galadimawa',
      doctor: grace,
      candidateDoctors: [grace],
    }, makeDeps([{ id: 'busy-1', appointment_time: '10:00', status: 'confirmed' }]))

    expect(result.status).toBe('unavailable')
    expect(result.alternatives).toHaveLength(3)
    expect(result.alternatives[0]).toMatchObject({ appointmentDate: '2026-05-14', doctorId: 'grace' })
  })

  it('marks the slot for review when Google Calendar FreeBusy fails', async () => {
    const result = await checkAppointmentAvailability({
      appointmentDate: '2026-05-14',
      appointmentTime: '10:00',
      center: 'Galadimawa',
      doctor: grace,
    }, makeDeps([], { fail: true }))

    expect(result).toMatchObject({
      status: 'needs_review',
      reason: 'calendar_error',
      calendarStatus: 'pending_calendar_error',
    })
  })
})
