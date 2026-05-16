export const LAGOS_TIME_ZONE = 'Africa/Lagos'
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60
export const SLOT_HOLD_MINUTES = 10
export const OUTPATIENT_START_MINUTES = 8 * 60
export const OUTPATIENT_END_MINUTES = 16 * 60
export const SLOT_SEARCH_DAYS = 14
export const SLOT_STEP_MINUTES = 30

export type ActiveAppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'rescheduled' | 'cancelled' | 'no_show'

export type AvailabilityDoctor = {
  id: string
  name: string
  phone?: string | null
  location?: string | null
}

export type BusyAppointment = {
  id: string
  appointment_time: string | null
  status?: ActiveAppointmentStatus | string | null
}

export type BusySlotHold = {
  id: string
  appointment_time: string | null
  duration_minutes?: number | null
  booking_session_id?: string | null
  expires_at?: string | null
  status?: string | null
}

export type AvailabilityDeps = {
  listActiveAppointments: (params: {
    doctorId: string
    appointmentDate: string
    excludeAppointmentId?: string | null
  }) => Promise<BusyAppointment[]>
  listActiveSlotHolds?: (params: {
    doctorId: string
    appointmentDate: string
    excludeBookingSessionId?: string | null
  }) => Promise<BusySlotHold[]>
  isCalendarConfigured: () => boolean
  checkCalendarConflict: (date: string, time: string, durationMinutes: number) => Promise<boolean>
  now?: () => Date
}

