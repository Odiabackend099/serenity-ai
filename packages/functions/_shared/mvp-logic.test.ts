import { describe, expect, it } from 'vitest'
import {
  buildWelcomeBackGreeting,
  buildAppointmentStatusReply,
  buildPatientMemoryPrompt,
  formatAppointmentForPatient,
  getPatientGreetingName,
  getAppointmentDoctorName,
  isAdminInstruction,
  isAnyDoctorPreference,
  isCancelAppointmentIntent,
  isCurrentOrUpcomingAppointment,
  isDoctorStatusIntent,
  isPhoneAuthorizedForAdminCommand,
  isReturningPatientMemoryIntent,
  isSimpleGreeting,
  matchPreferredDoctor,
  normalizeDoctorMatchText,
  parseAppointmentDate,
  parseAppointmentTime,
  parseCenter,
  parseConfirmation,
  parseDoctorPreference,
  parseFullName,
  parseOptionalEmail,
  parseServiceType,
  parseSex,
  shouldAssignDoctorDuringBooking,
} from './mvp-logic.ts'
import type { AppointmentMemoryRow, DoctorContact, PatientMemoryContext } from './mvp-logic.ts'

const fixedToday = new Date(Date.UTC(2026, 4, 9))

const doctors: DoctorContact[] = [
  { id: 'dr-k', name: 'Dr. Adekunle Adesina', phone: '+2348062197384', location: 'Galadimawa' },
  { id: 'grace', name: 'Dr. Grace Ikeh', phone: '+2349137565087', location: 'Galadimawa' },
  { id: 'osondu', name: 'Dr. Nnajiofor Osondu', phone: '+2348032706384', location: 'Karu' },
  { id: 'julson', name: 'Dr. Julson Jeles', phone: '+2348164453307', location: 'Galadimawa' },
  { id: 'olaleye', name: 'Dr. Olaleye Abiola', phone: '+2348083129916', location: 'Galadimawa' },
]

const appointment: AppointmentMemoryRow = {
  id: 'appt-1',
  appointment_date: '2026-05-11',
  appointment_time: '10:00',
  center: 'Galadimawa',
  service_type: 'Consultancy Services',
  reason: 'Booked via WhatsApp AI',
  status: 'pending',
  created_at: '2026-05-09T10:00:00Z',
  doctors: { name: 'Dr. Grace Ikeh' },
}

const memoryContext: PatientMemoryContext = {
  patient: {
    id: 'patient-1',
    phone_number: '+2348141995397',
    name: 'Austyn Samuah',
    email: 'austyn@example.com',
    gender: 'Male',
    location: 'Lugbe',
    consent_ndpr: true,
    consent_date: '2026-05-09T09:00:00Z',
    created_at: '2026-05-09T09:00:00Z',
    updated_at: '2026-05-09T09:00:00Z',
  },
  latestAppointment: appointment,
  latestCompletedBooking: null,
  recentConversation: [],
  unresolvedEmergency: null,
}

describe('booking flow parsers', () => {
  it('accepts a full name and rejects menu text as the name', () => {
    expect(parseFullName('Austyn Samuah')).toEqual({ value: 'Austyn Samuah', error: null })
    expect(parseFullName('Book appointment')).toMatchObject({ value: null })
  })

  it('normalizes sex, service, center, email, and confirmation inputs', () => {
    expect(parseSex('male').value).toBe('Male')
    expect(parseServiceType('Drug rehabilitation').value).toBe('Drug Abuse Treatment and Rehabilitation')
    expect(parseCenter('galadimawa').value).toBe('Galadimawa')
    expect(parseCenter('karu').value).toBe('Karu')
    expect(parseCenter('lekki')).toMatchObject({ value: null })
    expect(parseOptionalEmail('austyn@example.com')).toEqual({ value: 'austyn@example.com', error: null })
    expect(parseOptionalEmail('SKIP')).toEqual({ value: null, error: null })
    expect(parseConfirmation('yes')).toBe(true)
    expect(parseConfirmation('no')).toBe(false)
  })

  it('validates dates with a fixed Lagos date baseline', () => {
    expect(parseAppointmentDate('yesterday', fixedToday)).toMatchObject({ value: null })
    expect(parseAppointmentDate('2026-05-12', fixedToday).value).toBe('2026-05-12')
    expect(parseAppointmentDate('12/05/2026', fixedToday).value).toBe('2026-05-12')
    expect(parseAppointmentDate('18th may 2026', fixedToday).value).toBe('2026-05-18')
    expect(parseAppointmentDate('2026 05 18', fixedToday).value).toBe('2026-05-18')
    expect(parseAppointmentDate('Monday', fixedToday).value).toBe('2026-05-11')
    expect(parseAppointmentDate('Sunday', fixedToday)).toMatchObject({ value: null })
    expect(parseAppointmentDate('17th may 2026', fixedToday)).toMatchObject({ value: null, error: 'Outpatient appointments are Monday to Saturday. Please choose another date.' })
  })

  it('normalizes valid times and rejects out-of-hours times', () => {
    expect(parseAppointmentTime('4 pm').value).toBe('16:00')
    expect(parseAppointmentTime('14:30').value).toBe('14:30')
    expect(parseAppointmentTime('9pm')).toMatchObject({ value: null })
    expect(parseAppointmentTime('6')).toMatchObject({ value: null })
  })
})

