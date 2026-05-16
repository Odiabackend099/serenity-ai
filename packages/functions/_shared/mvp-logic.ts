import type { AIMessage, BookingSessionRow, PatientRow } from './types.ts'

export type ValidationResult<T> = {
  value: T | null
  error: string | null
}

export type DoctorContact = {
  id: string
  name: string
  phone: string | null
  location?: string | null
}

export type PatientContext = Pick<PatientRow, 'id' | 'phone_number' | 'name' | 'email' | 'gender' | 'location' | 'consent_ndpr' | 'consent_date' | 'created_at' | 'updated_at'>

export type AppointmentMemoryRow = {
  id: string
  appointment_date: string
  appointment_time: string | null
  center: string | null
  service_type: string | null
  reason: string | null
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled'
  created_at: string
  created_from_whatsapp?: boolean | null
  doctors?: { name?: string | null } | null
}

export type EmergencyMemoryRow = {
  id: string
  alert_type: string | null
  severity: string | null
  created_at: string
}

export type PatientMemoryContext = {
  patient: PatientContext
  latestAppointment: AppointmentMemoryRow | null
  latestCompletedBooking: BookingSessionRow | null
  recentConversation: AIMessage[]
  unresolvedEmergency: EmergencyMemoryRow | null
}

const PLACEHOLDER_PATIENT_NAME_TOKENS = new Set([
  'anonymous',
  'demo',
  'dummy',
  'guest',
  'na',
  'none',
  'null',
  'patient',
  'placeholder',
  'qa',
  'sample',
  'test',
  'testuser',
  'unknown',
  'undefined',
  'user',
])

export function isAdminInstruction(message: string): boolean {
  return matchesAny(message, [
    'admin',
    'booked today',
    'bookings today',
    'appointment summary',
    'appointments today',
    'appointments tomorrow',
    'appointments next week',
    'appointments next month',
    'patients due',
    'remind all patients',
    'send reminder',
    'follow up patients',
    'patient follow up',
    'follow up reminder',
    'followup reminder',
    'open emergencies',
    'emergency summary',
    'urgent summary',
    'operations summary',
    'daily summary',
  ])
}

export function isAdminHelpIntent(message: string): boolean {
  return matchesAny(message, ['admin help', 'boss help', 'what can you do', 'commands', 'command list'])
}

export function buildAdminHelpResponse(): string {
  return `Yes boss. I can help with Serenity operations on WhatsApp.

Try:
• "Summary of bookings today"
• "Appointments tomorrow"
• "Appointments next week"
• "Remind patients tomorrow"
• "Remind patients next week"
• "Emergency summary"

For safety, I only accept these admin commands from Dr K and the operations secretary.`
}

export function isPhoneAuthorizedForAdminCommand(phoneNumber: string, configuredPhones: Array<string | null | undefined>): boolean {
  const configured = configuredPhones
    .filter((phone): phone is string => Boolean(phone?.trim()))
    .map(normalizePhoneDigits)

  const inbound = normalizePhoneDigits(phoneNumber)
  return configured.some((phone) => phone === inbound)
}

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function buildPatientMemoryPrompt(context: PatientMemoryContext): AIMessage | null {
  if (!isKnownPatient(context.patient) && !context.latestAppointment && !context.unresolvedEmergency) return null

  const greetingName = getPatientGreetingName(context.patient.name)
  const appointmentSummary = context.latestAppointment
    ? formatAppointmentForPatient(context.latestAppointment)
    : 'No appointment found.'
  const emergencySummary = context.unresolvedEmergency
    ? `${context.unresolvedEmergency.severity ?? 'Urgent'} ${context.unresolvedEmergency.alert_type ?? 'alert'} opened ${context.unresolvedEmergency.created_at}.`
    : 'No unresolved emergency alert.'

  return {
    role: 'system',
    content: `Patient context from Serenity database. Use only these verified facts; do not invent appointment details or doctor assignment.
If the patient asks whether you remember them, answer naturally that you can see the details already shared with Serenity. Do not say you are a large language model. Do not mention training data, memory limits, or internal system context.
Patient: ${context.patient.name ?? 'Unknown'} (${context.patient.phone_number ?? 'phone not available'})
Patient greeting name: ${greetingName ?? 'Do not use a name'}
Email: ${context.patient.email ?? 'Not provided'}
Gender: ${context.patient.gender ?? 'Not provided'}
Location: ${context.patient.location ?? 'Not provided'}
Consent: ${context.patient.consent_ndpr ? 'Recorded' : 'Not recorded'}
Latest appointment: ${appointmentSummary}
Emergency status: ${emergencySummary}`,
  }
}