export type AvailabilityRequest = {
  appointmentDate: string
  appointmentTime: string
  center: string
  doctor?: AvailabilityDoctor | null
  candidateDoctors?: AvailabilityDoctor[]
  durationMinutes?: number
  excludeAppointmentId?: string | null
  excludeBookingSessionId?: string | null
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'needs_review' | 'invalid' | 'no_doctor'
export type AvailabilityReason =
  | 'available'
  | 'past_date'
  | 'sunday'
  | 'outside_hours'
  | 'no_doctor'
  | 'doctor_center_mismatch'
  | 'database_conflict'
  | 'slot_hold_conflict'
  | 'calendar_busy'
  | 'calendar_not_configured'
  | 'calendar_error'

export type SuggestedSlot = {
  doctorId: string
  doctorName: string
  appointmentDate: string
  appointmentTime: string
  center: string
}

export type AppointmentAvailabilityResult = {
  status: AvailabilityStatus
  reason: AvailabilityReason
  doctor: AvailabilityDoctor | null
  appointmentDate: string
  appointmentTime: string
  durationMinutes: number
  calendarStatus: string
  calendarError: string | null
  alternatives: SuggestedSlot[]
  patientMessage: string
}

export function validateAppointmentSlot(
  appointmentDate: string,
  appointmentTime: string,
  durationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: Extract<AvailabilityReason, 'past_date' | 'sunday' | 'outside_hours'>; message: string } {
  const date = parseIsoDate(appointmentDate)
  const minutes = timeToMinutes(appointmentTime)
  const today = todayInLagos(now)
  const currentMinutes = currentMinutesInLagos(now)

  if (!date || minutes === null) {
    return {
      ok: false,
      reason: 'outside_hours',
      message: 'Please choose a valid appointment date and time during outpatient hours.',
    }
  }

  if (date.getTime() < today.getTime()) {
    return {
      ok: false,
      reason: 'past_date',
      message: 'Please choose a future appointment date.',
    }
  }

  if (date.getTime() === today.getTime() && minutes <= currentMinutes) {
    return {
      ok: false,
      reason: 'past_date',
      message: 'Please choose a future appointment time.',
    }
  }

  if (date.getUTCDay() === 0) {
    return {
      ok: false,
      reason: 'sunday',
      message: 'Outpatient appointments are Monday to Saturday. Please choose another date.',
    }
  }

  if (minutes < OUTPATIENT_START_MINUTES || minutes + durationMinutes > OUTPATIENT_END_MINUTES) {
    return {
      ok: false,
      reason: 'outside_hours',
      message: 'Outpatient appointments are between 8:00am and 4:00pm. Please choose a time that fits a 60-minute appointment.',
    }
  }

  return { ok: true }
}

export async function checkAppointmentAvailability(
  request: AvailabilityRequest,
  deps: AvailabilityDeps,
): Promise<AppointmentAvailabilityResult> {
  const durationMinutes = request.durationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES
  const validation = validateAppointmentSlot(
    request.appointmentDate,
    request.appointmentTime,
    durationMinutes,
    deps.now?.() ?? new Date(),
  )

  if (!validation.ok) {
    return buildResult({
      status: 'invalid',
      reason: validation.reason,
      doctor: null,
      request,
      durationMinutes,
      calendarStatus: 'not_checked',
      calendarError: null,
      alternatives: [],
      patientMessage: validation.message,
    })
  }

  const doctors = normalizeCandidateDoctors(request)
  if (doctors.length === 0) {
    return buildResult({
      status: 'no_doctor',
      reason: 'no_doctor',
      doctor: null,
      request,
      durationMinutes,
      calendarStatus: 'pending_no_matched_doctor',
      calendarError: null,
      alternatives: [],
      patientMessage: 'A doctor needs to be assigned before I can confirm this appointment.',
    })
  }

  let firstUnavailable: AppointmentAvailabilityResult | null = null
  for (const doctor of doctors) {
    const slot = await checkDoctorSlot(request, doctor, durationMinutes, deps)
    if (slot.status === 'available' || slot.status === 'needs_review') return slot
    if (!firstUnavailable) firstUnavailable = slot
  }

  const alternatives = await suggestAlternativeSlots(request, doctors, deps, 3)
  return buildResult({
    status: 'unavailable',
    reason: firstUnavailable?.reason ?? 'database_conflict',
    doctor: firstUnavailable?.doctor ?? request.doctor ?? null,
    request,
    durationMinutes,
    calendarStatus: firstUnavailable?.calendarStatus ?? 'busy',
    calendarError: firstUnavailable?.calendarError ?? null,
    alternatives,
    patientMessage: alternatives.length > 0
      ? 'That time is not available. I found the closest alternatives.'
      : firstUnavailable?.patientMessage ?? 'That time is not available and I could not find another open slot in the next two weeks.',
  })
}

export async function suggestAlternativeSlots(
  request: AvailabilityRequest,
  doctors: AvailabilityDoctor[],
  deps: AvailabilityDeps,
  minimumCount = 3,
): Promise<SuggestedSlot[]> {
  const durationMinutes = request.durationMinutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES
  const requestedDate = parseIsoDate(request.appointmentDate)
  const requestedMinutes = timeToMinutes(request.appointmentTime) ?? OUTPATIENT_START_MINUTES
  const today = todayInLagos(deps.now?.() ?? new Date())
  const startDate = requestedDate && requestedDate.getTime() >= today.getTime() ? requestedDate : today
  const alternatives: SuggestedSlot[] = []

  for (let dayOffset = 0; dayOffset < SLOT_SEARCH_DAYS && alternatives.length < minimumCount; dayOffset += 1) {
    const date = addDays(startDate, dayOffset)
    if (date.getUTCDay() === 0) continue

    const dateIso = toIsoDate(date)
    const candidateTimes = buildCandidateTimes(requestedMinutes, durationMinutes)
    for (const appointmentTime of candidateTimes) {
      if (dateIso === request.appointmentDate && appointmentTime === normalizeTime(request.appointmentTime)) continue
      if (!validateAppointmentSlot(dateIso, appointmentTime, durationMinutes, deps.now?.() ?? new Date()).ok) continue

      for (const doctor of doctors) {
        const candidateRequest = { ...request, appointmentDate: dateIso, appointmentTime, doctor, candidateDoctors: [doctor] }
        const slot = await checkDoctorSlot(candidateRequest, doctor, durationMinutes, deps)
        if (slot.status === 'available') {
          alternatives.push({
            doctorId: doctor.id,
            doctorName: doctor.name,
            appointmentDate: dateIso,
            appointmentTime,
            center: request.center,
          })
          break
        }
      }

      if (alternatives.length >= minimumCount) break
    }
  }

  return alternatives
}

async function checkDoctorSlot(
  request: AvailabilityRequest,
  doctor: AvailabilityDoctor,
  durationMinutes: number,
  deps: AvailabilityDeps,
): Promise<AppointmentAvailabilityResult> {
  if (!doctorServesCenter(doctor.location ?? 'Both', request.center)) {
    return buildResult({
      status: 'unavailable',
      reason: 'doctor_center_mismatch',
      doctor,
      request,
      durationMinutes,
      calendarStatus: 'pending_doctor_center_mismatch',
      calendarError: null,
      alternatives: [],
      patientMessage: `${doctor.name} is not listed for the selected center.`,
    })
  }

  const appointments = await deps.listActiveAppointments({
    doctorId: doctor.id,
    appointmentDate: request.appointmentDate,
    excludeAppointmentId: request.excludeAppointmentId,
  })
  if (hasOverlappingAppointment(appointments, request.appointmentTime, durationMinutes)) {
    return buildResult({
      status: 'unavailable',
      reason: 'database_conflict',
      doctor,
      request,
      durationMinutes,
      calendarStatus: 'pending_database_conflict',
      calendarError: null,
      alternatives: [],
      patientMessage: 'That doctor already has an appointment around that time.',
    })
  }

  const holds = deps.listActiveSlotHolds
    ? await deps.listActiveSlotHolds({
      doctorId: doctor.id,
      appointmentDate: request.appointmentDate,
      excludeBookingSessionId: request.excludeBookingSessionId,
    })
    : []
  if (hasOverlappingHold(holds, request.appointmentTime, durationMinutes, deps.now?.() ?? new Date())) {
    return buildResult({
      status: 'unavailable',
      reason: 'slot_hold_conflict',
      doctor,
      request,
      durationMinutes,
      calendarStatus: 'pending_database_conflict',
      calendarError: null,
      alternatives: [],
      patientMessage: 'That slot is currently being held for another patient.',
    })
  }

  if (!deps.isCalendarConfigured()) {
    return buildResult({
      status: 'needs_review',
      reason: 'calendar_not_configured',
      doctor,
      request,
      durationMinutes,
      calendarStatus: 'pending_calendar_not_configured',
      calendarError: 'Google Calendar is not configured',
      alternatives: [],
      patientMessage: 'The database slot is open, but calendar sync needs secretary review.',
    })
  }

  try {
    const calendarBusy = await deps.checkCalendarConflict(request.appointmentDate, request.appointmentTime, durationMinutes)
    if (calendarBusy) {
      return buildResult({
        status: 'unavailable',
        reason: 'calendar_busy',
        doctor,
        request,
        durationMinutes,
        calendarStatus: 'pending_calendar_busy',
        calendarError: null,
        alternatives: [],
        patientMessage: 'Google Calendar shows that time as busy.',
      })
    }
  } catch (err) {
    return buildResult({
      status: 'needs_review',
      reason: 'calendar_error',
      doctor,
      request,
      durationMinutes,
      calendarStatus: 'pending_calendar_error',
      calendarError: err instanceof Error ? err.message : String(err),
      alternatives: [],
      patientMessage: 'The database slot is open, but Google Calendar needs secretary review.',
    })
  }

  return buildResult({
    status: 'available',
    reason: 'available',
    doctor,
    request,
    durationMinutes,
    calendarStatus: 'available',
    calendarError: null,
    alternatives: [],
    patientMessage: 'That time is available.',
  })
}

export function hasOverlappingAppointment(
  appointments: BusyAppointment[],
  appointmentTime: string,
  durationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
): boolean {
  return appointments.some((appointment) => {
    if (!appointment.appointment_time || isNonBlockingAppointmentStatus(appointment.status)) return false
    return rangesOverlap(appointment.appointment_time, DEFAULT_APPOINTMENT_DURATION_MINUTES, appointmentTime, durationMinutes)
  })
}

export function hasOverlappingHold(
  holds: BusySlotHold[],
  appointmentTime: string,
  durationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
  now: Date = new Date(),
): boolean {
  const nowMs = now.getTime()
  return holds.some((hold) => {
    if (hold.status && hold.status !== 'active') return false
    if (!hold.appointment_time) return false
    if (hold.expires_at && new Date(hold.expires_at).getTime() <= nowMs) return false
    return rangesOverlap(hold.appointment_time, hold.duration_minutes ?? DEFAULT_APPOINTMENT_DURATION_MINUTES, appointmentTime, durationMinutes)
  })
}

export function isNonBlockingAppointmentStatus(status?: string | null): boolean {
  return status === 'cancelled' || status === 'no_show'
}

export function buildCandidateTimes(
  requestedMinutes: number,
  durationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
): string[] {
  const times: number[] = []
  for (let minutes = OUTPATIENT_START_MINUTES; minutes + durationMinutes <= OUTPATIENT_END_MINUTES; minutes += SLOT_STEP_MINUTES) {
    times.push(minutes)
  }

  return times
    .sort((a, b) => Math.abs(a - requestedMinutes) - Math.abs(b - requestedMinutes) || a - b)
    .map(minutesToTime)
}

export function doctorServesCenter(location: string, center: string): boolean {
  const normalizedLocation = normalizeMatchText(location)
  const normalizedCenter = normalizeMatchText(center)
  if (normalizedLocation === 'both') return true
  if (isGaladimawaText(normalizedCenter)) return isGaladimawaText(normalizedLocation)
  if (normalizedCenter.includes('karu')) return normalizedLocation.includes('karu')
  return normalizedLocation.includes(normalizedCenter)
}

export function formatSuggestedSlot(slot: SuggestedSlot): string {
  return `${formatDisplayDate(slot.appointmentDate)} at ${slot.appointmentTime.slice(0, 5)} with ${slot.doctorName} (${slot.center})`
}

export function todayInLagos(now: Date = new Date()): Date {
  const lagosNow = new Date(now.getTime() + 60 * 60 * 1000)
  return new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate()))
}

