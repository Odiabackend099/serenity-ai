import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format, subDays, startOfDay } from 'date-fns'
import { redirect } from 'next/navigation'

export default async function AnalyticsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffUser } = await supabase
    .from('admin_users')
    .select('role')
    .eq('email', user?.email ?? '')
    .eq('is_active', true)
    .maybeSingle()

  if (staffUser?.role !== 'super_admin') {
    redirect('/dashboard')
  }

  const now = new Date()
  const thirtyDaysAgo = subDays(now, 30).toISOString()
  const sevenDaysAgo = subDays(now, 7).toISOString()

  const [
    { count: totalPatients },
    { count: totalConversations },
    { count: totalAppointments },
    { count: completedAppointments },
    { count: cancelledAppointments },
    { count: totalEmergencies },
    { count: resolvedEmergencies },
    { count: newPatients30d },
    { count: conversations7d },
    { data: recentFeedback },
    { data: sentimentCounts },
    { data: alertTypes },
    { data: apiQuotas },
  ] = await Promise.all([
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('is_archived', false),
    supabase.from('conversations').select('*', { count: 'exact', head: true }),
    supabase.from('appointments').select('*', { count: 'exact', head: true }),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
    supabase.from('emergency_alerts').select('*', { count: 'exact', head: true }),
    supabase.from('emergency_alerts').select('*', { count: 'exact', head: true }).not('resolved_at', 'is', null),
    supabase.from('patients').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo).eq('is_archived', false),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    supabase.from('appointment_feedback').select('rating').order('created_at', { ascending: false }).limit(100),
    supabase.from('conversations').select('sentiment').not('sentiment', 'is', null),
    supabase.from('emergency_alerts').select('alert_type').not('alert_type', 'is', null),
    supabase.from('api_quotas').select('*').eq('date', format(now, 'yyyy-MM-dd')),
  ])

  // Calculate average rating
  const avgRating = recentFeedback && recentFeedback.length > 0
    ? (recentFeedback.reduce((sum, f) => sum + (f.rating ?? 0), 0) / recentFeedback.length).toFixed(1)
    : null

  // Count sentiments
  const sentimentMap = (sentimentCounts ?? []).reduce((acc, c) => {
    if (c.sentiment) acc[c.sentiment] = (acc[c.sentiment] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Count alert types
  const alertTypeMap = (alertTypes ?? []).reduce((acc, a) => {
    if (a.alert_type) acc[a.alert_type] = (acc[a.alert_type] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const completionRate = totalAppointments
    ? Math.round(((completedAppointments ?? 0) / (totalAppointments ?? 1)) * 100)
    : 0

  const resolutionRate = totalEmergencies
    ? Math.round(((resolvedEmergencies ?? 0) / (totalEmergencies ?? 1)) * 100)
    : 0

  const sentimentColors: Record<string, string> = {
    positive: 'bg-green-500',
    neutral: 'bg-gray-400',
    distressed: 'bg-orange-500',
    crisis: 'bg-red-600',
  }

  const alertColors: Record<string, string> = {
    suicidal: 'bg-red-600',
    self_harm: 'bg-red-400',
    drug_overdose: 'bg-orange-500',
    panic_attack: 'bg-yellow-500',
  }

  const totalSentiments = Object.values(sentimentMap).reduce((a, b) => a + b, 0)
  const totalAlerts = Object.values(alertTypeMap).reduce((a, b) => a + b, 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 text-sm">Hospital activity, appointment trends, and assistant support performance.</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 mb-1">Patients</p>
          <p className="text-3xl font-bold text-gray-900">{totalPatients?.toLocaleString() ?? 0}</p>
          <p className="text-xs text-green-600 mt-1">+{newPatients30d ?? 0} in 30 days</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 mb-1">Patient Conversations</p>
          <p className="text-3xl font-bold text-gray-900">{totalConversations?.toLocaleString() ?? 0}</p>
          <p className="text-xs text-serenity-600 mt-1">{conversations7d ?? 0} in last 7 days</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 mb-1">Completed Appointments</p>
          <p className="text-3xl font-bold text-gray-900">{completionRate}%</p>
          <p className="text-xs text-gray-400 mt-1">{completedAppointments ?? 0} of {totalAppointments ?? 0} completed</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 mb-1">Average Feedback</p>
          <p className="text-3xl font-bold text-gray-900">{avgRating ?? '—'}<span className="text-lg text-gray-400">/5</span></p>
          <p className="text-xs text-gray-400 mt-1">{recentFeedback?.length ?? 0} responses collected</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Appointment Stats */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Appointment Summary</h2>
          <div className="space-y-3">
            {[
              { label: 'Total', value: totalAppointments ?? 0, color: 'bg-serenity-500' },
              { label: 'Completed', value: completedAppointments ?? 0, color: 'bg-green-500' },
              { label: 'Cancelled', value: cancelledAppointments ?? 0, color: 'bg-red-400' },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-medium">{item.value.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color}`}
                    style={{ width: `${totalAppointments ? (item.value / (totalAppointments ?? 1)) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Emergency Stats */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Urgent Patient Alerts</h2>
          <div className="flex items-center gap-6 mb-4">
            <div>
              <p className="text-3xl font-bold text-red-600">{totalEmergencies ?? 0}</p>
              <p className="text-xs text-gray-500">Total urgent alerts</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-green-600">{resolutionRate}%</p>
              <p className="text-xs text-gray-500">Resolved</p>
            </div>
          </div>
          {totalAlerts > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 mb-2">By Type</p>
              {Object.entries(alertTypeMap).map(([type, count]) => (
                <div key={type} className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${alertColors[type] ?? 'bg-gray-400'}`} />
                  <span className="text-gray-600 capitalize flex-1">{type.replace('_', ' ')}</span>
                  <span className="font-medium">{count}</span>
                  <span className="text-gray-400 text-xs">({Math.round((count / totalAlerts) * 100)}%)</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sentiment Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Patient Mood / Risk</h2>
          {totalSentiments > 0 ? (
            <>
              {/* Bar visualization */}
              <div className="flex h-8 rounded-full overflow-hidden mb-4">
                {Object.entries(sentimentMap).map(([sentiment, count]) => (
                  <div
                    key={sentiment}
                    className={sentimentColors[sentiment] ?? 'bg-gray-400'}
                    style={{ width: `${(count / totalSentiments) * 100}%` }}
                    title={`${sentiment}: ${count}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(sentimentMap).map(([sentiment, count]) => (
                  <div key={sentiment} className="flex items-center gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sentimentColors[sentiment] ?? 'bg-gray-400'}`} />
                    <span className="text-gray-600 capitalize">{sentiment}</span>
                    <span className="text-gray-400 ml-auto">{Math.round((count / totalSentiments) * 100)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-400 text-sm text-center py-6">No sentiment data yet</p>
          )}
        </div>

        {/* AI Usage */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">AI Usage Today</h2>
          {apiQuotas && apiQuotas.length > 0 ? (
            <div className="space-y-3">
              {apiQuotas.map((quota) => {
                const budgetPct = quota.daily_budget_limit
                  ? Math.min(Math.round(((quota.budget_used ?? 0) / quota.daily_budget_limit) * 100), 100)
                  : null
                return (
                  <div key={quota.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 capitalize font-medium">{quota.provider}</span>
                      <span className="text-gray-500">
                        {quota.call_count} calls
                        {quota.budget_used != null && ` · $${quota.budget_used.toFixed(4)}`}
                      </span>
                    </div>
                    {budgetPct !== null && (
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${budgetPct >= 80 ? 'bg-red-500' : budgetPct >= 60 ? 'bg-orange-400' : 'bg-green-500'}`}
                          style={{ width: `${budgetPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center py-6">No AI usage recorded today</p>
          )}
        </div>
      </div>

      {/* Feedback Rating Distribution */}
      {recentFeedback && recentFeedback.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Patient Feedback Distribution</h2>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = recentFeedback.filter(f => f.rating === star).length
              const pct = recentFeedback.length > 0 ? Math.round((count / recentFeedback.length) * 100) : 0
              return (
                <div key={star} className="flex items-center gap-3 text-sm">
                  <span className="text-gray-600 w-12 flex-shrink-0">{star} star{star !== 1 ? 's' : ''}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${star >= 4 ? 'bg-green-500' : star === 3 ? 'bg-yellow-400' : 'bg-red-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-gray-500 w-8 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