export function formatAppointmentForPatient(
  appointment: AppointmentMemoryRow,
  options: { includeStatus?: boolean } = {},
): string {
  const includeStatus = options.includeStatus ?? true
  const status = appointmentStatusForPatient(appointment.status)
  const doctorName = getAppointmentDoctorName(appointment) ?? 'Doctor not assigned yet'
  const date = appointment.appointment_date ? formatDisplayDate(appointment.appointment_date) : 'Date not set'
  const time = appointment.appointment_time?.slice(0, 5) ?? 'Time not set'
  const lines = [
    includeStatus ? `Status: ${status}` : null,
    `Service: ${appointment.service_type ?? 'Consultation'}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Center: ${appointment.center ?? 'Not selected'}`,
    `Doctor: ${doctorName}`,
  ]

  return lines.filter(Boolean).join('\n')
}

export function appointmentStatusForPatient(status: AppointmentMemoryRow['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending secretary confirmation'
    case 'confirmed':
      return 'Confirmed'
    case 'rescheduled':
      return 'Rescheduled'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    case 'no_show':
      return 'Missed appointment'
    default:
      return 'Saved'
  }
}

export function getAppointmentDoctorName(appointment: AppointmentMemoryRow): string | null {
  return appointment.doctors?.name ?? null
}

export function isActiveAppointmentStatus(status: AppointmentMemoryRow['status']): boolean {
  return ['pending', 'confirmed', 'rescheduled'].includes(status)
}

export function isCurrentOrUpcomingAppointment(
  appointment: AppointmentMemoryRow,
  today: Date = todayInLagos(),
): boolean {
  return isActiveAppointmentStatus(appointment.status) && appointment.appointment_date >= toIsoDate(today)
}

export function isKnownPatient(patient: PatientContext): boolean {
  return Boolean(patient.name || patient.email || patient.gender || patient.location)
}

export function firstName(name: string): string {
  return normalizeWhitespace(name).split(' ')[0] ?? name
}

export function getPatientGreetingName(name: string | null | undefined): string | null {
  if (!name) return null

  const cleaned = normalizeWhitespace(name)
  if (!cleaned) return null

  const first = firstName(cleaned)
  const normalizedFirst = normalizeDoctorMatchText(first).replace(/\s+/g, '')
  const normalizedAll = normalizeDoctorMatchText(cleaned).replace(/\s+/g, '')

  if (!/[a-z]/i.test(first) || /\d/.test(first)) return null
  if (PLACEHOLDER_PATIENT_NAME_TOKENS.has(normalizedFirst) || PLACEHOLDER_PATIENT_NAME_TOKENS.has(normalizedAll)) {
    return null
  }

  return first
}

export function buildWelcomeBackGreeting(name: string | null | undefined): string {
  const greetingName = getPatientGreetingName(name)
  return greetingName ? `Welcome back, ${greetingName}.` : 'Welcome back.'
}

export function isSimpleGreeting(message: string): boolean {
  return ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'].includes(message)
}

export function isReturningPatientMemoryIntent(message: string): boolean {
  return matchesAny(message, [
    'do you remember me',
    'you remember me',
    'remember me',
    'do you know me',
    'you know me',
    'have we talked before',
    'have we spoken before',
    'have we chatted before',
    'do you have my details',
    'do you still have my details',
    'do you have my information',
    'do you still have my information',
    'am i in your system',
    'have i messaged before',
  ])
}

export function isAppointmentStatusIntent(message: string): boolean {
  return matchesAny(message, [
    'my appointment',
    'appointment status',
    'did you book',
    'is it booked',
    'do i have appointment',
    'do i have an appointment',
    'when is my appointment',
    'what about my appointment',
    'confirm my appointment',
  ])
}

export function isBookAppointmentIntentWithExistingAppointment(message: string): boolean {
  return matchesAny(message, ['book appointment', 'book an appointment', 'schedule appointment', 'see a doctor', 'book another appointment'])
}

export function isCancelAppointmentIntent(message: string): boolean {
  return matchesAny(message, ['cancel appointment', 'cancel my appointment', 'cancel it', 'cancel booking'])
}

export function isCancelAppointmentConfirmation(message: string): boolean {
  return ['yes cancel', 'confirm cancel', 'confirm cancel appointment', 'cancel it yes', 'yes cancel appointment'].some((phrase) => message.includes(phrase))
}

export function isSimpleYes(message: string): boolean {
  return ['yes', 'y', 'confirm', 'ok', 'okay', 'proceed'].includes(message)
}

