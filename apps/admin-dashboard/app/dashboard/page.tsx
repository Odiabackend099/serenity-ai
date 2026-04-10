import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'

async function getDashboardStats(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const today = new Date().toISOString().split('T')[0]

  const [
    { count: totalPatients },
    { count: todayAppointments },
    { count: activeConversations },
    { count: unresolvedEmergencies },
    { count: pendingQueue },
  ] = await Promise.all([
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('is_archived', false),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('appointment_date', today).neq('status', 'cancelled'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('emergency_alerts').select('*', { count: 'exact', head: true }).is('resolved_at', null),
    supabase.from('message_queue').select('*', { count: 'exact', head: true }).in('status', ['queued', 'failed']),
  ])

  return {
    totalPatients: totalPatients ?? 0,
    todayAppointments: todayAppointments ?? 0,
    activeConversations: activeConversations ?? 0,
    unresolvedEmergencies: unresolvedEmergencies ?? 0,
    pendingQueue: pendingQueue ?? 0,
  }
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const stats = await getDashboardStats(supabase)

  // Get today's appointments
  const today = new Date().toISOString().split('T')[0]
  const { data: todayAppts } = await supabase
    .from('appointments')
    .select('*, patients(name, phone_number), doctors(name)')
    .eq('appointment_date', today)
    .neq('status', 'cancelled')
    .order('appointment_time', { ascending: true })
    .limit(5)

  // Get unresolved emergencies
  const { data: emergencies } = await supabase
    .from('emergency_alerts')
    .select('*, patients(name, phone_number)')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(3)

  const statCards = [
    {
      label: 'Total Patients',
      value: stats.totalPatients,
      color: 'bg-serenity-50 text-serenity-700',
      icon: '👥',
    },
    {
      label: "Today's Appointments",
      value: stats.todayAppointments,
      color: 'bg-teal-50 text-teal-700',
      icon: '📅',
    },
    {
      label: 'Conversations (24h)',
      value: stats.activeConversations,
      color: 'bg-purple-50 text-purple-700',
      icon: '💬',
    },
    {
      label: 'Unresolved Alerts',
      value: stats.unresolvedEmergencies,
      color: stats.unresolvedEmergencies > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700',
      icon: '🚨',
    },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm">{format(new Date(), 'EEEE, MMMM d, yyyy')} · Serenity Royale Hospital</p>
      </div>

      {/* Emergency Banner */}
      {stats.unresolvedEmergencies > 0 && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚨</span>
            <div>
              <p className="font-semibold text-red-800">
                {stats.unresolvedEmergencies} Unresolved Emergency Alert{stats.unresolvedEmergencies > 1 ? 's' : ''}
              </p>
              <p className="text-red-600 text-sm">Immediate attention required</p>
            </div>
          </div>
          <a href="/dashboard/emergencies" className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition">
            View Alerts
          </a>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className={`rounded-xl p-5 ${card.color}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{card.icon}</span>
            </div>
            <p className="text-3xl font-bold">{card.value.toLocaleString()}</p>
            <p className="text-sm font-medium opacity-80 mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Appointments */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Today&apos;s Appointments</h2>
            <a href="/dashboard/appointments" className="text-serenity-600 text-sm hover:underline">View all</a>
          </div>

          {todayAppts && todayAppts.length > 0 ? (
            <div className="space-y-3">
              {todayAppts.map((appt) => (
                <div key={appt.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">
                      {(appt.patients as { name?: string } | null)?.name ?? 'Unknown Patient'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {appt.appointment_time ?? 'No time set'} · {appt.center ?? 'No center'}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    appt.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                    appt.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {appt.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center py-6">No appointments today</p>
          )}
        </div>

        {/* Recent Emergencies */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Unresolved Emergencies</h2>
            <a href="/dashboard/emergencies" className="text-serenity-600 text-sm hover:underline">View all</a>
          </div>

          {emergencies && emergencies.length > 0 ? (
            <div className="space-y-3">
              {emergencies.map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                  <span className="text-red-500 text-lg mt-0.5">⚠️</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">
                      {(alert.patients as { name?: string } | null)?.name ?? 'Unknown Patient'}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">
                      {alert.alert_type?.replace('_', ' ') ?? 'Crisis'} · {
                        alert.acknowledged_at ? 'Acknowledged' : 'Unacknowledged'
                      }
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {format(new Date(alert.created_at), 'HH:mm')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-2xl mb-1">✅</p>
              <p className="text-gray-400 text-sm">No unresolved emergencies</p>
            </div>
          )}
        </div>
      </div>

      {/* System Status */}
      {stats.pendingQueue > 0 && (
        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
          <p className="text-yellow-800 text-sm font-medium">
            ⚙️ {stats.pendingQueue} messages in processing queue
          </p>
        </div>
      )}
    </div>
  )
}
