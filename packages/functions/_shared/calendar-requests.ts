export const CENTER_ADDRESSES: Record<string, string> = {
  Karu: 'No. 11 Ali Amodu Close (behind CBN Quarters), Karu, Abuja',
  Galadimawa: 'No. 10 Royal Homes Estate, Galadinmawa, Abuja',
  Both: 'Serenity Royale Hospital, Abuja',
}

export interface CalendarEventParams {
  patientName: string
  patientPhone: string
  doctorName: string
  serviceType: string
  center: string
  appointmentDate: string
  appointmentTime: string
  reason?: string
}

export function buildAppointmentEventRequest(params: CalendarEventParams): Record<string, unknown> {
  const startDateTime = `${params.appointmentDate}T${params.appointmentTime}:00`
  const endTime = incrementTime(params.appointmentTime, 60)
  const endDateTime = `${params.appointmentDate}T${endTime}:00`
  const address = CENTER_ADDRESSES[params.center] ?? params.center

  return {
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
  }
}

export function buildFreeBusyRequest(calendarId: string, date: string, time: string, durationMinutes = 60): Record<string, unknown> {
  return {
    timeMin: `${date}T${time}:00+01:00`,
    timeMax: `${date}T${incrementTime(time, durationMinutes)}:00+01:00`,
    timeZone: 'Africa/Lagos',
    items: [{ id: calendarId }],
  }
}

export function incrementTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  const newH = Math.floor(total / 60) % 24
  const newM = total % 60
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`
}