export function wasLastAssistantCancelPrompt(context: PatientMemoryContext): boolean {
  const lastAssistantMessage = [...context.recentConversation].reverse().find((turn) => turn.role === 'assistant')
  return Boolean(lastAssistantMessage?.content.toLowerCase().includes('yes cancel'))
}

export function wasLastAssistantReschedulePrompt(context: PatientMemoryContext): boolean {
  const lastAssistantMessage = [...context.recentConversation].reverse().find((turn) => turn.role === 'assistant')
  return Boolean(lastAssistantMessage?.content.toLowerCase().includes('preferred new date and time'))
}

export function isKeepAppointmentIntent(message: string): boolean {
  return matchesAny(message, ['keep appointment', 'dont cancel', 'do not cancel', 'leave it', 'keep it'])
}

export function isRescheduleIntent(message: string): boolean {
  return matchesAny(message, ['reschedule', 'change appointment', 'change my appointment', 'move appointment', 'move my appointment'])
}

export function isDoctorStatusIntent(message: string): boolean {
  return matchesAny(message, ['who is my doctor', 'which doctor', 'doctor assigned', 'assigned doctor', 'my doctor'])
}

export function isSpeakToTeamIntent(message: string): boolean {
  return matchesAny(message, ['speak to team', 'talk to staff', 'talk to human', 'speak to someone', 'call me', 'human'])
}

export function buildAppointmentStatusReply(context: PatientMemoryContext, appointment: AppointmentMemoryRow): string {
  return `${buildWelcomeBackGreeting(context.patient.name)}\n\nHere is your latest appointment update:\n${formatAppointmentForPatient(appointment)}\n\nYou can reply "Cancel appointment", "Reschedule appointment", "Who is my doctor?", or "Speak to the team".`
}

export function getServicePrompt(): string {
  return 'What service do you need?\n\nReply with one option: Psychiatry, Drug rehabilitation, EEG, Neurology, Physiotherapy, General medicine, Dual diagnosis, or Consultation.'
}

export function parseFullName(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message)
  const lower = cleaned.toLowerCase()
  const looksLikeMenu = /[\n•]/.test(message) || ['book appointment', 'ask about', 'learn about', 'emergency support'].some((kw) => lower.includes(kw))
  const parts = cleaned.split(' ').filter((part) => /[a-z]/i.test(part))

  if (looksLikeMenu || cleaned.length < 5 || cleaned.length > 80 || parts.length < 2) {
    return { value: null, error: 'Please send your full name, first name and surname. For example: Ada Okafor.' }
  }
  return { value: cleaned, error: null }
}

export function parseSex(message: string): ValidationResult<string> {
  const lower = message.trim().toLowerCase()
  if (['male', 'm', 'man'].includes(lower)) return { value: 'Male', error: null }
  if (['female', 'f', 'woman'].includes(lower)) return { value: 'Female', error: null }
  if (['other', 'prefer not to say', 'rather not say', 'skip'].includes(lower)) return { value: 'Prefer not to say', error: null }
  return { value: null, error: 'Please reply with Male, Female, or Prefer not to say.' }
}

export function parseLocation(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message)
  if (!cleaned || cleaned.length < 2 || cleaned.length > 120 || /[\n•]/.test(message)) {
    return { value: null, error: 'Please send your current area or city. For example: Garki, Karu, Lagos, or outside Abuja.' }
  }
  return { value: cleaned, error: null }
}

export function parseServiceType(message: string): ValidationResult<string> {
  const lower = message.toLowerCase()
  if (lower.includes('drug') || lower.includes('addict') || lower.includes('rehab') || lower.includes('substance')) {
    return { value: 'Drug Abuse Treatment and Rehabilitation', error: null }
  }
  if (lower.includes('eeg') || lower.includes('encephal')) return { value: 'Encephalography (EEG)', error: null }
  if (lower.includes('neuro')) return { value: 'Neurology', error: null }
  if (lower.includes('physio')) return { value: 'Physiotherapy', error: null }
  if (lower.includes('general')) return { value: 'General Medical Practice', error: null }
  if (lower.includes('dual')) return { value: 'Dual Diagnosis', error: null }
  if (lower.includes('consult')) return { value: 'Consultancy Services', error: null }
  if (lower.includes('psych') || lower.includes('mental') || lower.includes('psychiat')) return { value: 'Psychological Medicine and Psychiatry', error: null }

  return { value: null, error: getServicePrompt() }
}

