import { describe, expect, it } from 'vitest'
import {
  checkAppointmentAvailability,
  doctorServesCenter,
  hasOverlappingAppointment,
  suggestAlternativeSlots,
  validateAppointmentSlot,
  type AvailabilityDeps,
  type AvailabilityDoctor,
  type BusyAppointment,
} from './appointment-availability.ts'
import { matchPreferredDoctor } from './mvp-logic.ts'

const fixedNow = new Date('2026-05-13T09:00:00.000Z')

const doctors: AvailabilityDoctor[] = [
  { id: 'dr-k', name: 'Dr. Adekunle Adesina', phone: '+2348062197384', location: 'Both' },
  { id: 'grace', name: 'Dr. Grace Ikeh', phone: '+2349137565087', location: 'Galadimawa' },
  { id: 'osondu', name: 'Dr. Nnajiofor Osondu', phone: '+2348032706384', location: 'Karu' },
]

function makeDeps(appointments: BusyAppointment[] = [], options: { calendarBusy?: boolean; calendarConfigured?: boolean } = {}): AvailabilityDeps {
  return {
    now: () => fixedNow,
    listActiveAppointments: async () => appointments,
    listActiveSlotHolds: async () => [],
    isCalendarConfigured: () => options.calendarConfigured ?? true,
    checkCalendarConflict: async () => options.calendarBusy ?? false,
  }
}

describe('appointment availability rules', () => {
  it('rejects Sundays and 4:00pm starts for 60-minute appointments', () => {
    expect(validateAppointmentSlot('2026-05-17', '10:00', 60, fixedNow)).toMatchObject({ ok: false, reason: 'sunday' })
    expect(validateAppointmentSlot('2026-05-15', '16:00', 60, fixedNow)).toMatchObject({ ok: false, reason: 'outside_hours' })
    expect(validateAppointmentSlot('2026-05-15', '15:00', 60, fixedNow)).toEqual({ ok: true })
  })

  it('rejects same-day times that are already past in Lagos', () => {
    expect(validateAppointmentSlot('2026-05-13', '08:00', 60, fixedNow)).toMatchObject({ ok: false, reason: 'past_date' })
    expect(validateAppointmentSlot('2026-05-13', '10:30', 60, fixedNow)).toEqual({ ok: true })
  })

  it('matches doctors by aliases and filters doctors by center', () => {
    expect(matchPreferredDoctor('Dr K', doctors)?.id).toBe('dr-k')
    expect(matchPreferredDoctor('Grace Eke', doctors)?.id).toBe('grace')
    expect(doctorServesCenter('Both', 'Karu')).toBe(true)
    expect(doctorServesCenter('Galadinmawa', 'Galadimawa')).toBe(true)
    expect(doctorServesCenter('Galadimawa', 'Karu')).toBe(false)
  })

  it('detects overlapping Supabase appointments and ignores no-shows', () => {
    expect(hasOverlappingAppointment([
      { id: 'appt-1', appointment_time: '10:30', status: 'confirmed' },
    ], '10:00', 60)).toBe(true)

    expect(hasOverlappingAppointment([
      { id: 'appt-1', appointment_time: '10:30', status: 'no_show' },
    ], '10:00', 60)).toBe(false)
  })

  it('returns available when DB and calendar are free', async () => {
    const result = await checkAppointmentAvailability({
      appointmentDate: '2026-05-15',
      appointmentTime: '10:00',
      center: 'Galadimawa',
      doctor: doctors[1],
    }, makeDeps())

    expect(result).toMatchObject({
      status: 'available',
      reason: 'available',
      doctor: { id: 'grace' },
    })
  })

  it('returns at least three closest alternatives when requested slot is busy', async () => {
    const deps = makeDeps([{ id: 'appt-1', appointment_time: '10:00', status: 'confirmed' }])
    const alternatives = await suggestAlternativeSlots({
      appointmentDate: '2026-05-15',
      appointmentTime: '10:00',
      center: 'Galadimawa',
      doctor: doctors[1],
      candidateDoctors: [doctors[1]],
    }, [doctors[1]], deps, 3)

    expect(alternatives).toHaveLength(3)
    expect(alternatives.map((slot) => slot.appointmentTime)).toEqual(['09:00', '11:00', '08:30'])
    expect(alternatives.every((slot) => slot.doctorId === 'grace')).toBe(true)
  })

  it('does not suggest same-day times that are already past in Lagos', async () => {
    const deps: AvailabilityDeps = {
      ...makeDeps([{ id: 'appt-1', appointment_time: '15:00', status: 'confirmed' }]),
      now: () => new Date('2026-05-15T13:45:00.000Z'), // 14:45 in Lagos
    }
    const alternatives = await suggestAlternativeSlots({
      appointmentDate: '2026-05-15',
      appointmentTime: '15:00',
      center: 'Galadimawa',
      doctor: doctors[1],
      candidateDoctors: [doctors[1]],
    }, [doctors[1]], deps, 3)

    expect(alternatives).toHaveLength(3)
    expect(alternatives.some((slot) => slot.appointmentDate === '2026-05-15')).toBe(false)
  })
})