describe('doctor preference matching', () => {
  it('matches Dr K aliases and common misspellings', () => {
    for (const preference of ['dr kunle adeshina', 'Dr K', 'Kunle', 'Adesina', 'Adeshina']) {
      expect(matchPreferredDoctor(preference, doctors)?.id).toBe('dr-k')
    }
  })

  it('matches branch doctors and preserves any-doctor preference', () => {
    expect(matchPreferredDoctor('Dr Grace', doctors)?.id).toBe('grace')
    expect(matchPreferredDoctor('Osondu', doctors)?.id).toBe('osondu')
    expect(matchPreferredDoctor('Julson', doctors)?.id).toBe('julson')
    expect(matchPreferredDoctor('Olaleye', doctors)?.id).toBe('olaleye')
    expect(parseDoctorPreference('any available doctor').value).toBe('Any available doctor')
    expect(isAnyDoctorPreference('any available doctor')).toBe(true)
    expect(shouldAssignDoctorDuringBooking('any available doctor')).toBe(false)
    expect(shouldAssignDoctorDuringBooking('Dr Grace Ikeh')).toBe(true)
    expect(shouldAssignDoctorDuringBooking(null)).toBe(false)
    expect(matchPreferredDoctor('any available doctor', doctors)).toBeNull()
  })
})

describe('admin command detection', () => {
  it('detects admin instructions only when phrasing is operational', () => {
    expect(isAdminInstruction(normalizeDoctorMatchText('Summary of patients booked today'))).toBe(true)
    expect(isAdminInstruction(normalizeDoctorMatchText('Remind all patients for follow-up tomorrow'))).toBe(true)
    expect(isAdminInstruction(normalizeDoctorMatchText('I need follow up care'))).toBe(false)
  })

  it('authorizes only configured Dr K or secretary numbers', () => {
    const configured = ['+2348062197384', '+2348072023652']
    expect(isPhoneAuthorizedForAdminCommand('whatsapp:+2348062197384', configured)).toBe(true)
    expect(isPhoneAuthorizedForAdminCommand('+2348072023652', configured)).toBe(true)
    expect(isPhoneAuthorizedForAdminCommand('+2348141995397', configured)).toBe(false)
  })
})

describe('returning patient memory helpers', () => {
  it('builds an appointment-aware greeting for a known patient', () => {
    expect(isSimpleGreeting('hi')).toBe(true)
    const response = buildAppointmentStatusReply(memoryContext, appointment)
    expect(response).toContain('Welcome back, Austyn')
    expect(response).toContain('Here is your latest appointment update:')
    expect(response).toContain('Pending secretary confirmation')
    expect(response).toContain('Dr. Grace Ikeh')
  })

  it('answers doctor-status facts without using Groq', () => {
    expect(isDoctorStatusIntent('who is my doctor')).toBe(true)
    expect(getAppointmentDoctorName(appointment)).toBe('Dr. Grace Ikeh')
    expect(formatAppointmentForPatient({ ...appointment, doctors: null })).toContain('Doctor not assigned yet')
    expect(buildPatientMemoryPrompt(memoryContext)?.content).toContain('Latest appointment:')
    expect(buildPatientMemoryPrompt(memoryContext)?.content).toContain('Patient greeting name: Austyn')
  })

  it('detects cancellation intent before any destructive change', () => {
    expect(isCancelAppointmentIntent('cancel it')).toBe(true)
    expect(formatAppointmentForPatient(appointment)).toContain('Status: Pending secretary confirmation')
  })

  it('suppresses placeholder names in patient-facing greetings', () => {
    expect(getPatientGreetingName('TestUser')).toBeNull()
    expect(buildWelcomeBackGreeting('TestUser')).toBe('Welcome back.')
    expect(buildPatientMemoryPrompt({
      ...memoryContext,
      patient: {
        ...memoryContext.patient,
        name: 'TestUser',
      },
    })?.content).toContain('Patient greeting name: Do not use a name')
  })

  it('detects returning-patient memory questions without catching clinical memory topics', () => {
    expect(isReturningPatientMemoryIntent('do you remember me')).toBe(true)
    expect(isReturningPatientMemoryIntent('do you still have my details')).toBe(true)
    expect(isReturningPatientMemoryIntent('I have memory loss')).toBe(false)
  })

  it('treats only current or upcoming active appointments as active memory context', () => {
    expect(isCurrentOrUpcomingAppointment(appointment, fixedToday)).toBe(true)
    expect(isCurrentOrUpcomingAppointment({
      ...appointment,
      status: 'confirmed',
      appointment_date: '2026-05-08',
    }, fixedToday)).toBe(false)
    expect(isCurrentOrUpcomingAppointment({
      ...appointment,
      status: 'completed',
      appointment_date: '2026-05-11',
    }, fixedToday)).toBe(false)
  })
})
