import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import Link from 'next/link'

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const supabase = await createServerSupabaseClient()
  const resolvedSearchParams = await searchParams
  const search = resolvedSearchParams.q ?? ''
  const page = parseInt(resolvedSearchParams.page ?? '1', 10)
  const perPage = 25
  const offset = (page - 1) * perPage

  let query = supabase
    .from('patients')
    .select('*, consent_log(consent_given, created_at), deletion_requests(status, requested_at)', { count: 'exact' })
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1)

  if (search) {
    query = query.or(`name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const { data: patients, count } = await query

  const totalPages = Math.ceil((count ?? 0) / perPage)

  function consentStatus(patient: typeof patients extends (infer T)[] | null ? T : never) {
    const consents = patient.consent_log as { consent_given: boolean; created_at: string }[] | null
    if (!consents || consents.length === 0) return { label: 'Consent not recorded', color: 'bg-red-100 text-red-700' }
    const latest = consents[consents.length - 1]
    if (!latest.consent_given) return { label: 'Declined', color: 'bg-orange-100 text-orange-700' }
    return { label: 'Consented', color: 'bg-green-100 text-green-700' }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
          <p className="text-gray-500 text-sm">{count?.toLocaleString() ?? 0} active patient records</p>
        </div>

        {/* Search */}
        <form method="GET" className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="Search name, phone, email..."
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-serenity-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-serenity-600 text-white rounded-lg text-sm font-medium hover:bg-serenity-700 transition"
          >
            Search
          </button>
          {search && (
            <Link
              href="/dashboard/patients"
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {patients && patients.length > 0 ? (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Patient</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Contact</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Data Consent</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">First Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {patients.map((patient) => {
                    const consent = consentStatus(patient)
                    const deletionReqs = patient.deletion_requests as { status: string; requested_at: string }[] | null
                    const hasPendingDeletion = deletionReqs?.some(d => d.status === 'pending')
                    return (
                      <tr key={patient.id} className={`hover:bg-serenity-50 transition ${hasPendingDeletion ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <Link href={`/dashboard/patients/${patient.id}`} className="flex items-center gap-3 group">
                            <div className="w-8 h-8 bg-serenity-100 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-serenity-700">
                              {patient.name?.[0]?.toUpperCase() ?? '?'}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 group-hover:text-serenity-700 transition">{patient.name ?? 'Unknown'}</p>
                              {patient.age && (
                                <p className="text-xs text-gray-400">{patient.age} yrs · {patient.gender ?? 'N/A'}</p>
                              )}
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-700">{patient.phone_number}</p>
                          {patient.email && (
                            <p className="text-xs text-gray-400 truncate max-w-[160px]">{patient.email}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {patient.location ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${consent.color}`}>
                            {consent.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {hasPendingDeletion ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                              Deletion requested
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {patient.created_at ? format(new Date(patient.created_at), 'MMM d, yyyy') : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Showing {offset + 1}–{Math.min(offset + perPage, count ?? 0)} of {count?.toLocaleString()} patients
              </p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/dashboard/patients?q=${search}&page=${page - 1}`}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/dashboard/patients?q=${search}&page=${page + 1}`}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 text-center py-16">
          <div className="mx-auto mb-3 h-10 w-10 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-400">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0" />
            </svg>
          </div>
          <p className="text-gray-500">
            {search ? `No patients matching "${search}"` : 'No patients yet'}
          </p>
          <p className="text-gray-400 text-sm mt-1">Patients register when they first message on WhatsApp</p>
        </div>
      )}
    </div>
  )
}
