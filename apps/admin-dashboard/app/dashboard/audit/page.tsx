import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import Link from 'next/link'

const PER_PAGE = 50

const ACTION_COLORS: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  READ: 'bg-gray-100 text-gray-600',
  LOGIN: 'bg-serenity-100 text-serenity-700',
  LOGOUT: 'bg-gray-100 text-gray-500',
  EXPORT: 'bg-purple-100 text-purple-700',
}

const ACTION_LABELS: Record<string, string> = {
  INSERT: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  READ: 'Viewed',
  LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  EXPORT: 'Downloaded',
}

const RESOURCE_LABELS: Record<string, string> = {
  admin_users: 'Staff users',
  appointments: 'Appointments',
  audit_log: 'Activity history',
  conversations: 'Messages',
  doctors: 'Doctors',
  emergency_alerts: 'Urgent alerts',
  notifications: 'Notifications',
  patients: 'Patients',
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    action?: string
    resource?: string
    from?: string
    to?: string
  }>
}) {
  const supabase = await createServerSupabaseClient()
  const resolvedSearchParams = await searchParams
  const page = Math.max(1, parseInt(resolvedSearchParams.page ?? '1', 10))
  const offset = (page - 1) * PER_PAGE

  const { action, resource, from, to } = resolvedSearchParams

  let query = supabase
    .from('audit_log')
    .select('*, admin_users(name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (action) query = query.eq('action_type', action.toUpperCase())
  if (resource) query = query.eq('resource_type', resource)
  if (from) query = query.gte('created_at', from + 'T00:00:00')
  if (to) query = query.lte('created_at', to + 'T23:59:59')

  const { data: logs, count } = await query

  const totalPages = Math.ceil((count ?? 0) / PER_PAGE)
  const exportFromDate = new Date().toISOString().split('T')[0]
  const exportTo = new Date()
  exportTo.setUTCDate(exportTo.getUTCDate() + 30)
  const exportToDate = exportTo.toISOString().split('T')[0]

  // Unique resource types for filter
  const { data: resourceTypes } = await supabase
    .from('audit_log')
    .select('resource_type')
    .order('resource_type')

  const uniqueResources = [...new Set(resourceTypes?.map((r) => r.resource_type).filter(Boolean))]

  function buildPageUrl(newPage: number) {
    const params = new URLSearchParams()
    params.set('page', String(newPage))
    if (action) params.set('action', action)
    if (resource) params.set('resource', resource)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return `/dashboard/audit?${params.toString()}`
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity History</h1>
          <p className="text-gray-500 text-sm">Record of important dashboard and patient-data changes for NDPR compliance.</p>
        </div>
        <a
          href="/api/export/patients"
          className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
        >
          Download Patients
        </a>
      </div>

      {/* ── Filters ── */}
      <form method="get" className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Activity</label>
          <select
            name="action"
            defaultValue={action ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
          >
            <option value="">All actions</option>
            {['INSERT', 'UPDATE', 'DELETE', 'READ', 'LOGIN', 'LOGOUT', 'EXPORT'].map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Record type</label>
          <select
            name="resource"
            defaultValue={resource ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
          >
            <option value="">All resources</option>
            {uniqueResources.map((r) => (
              <option key={r} value={r}>{RESOURCE_LABELS[r] ?? humanizeToken(r)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input
            name="from"
            type="date"
            defaultValue={from ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input
            name="to"
            type="date"
            defaultValue={to ?? ''}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 bg-serenity-600 text-white text-sm font-medium rounded-lg hover:bg-serenity-700 transition"
          >
            Filter
          </button>
          <a
            href="/dashboard/audit"
            className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
          >
            Reset
          </a>
        </div>
      </form>

      {/* ── Log Count ── */}
      <p className="text-sm text-gray-500 mb-3">
        {count?.toLocaleString() ?? 0} entries
        {(action || resource || from || to) && ' (filtered)'}
      </p>

      {/* ── Log Table ── */}
      {logs && logs.length > 0 ? (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Activity</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Record type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">User</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Location</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map((log) => {
                    const adminUser = log.admin_users as { name?: string; email?: string } | null
                    const actionType = log.action_type ?? 'UPDATE'
                    const hasChanges = log.old_value || log.new_value
                    return (
                      <tr key={log.id} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[actionType] ?? 'bg-gray-100 text-gray-600'}`}>
                            {ACTION_LABELS[actionType] ?? humanizeToken(actionType)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {log.resource_type ? RESOURCE_LABELS[log.resource_type] ?? humanizeToken(log.resource_type) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {adminUser ? (
                            <div>
                              <p className="text-xs font-medium text-gray-700">{adminUser.name}</p>
                              <p className="text-xs text-gray-400">{adminUser.email}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">System</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 font-mono whitespace-nowrap">
                          {log.ip_address ?? 'Dashboard'}
                        </td>
                        <td className="px-4 py-3">
                          {hasChanges ? (
                            <details className="cursor-pointer">
                              <summary className="text-xs text-serenity-600 hover:text-serenity-700 select-none">
                                View changes
                              </summary>
                              <div className="mt-1 space-y-1">
                                {log.old_value && (
                                  <div className="text-xs bg-red-50 border border-red-100 rounded p-1.5 max-w-xs overflow-auto">
                                    <p className="text-red-500 font-medium mb-0.5">Before</p>
                                    <pre className="text-gray-600 whitespace-pre-wrap break-all text-xs">
                                      {JSON.stringify(log.old_value, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {log.new_value && (
                                  <div className="text-xs bg-green-50 border border-green-100 rounded p-1.5 max-w-xs overflow-auto">
                                    <p className="text-green-600 font-medium mb-0.5">After</p>
                                    <pre className="text-gray-600 whitespace-pre-wrap break-all text-xs">
                                      {JSON.stringify(log.new_value, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </details>
                          ) : (
                            <span className="text-xs text-gray-300">No changes</span>
                          )}
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
              <p className="text-xs text-gray-500">
                Page {page} of {totalPages} · {count?.toLocaleString()} total entries
              </p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={buildPageUrl(page - 1)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-gray-50 transition"
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={buildPageUrl(page + 1)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-gray-50 transition"
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
          <p className="text-gray-500">No audit log entries found</p>
          {(action || resource || from || to) && (
            <p className="text-gray-400 text-sm mt-1">Try adjusting your filters</p>
          )}
        </div>
      )}

      {/* Export links */}
      <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
        <p className="text-sm font-medium text-gray-700 mb-3">Downloads</p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/export/patients"
            className="text-xs px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
          >
            Patients
          </a>
          <a
            href="/api/export/appointments"
            className="text-xs px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
          >
            All appointments
          </a>
          <a
            href={`/api/export/appointments?from=${exportFromDate}&to=${exportToDate}`}
            className="text-xs px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
          >
            Appointments for next 30 days
          </a>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          CSV exports are logged in the audit trail. Do not share patient data externally without NDPR authorization.
        </p>
      </div>
    </div>
  )
}

function humanizeToken(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
