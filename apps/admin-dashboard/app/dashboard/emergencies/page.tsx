import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import { acknowledgeAlert, resolveAlert } from './actions'
import EmergencyRealtimeRefresher from '@/components/dashboard/EmergencyRealtimeRefresher'

export default async function EmergenciesPage() {
  const supabase = await createServerSupabaseClient()

  const { data: alerts } = await supabase
    .from('emergency_alerts')
    .select('*, patients(name, phone_number)')
    .order('created_at', { ascending: false })
    .limit(50)

  const unresolved = alerts?.filter(a => !a.resolved_at) ?? []
  const resolved = alerts?.filter(a => a.resolved_at) ?? []

  function alertTypeColor(type: string | null) {
    switch (type) {
      case 'suicidal': return 'bg-red-100 text-red-800'
      case 'self_harm': return 'bg-red-100 text-red-800'
      case 'drug_overdose': return 'bg-orange-100 text-orange-800'
      case 'panic_attack': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  function escalationLabel(level: number) {
    switch (level) {
      case 1: return null
      case 2: return { text: 'Escalated L2 — SMS sent', color: 'text-orange-600' }
      case 3: return { text: 'Escalated L3 — Backup doctor notified', color: 'text-red-600' }
      default: return { text: 'Escalated L4 — Manual intervention required', color: 'text-red-800 font-bold' }
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Invisible realtime subscriber — refreshes page when alerts change */}
      <EmergencyRealtimeRefresher />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Emergency Alerts</h1>
        <p className="text-gray-500 text-sm">Crisis detections · Requires immediate attention · Auto-refreshes</p>
      </div>

      {/* Unresolved Alerts */}
      {unresolved.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold text-red-700 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            Unresolved ({unresolved.length})
          </h2>
          <div className="space-y-4">
            {unresolved.map((alert) => {
              const patient = alert.patients as { name?: string; phone_number?: string } | null
              const escalation = escalationLabel(alert.escalation_level ?? 1)
              return (
                <div key={alert.id} className="bg-white border-2 border-red-200 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Alert info */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-lg font-bold text-red-700">!</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-semibold text-gray-900">
                            {patient?.name ?? patient?.phone_number ?? 'Unknown Patient'}
                          </p>
                          {patient?.phone_number && (
                            <a
                              href={`tel:${patient.phone_number}`}
                              className="text-xs text-serenity-600 hover:underline"
                            >
                              {patient.phone_number}
                            </a>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${alertTypeColor(alert.alert_type)}`}>
                            {alert.alert_type?.replace('_', ' ') ?? 'Crisis'}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            alert.severity === 'critical' ? 'bg-red-600 text-white' : 'bg-orange-100 text-orange-700'
                          }`}>
                            {alert.severity}
                          </span>
                        </div>

                        {escalation && (
                          <p className={`text-xs mb-1 ${escalation.color}`}>{escalation.text}</p>
                        )}

                        {alert.keywords_detected && alert.keywords_detected.length > 0 && (
                          <p className="text-sm text-gray-600 mb-2">
                            Keywords: {alert.keywords_detected.join(', ')}
                          </p>
                        )}

                        {alert.alert_message && (
                          <p className="text-sm text-gray-500 italic bg-gray-50 p-2 rounded text-xs mb-3">
                            &ldquo;{alert.alert_message}&rdquo;
                          </p>
                        )}

                        {/* Notification status */}
                        <div className="flex gap-3 text-xs text-gray-400 mb-3">
                          <span className={alert.whatsapp_notified_at ? 'text-green-600' : 'text-red-400'}>
                            {alert.whatsapp_notified_at ? '✓' : '✗'} WhatsApp
                          </span>
                          <span className={alert.email_notified_at ? 'text-green-600' : 'text-red-400'}>
                            {alert.email_notified_at ? '✓' : '✗'} Email
                          </span>
                          <span className={alert.sms_notified_at ? 'text-green-600' : 'text-red-400'}>
                            {alert.sms_notified_at ? '✓' : '✗'} SMS
                          </span>
                        </div>

                        {/* ── Action Buttons ── */}
                        <div className="flex flex-wrap gap-2">
                          {!alert.acknowledged_at && (
                            <form action={acknowledgeAlert.bind(null, alert.id)}>
                              <button
                                type="submit"
                                className="px-3 py-1.5 bg-orange-500 text-white text-xs font-medium rounded-lg hover:bg-orange-600 transition"
                              >
                                Acknowledge
                              </button>
                            </form>
                          )}

                          <ResolveForm alertId={alert.id} />
                        </div>

                        {alert.acknowledged_at && (
                          <p className="text-xs text-green-600 mt-2">
                            ✓ Acknowledged {format(new Date(alert.acknowledged_at), 'MMM d, HH:mm')}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Time + status */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-400 mb-1">
                        {format(new Date(alert.created_at), 'MMM d, HH:mm')}
                      </p>
                      {alert.acknowledged_at ? (
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                          Acknowledged
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full animate-pulse">
                          Needs Action
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {unresolved.length === 0 && (
        <div className="mb-8 p-6 bg-green-50 border border-green-200 rounded-xl text-center">
          <div className="mx-auto mb-3 h-8 w-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </div>
          <p className="text-green-700 font-medium">No unresolved emergencies</p>
        </div>
      )}

      {/* Resolved Alerts */}
      {resolved.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-600 mb-3">Resolved ({resolved.length})</h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {resolved.map((alert, i) => {
              const patient = alert.patients as { name?: string; phone_number?: string } | null
              return (
                <div key={alert.id} className={`p-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-700 text-sm">
                        {patient?.name ?? patient?.phone_number ?? 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-400 capitalize">
                        {alert.alert_type?.replace('_', ' ') ?? 'Crisis'}
                        {alert.response_notes ? ` · ${alert.response_notes}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-400">{format(new Date(alert.created_at), 'MMM d, HH:mm')}</p>
                      <span className="text-xs text-green-600">✓ Resolved</span>
                      {alert.resolved_at && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          at {format(new Date(alert.resolved_at), 'HH:mm')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Inline resolve form with notes textarea.
 * Uses server action — no client JS required.
 */
function ResolveForm({ alertId }: { alertId: string }) {
  return (
    <form
      action={async (formData: FormData) => {
        'use server'
        const notes = formData.get('notes') as string
        await resolveAlert(alertId, notes)
      }}
      className="flex items-start gap-2"
    >
      <input
        type="text"
        name="notes"
        placeholder="Response notes (optional)"
        className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-serenity-500"
      />
      <button
        type="submit"
        className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition whitespace-nowrap"
      >
        Mark Resolved
      </button>
    </form>
  )
}
