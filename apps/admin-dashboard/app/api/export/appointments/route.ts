import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('appointments')
    .select('id, appointment_date, appointment_time, status, service_type, center, reason, patients(name, phone_number), doctors(name)')
    .order('appointment_date', { ascending: false })

  if (from) query = query.gte('appointment_date', from)
  if (to) query = query.lte('appointment_date', to)

  const { data: appointmentsRaw, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  type ApptRow = {
    id: string; appointment_date: string; appointment_time: string | null
    status: string; service_type: string | null; center: string | null; reason: string | null
    patients: { name?: string; phone_number?: string } | null
    doctors: { name?: string } | null
  }
  const appointments = (appointmentsRaw ?? []) as unknown as ApptRow[]

  const headers = ['ID', 'Date', 'Time', 'Patient Name', 'Patient Phone', 'Doctor', 'Service', 'Center', 'Status', 'Reason']

  const rows = appointments.map((a) => {
    const patient = a.patients
    const doctor = a.doctors
    return [
      a.id,
      a.appointment_date ?? '',
      a.appointment_time?.slice(0, 5) ?? '',
      patient?.name ?? '',
      patient?.phone_number ?? '',
      doctor?.name ?? '',
      a.service_type ?? '',
      a.center ?? '',
      a.status ?? '',
      sanitizeExportReason(a.reason),
    ]
  })

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const dateTag = from && to ? `${from}_to_${to}` : new Date().toISOString().split('T')[0]

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="appointments-${dateTag}.csv"`,
    },
  })
}

function sanitizeExportReason(reason: string | null): string {
  if (!reason) return ''
  return reason
    .split(' | ')
    .map((part) => part.toLowerCase().startsWith('calendar error:')
      ? 'Calendar note: Google Calendar check needs review. Appointment is saved for manual confirmation.'
      : part)
    .join(' | ')
}