export function currentMinutesInLagos(now: Date = new Date()): number {
  const lagosNow = new Date(now.getTime() + 60 * 60 * 1000)
  return lagosNow.getUTCHours() * 60 + lagosNow.getUTCMinutes()
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 3600000)
}

export function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function formatDisplayDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: LAGOS_TIME_ZONE,
  })
}

export function timeToMinutes(time: string): number | null {
  const normalized = normalizeTime(time)
  const match = normalized.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function normalizeTime(time: string): string {
  return time.slice(0, 5)
}

function rangesOverlap(aStartTime: string, aDuration: number, bStartTime: string, bDuration: number): boolean {
  const aStart = timeToMinutes(aStartTime)
  const bStart = timeToMinutes(bStartTime)
  if (aStart === null || bStart === null) return false
  const aEnd = aStart + aDuration
  const bEnd = bStart + bDuration
  return aStart < bEnd && bStart < aEnd
}

function normalizeCandidateDoctors(request: AvailabilityRequest): AvailabilityDoctor[] {
  const doctors = request.doctor ? [request.doctor] : request.candidateDoctors ?? []
  const seen = new Set<string>()
  return doctors.filter((doctor) => {
    if (!doctor?.id || seen.has(doctor.id)) return false
    seen.add(doctor.id)
    return true
  })
}

function parseIsoDate(isoDate: string): Date | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isGaladimawaText(value: string): boolean {
  return value.includes('galad') || value.includes('royal homes')
}

function buildResult(params: {
  status: AvailabilityStatus
  reason: AvailabilityReason
  doctor: AvailabilityDoctor | null
  request: AvailabilityRequest
  durationMinutes: number
  calendarStatus: string
  calendarError: string | null
  alternatives: SuggestedSlot[]
  patientMessage: string
}): AppointmentAvailabilityResult {
  return {
    status: params.status,
    reason: params.reason,
    doctor: params.doctor,
    appointmentDate: params.request.appointmentDate,
    appointmentTime: normalizeTime(params.request.appointmentTime),
    durationMinutes: params.durationMinutes,
    calendarStatus: params.calendarStatus,
    calendarError: params.calendarError,
    alternatives: params.alternatives,
    patientMessage: params.patientMessage,
  }
}