export function parseDoctorPreference(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message)
  if (!cleaned || cleaned.length > 80 || /[\n•]/.test(message)) {
    return { value: null, error: 'Please reply with a doctor name or say "any available doctor".' }
  }
  return { value: isAnyDoctorPreference(cleaned) ? 'Any available doctor' : cleaned, error: null }
}

export function parseAppointmentDate(message: string, today: Date = todayInLagos()): ValidationResult<string> {
  const lower = normalizeWhitespace(message).toLowerCase().replace(/,/g, '')
  let candidate: Date | null = null

  const iso = lower.match(/\b(\d{4})[-/\s](\d{1,2})[-/\s](\d{1,2})\b/)
  const dmy = lower.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/)
  const namedMonthDayFirst = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})\b/)
  const namedMonthMonthFirst = lower.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})\b/)

  if (iso) {
    candidate = makeUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  } else if (dmy) {
    candidate = makeUtcDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
  } else if (namedMonthDayFirst) {
    const month = monthNameToNumber(namedMonthDayFirst[2])
    if (month) candidate = makeUtcDate(Number(namedMonthDayFirst[3]), month, Number(namedMonthDayFirst[1]))
  } else if (namedMonthMonthFirst) {
    const month = monthNameToNumber(namedMonthMonthFirst[1])
    if (month) candidate = makeUtcDate(Number(namedMonthMonthFirst[3]), month, Number(namedMonthMonthFirst[2]))
  } else if (lower.includes('tomorrow')) {
    candidate = addDays(today, 1)
  } else if (lower.includes('next week')) {
    candidate = addDays(today, 7)
  } else {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const weekday = weekdays.findIndex((day) => lower.includes(day))
    if (weekday >= 0) {
      let daysAhead = (weekday - today.getUTCDay() + 7) % 7
      if (daysAhead === 0) daysAhead = 7
      candidate = addDays(today, daysAhead)
    }
  }

  if (!candidate) {
    return { value: null, error: 'Please send a valid future date, such as 2026-05-12, 12/05/2026, 18 May 2026, tomorrow, next week, or Monday.' }
  }

  const maxDate = addDays(today, 183)
  if (candidate <= today) return { value: null, error: 'Please choose a future appointment date.' }
  if (candidate > maxDate) return { value: null, error: 'Please choose a date within the next 6 months.' }
  if (candidate.getUTCDay() === 0) return { value: null, error: 'Outpatient appointments are Monday to Saturday. Please choose another date.' }

  return { value: toIsoDate(candidate), error: null }
}

export function parseAppointmentTime(message: string): ValidationResult<string> {
  const match = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (!match) {
    return { value: null, error: 'Please send a valid time between 8:00am and 4:00pm. For example: 10am or 14:30.' }
  }

  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const period = match[3]?.toLowerCase()

  if (minute > 59) return { value: null, error: 'Please send a valid time. For example: 10am or 14:30.' }
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  if (!period && hour > 0 && hour < 8) {
    return { value: null, error: 'Please include am or pm for that time. Outpatient hours are 8:00am to 4:00pm.' }
  }
  if (hour < 8 || hour > 16 || (hour === 16 && minute > 0)) {
    return { value: null, error: 'Outpatient appointments are between 8:00am and 4:00pm. Please choose another time.' }
  }

  return { value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, error: null }
}

export function parseCenter(message: string): ValidationResult<'Karu' | 'Galadimawa'> {
  const lower = message.toLowerCase()
  if (lower.includes('karu')) return { value: 'Karu', error: null }
  if (lower.includes('galad') || lower.includes('royal homes')) return { value: 'Galadimawa', error: null }
  return { value: null, error: 'Please choose one center: Karu or Galadimawa.' }
}

export function parseOptionalEmail(message: string): ValidationResult<string> {
  const cleaned = normalizeWhitespace(message).toLowerCase()
  if (['skip', 'no', 'none', 'no email', 'not now', 'n/a', 'na'].includes(cleaned)) {
    return { value: null, error: null }
  }

  const email = normalizeWhitespace(message)
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { value: null, error: 'Please send a valid email address, or reply SKIP if you do not want email confirmation.' }
  }

  return { value: email, error: null }
}

export function parseConfirmation(message: string): boolean | null {
  const lower = message.trim().toLowerCase()
  if (['yes', 'y', 'confirm', 'book it', 'proceed', 'ok', 'okay', 'sure', 'yes please'].some((word) => lower.includes(word))) return true
  if (['no', 'n', 'cancel', 'stop', 'not now', 'decline'].some((word) => lower.includes(word))) return false
  return null
}

