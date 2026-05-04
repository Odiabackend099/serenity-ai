/**
 * Google Calendar API integration for appointment management.
 * Uses a Service Account (JSON key) for server-to-server auth.
 * Source of truth: Serenity AI DB. Google Calendar is a sync target.
 *
 * Quota tracking: 100 events/hour per API guidelines.
 * Events deleted in GCal are flagged for admin review, not auto-deleted from DB.
 */

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_ID = Deno.env.get('GOOGLE_CALENDAR_ID') ?? ''

let _accessToken: string | null = null
let _tokenExpiry = 0

// Center addresses for calendar event descriptions
const CENTER_ADDRESSES: Record<string, string> = {
  Karu: 'No. 11 Ali Amodu Close (behind CBN Quarters), Karu, Abuja',
  Galadimawa: 'No. 10 Royal Homes Estate, Galadinmawa, Abuja',
  Both: 'Serenity Royale Hospital, Abuja',
}

interface ServiceAccountKey {
  client_email: string
  private_key: string
  private_key_id: string
}

export function isCalendarConfigured(): boolean {
  return Boolean(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') && CALENDAR_ID)
}

/**
 * Get a valid Google OAuth2 access token for the service account.
 * Caches the token until 60 seconds before expiry.
 */
async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _tokenExpiry - 60_000) {
    return _accessToken
  }

  const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!saJson || !CALENDAR_ID) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_CALENDAR_ID must be set')
  }

  const sa: ServiceAccountKey = JSON.parse(saJson)

  // Build JWT for Google service account
  const now = Math.floor(Date.now() / 1000)
  const expiry = now + 3600

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const claims = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: GOOGLE_TOKEN_URL,
    exp: expiry,
    iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const signingInput = `${header}.${claims}`

  // Import RSA private key
  const pemKey = sa.private_key.replace(/\\n/g, '\n')
  const pemBody = pemKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${signingInput}.${signature}`

  // Exchange JWT for access token
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Google token exchange failed: ${err}`)
  }

  const tokenData = await tokenRes.json() as { access_token: string; expires_in: number }
  _accessToken = tokenData.access_token
  _tokenExpiry = Date.now() + tokenData.expires_in * 1000

  return _accessToken
}

async function calendarRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const token = await getAccessToken()

  const res = await fetch(`${GOOGLE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Google Calendar ${method} ${path} failed (${res.status}): ${err}`)
  }

  if (res.status === 204) return null
  return res.json()
}

export interface CalendarEventParams {
  patientName: string
  patientPhone: string
  doctorName: string
  serviceType: string
  center: string
  appointmentDate: string // YYYY-MM-DD
  appointmentTime: string // HH:MM
  reason?: string
}

/**
 * Create a Google Calendar event for an appointment.
 * Returns the event ID for storage in appointments table.
 */
export async function createAppointmentEvent(params: CalendarEventParams): Promise<string> {
  const startDateTime = `${params.appointmentDate}T${params.appointmentTime}:00`
  // Default appointment duration: 1 hour
  const endTime = incrementTime(params.appointmentTime, 60)
  const endDateTime = `${params.appointmentDate}T${endTime}:00`

  const address = CENTER_ADDRESSES[params.center] ?? params.center

  const event = await calendarRequest('POST', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, {
    summary: `${params.serviceType.replace('_', ' ')} — ${params.patientName}`,
    description: [
      `Patient: ${params.patientName}`,
      `Phone: ${params.patientPhone}`,
      `Service: ${params.serviceType.replace('_', ' ')}`,
      `Doctor: ${params.doctorName}`,
      `Center: ${params.center}`,
      params.reason ? `Reason: ${params.reason}` : '',
      '',
      'Booked via Serenity AI WhatsApp System',
    ].filter(Boolean).join('\n'),
    location: address,
    start: { dateTime: startDateTime, timeZone: 'Africa/Lagos' },
    end: { dateTime: endDateTime, timeZone: 'Africa/Lagos' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  }) as { id: string }

  return event.id
}

/**
 * Update an existing calendar event (e.g., rescheduled appointment).
 */
export async function updateAppointmentEvent(
  eventId: string,
  params: Partial<CalendarEventParams>,
): Promise<void> {
  const updates: Record<string, unknown> = {}

  if (params.appointmentDate && params.appointmentTime) {
    const startDateTime = `${params.appointmentDate}T${params.appointmentTime}:00`
    const endTime = incrementTime(params.appointmentTime, 60)
    const endDateTime = `${params.appointmentDate}T${endTime}:00`
    updates.start = { dateTime: startDateTime, timeZone: 'Africa/Lagos' }
    updates.end = { dateTime: endDateTime, timeZone: 'Africa/Lagos' }
  }

  if (params.center) {
    updates.location = CENTER_ADDRESSES[params.center] ?? params.center
  }

  await calendarRequest('PATCH', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${eventId}`, updates)
}

/**
 * Cancel (delete) a calendar event.
 */
export async function cancelAppointmentEvent(eventId: string): Promise<void> {
  await calendarRequest('DELETE', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${eventId}`)
}

/**
 * Check if a doctor has availability for a given date/time.
 * Uses Google Calendar FreeBusy so external/manual events block confirmation.
 */
export async function checkCalendarConflict(
  date: string,
  time: string,
  durationMinutes = 60,
): Promise<boolean> {
  const startDateTime = `${date}T${time}:00+01:00`
  const endDateTime = `${date}T${incrementTime(time, durationMinutes)}:00+01:00`

  const data = await calendarRequest(
    'POST',
    '/freeBusy',
    {
      timeMin: startDateTime,
      timeMax: endDateTime,
      timeZone: 'Africa/Lagos',
      items: [{ id: CALENDAR_ID }],
    },
  ) as { calendars?: Record<string, { busy?: unknown[]; errors?: Array<{ reason?: string; domain?: string }> }> }

  const calendar = data.calendars?.[CALENDAR_ID]
  if (calendar?.errors?.length) {
    throw new Error(`Google Calendar FreeBusy failed: ${JSON.stringify(calendar.errors)}`)
  }

  return (calendar?.busy?.length ?? 0) > 0
}

/**
 * Add minutes to a HH:MM time string. Returns HH:MM.
 */
function incrementTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const newH = Math.floor(total / 60) % 24
  const newM = total % 60
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`
}
