import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createServerSupabaseClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: patientsRaw, error } = await supabase
    .from('patients')
    .select('id, name, phone_number, email, age, gender, location, consent_ndpr, consent_date, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  type PatientRow = {
    id: string; name: string | null; phone_number: string; email: string | null
    age: number | null; gender: string | null; location: string | null
    consent_ndpr: boolean | null; consent_date: string | null; created_at: string | null
  }
  const patients = (patientsRaw ?? []) as unknown as PatientRow[]

  const headers = ['ID', 'Name', 'Phone', 'Email', 'Age', 'Gender', 'Location', 'NDPR Consent', 'Consent Date', 'Registered']

  const rows = patients.map((p) => [
    p.id,
    p.name ?? '',
    p.phone_number ?? '',
    p.email ?? '',
    p.age ?? '',
    p.gender ?? '',
    p.location ?? '',
    p.consent_ndpr ? 'Yes' : 'No',
    p.consent_date ?? '',
    p.created_at ? new Date(p.created_at).toISOString().split('T')[0] : '',
  ])

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="patients-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}