export function buildBookingSummary(session: Partial<BookingSessionRow>): string {
  return `Please confirm these appointment details:\n\nName: ${session.collected_name ?? 'Not provided'}\nSex/Gender: ${session.collected_sex ?? 'Not provided'}\nLocation: ${session.collected_location ?? 'Not provided'}\nService: ${session.collected_service_type ?? 'Not provided'}\nDoctor: ${session.collected_doctor_preference ?? 'Any available doctor'}\nDate: ${session.collected_date ? formatDisplayDate(session.collected_date) : 'Not provided'}\nTime: ${session.collected_time?.slice(0, 5) ?? 'Not provided'}\nCenter: ${session.collected_center ?? 'Not provided'}\nEmail: ${session.collected_email ?? 'Not provided'}\n\nReply YES to submit this appointment request or NO to cancel.`
}

export function matchPreferredDoctor(preference: string | null, doctors: DoctorContact[]): DoctorContact | null {
  if (!preference || isAnyDoctorPreference(preference)) return null
  if (doctors.length === 0) return null

  const normalizedPreference = normalizeDoctorMatchText(preference)
  const drKAliases = ['dr k', 'doctor k', 'kunle', 'kune', 'adekunle', 'adesina', 'adeshina', 'adishina', 'akide', 'kunle adesina', 'kunle adeshina', 'adekunle adesina']
  const shouldPreferDrK = drKAliases.some((alias) => normalizedPreference.includes(alias))

  if (shouldPreferDrK) {
    return doctors.find((doctor) => {
      const normalizedName = normalizeDoctorMatchText(doctor.name)
      return normalizedName.includes('adekunle') || (normalizedName.includes('kunle') && normalizedName.includes('adesina'))
    }) ?? null
  }

  return doctors.find((doctor) => {
    const normalizedName = normalizeDoctorMatchText(doctor.name)
    return normalizedName.includes(normalizedPreference) ||
      normalizedPreference.includes(normalizedName) ||
      doctorNameAliases(doctor.name).some((alias) => normalizedPreference.includes(alias))
  }) ?? null
}

export function doctorNameAliases(name: string): string[] {
  const normalizedName = normalizeDoctorMatchText(name)
  if (normalizedName.includes('grace') && normalizedName.includes('ikeh')) return ['grace', 'ikeh', 'eke', 'grace ikeh', 'grace eke']
  if (normalizedName.includes('nnajiofor') && normalizedName.includes('osondu')) return ['nnajiofor', 'osondu', 'dr osondu', 'osundu']
  if (normalizedName.includes('olaleye') && normalizedName.includes('abiola')) return ['olaleye', 'abiola', 'olaleye abiola']
  if (normalizedName.includes('julson') && normalizedName.includes('jeles')) return ['julson', 'jeles', 'julson jeles']
  return []
}

export function normalizeCenter(value: string): 'Karu' | 'Galadimawa' {
  return value.toLowerCase().includes('karu') ? 'Karu' : 'Galadimawa'
}

export function normalizeServiceType(value?: string | null): string {
  return parseServiceType(value ?? '').value ?? 'Psychological Medicine and Psychiatry'
}

export function isCancelBooking(message: string): boolean {
  const lower = message.toLowerCase().trim()
  return ['cancel', 'stop booking', 'start over', 'abort', 'never mind', 'nevermind'].includes(lower)
}

export function isAnyDoctorPreference(value: string): boolean {
  const lower = value.toLowerCase()
  return ['any', 'any doctor', 'any available doctor', 'no preference', 'anyone', 'no specific doctor'].some((phrase) => lower.includes(phrase))
}

export function shouldAssignDoctorDuringBooking(preference: string | null | undefined): boolean {
  const cleaned = normalizeWhitespace(preference ?? '')
  return Boolean(cleaned && !isAnyDoctorPreference(cleaned))
}

export function doctorServesCenter(location: string, center: string): boolean {
  const normalizedLocation = normalizeDoctorMatchText(location)
  const normalizedCenter = normalizeDoctorMatchText(center)
  return normalizedLocation === 'both' || normalizedLocation.includes(normalizedCenter)
}

export function normalizeDoctorMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bdoctor\b/g, 'dr')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function todayInLagos(): Date {
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000)
  return new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate()))
}

export function makeUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
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
    timeZone: 'Africa/Lagos',
  })
}

function matchesAny(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword))
}

function monthNameToNumber(value: string): number | null {
  const normalized = value.toLowerCase()
  const monthMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }

  return monthMap[normalized] ?? null
}
