import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import Link from 'next/link'
import { updateAppointmentStatus, cancelAppointment, sendManualReminder } from './actions'

type View = 'upcoming' | 'past' | 'all'
type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: { view?: string }
}) {
  const view = (searchParams.view ?? 'upcoming') as View
  const supabase = await createServerSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  let query = supabase
    .from('appointments')
    .select('*, patients(id, name, phone_number), doctors(name, speciality)')
    .order('appointment_date', { ascending: view !== 'past' })
    .order('appointment_time', { ascending: view !== 'past' })
    .limit(200)

  if (view === 'upcoming') {
    query = query.gte('appointment_date', today).neq('status', 'cancelled')
  } else if (view === 'past') {
    query = query.lt('appointment_date', today)
  }

  const { data: appointments } = await query

  // Counts for tabs
  const [{ count: upcomingCount }, { count: pastCount }, { count: allCount }] = await Promise.all([
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .gte('appointment_date', today)
      .neq('status', 'cancelled'),
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .lt('appointment_date', today),
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true }),
  ])

  // Group by date
  const grouped = (appointments ?? []).reduce((acc, appt) => {
    const date = appt.appointment_date
    if (!acc[date]) acc[date] = []
    acc[date].push(appt)
    return acc
  }, {} as Record<string, NonNullable<typeof appointments>>)

  const tabs: { key: View; label: string; count: number | null }[] = [
    { key: 'upcoming', label: 'Upcoming', count: upcomingCount },
    { key: 'past', label: 'Past', count: pastCount },
    { key: 'all', label: 'All', count: allCount },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
          <p className="text-gray-500 text-sm">Manage and update appointment statuses</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/dashboard/appointments?view=${tab.key}`}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              view === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== null && (
              <span className="ml-1.5 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                {tab.count}
              </span>
            )}
          </Link>
        ))}
      </div>

      {Object.keys(grouped).length > 0 ? (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, appts]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                <span className="ml-2 text-xs bg-serenity-100 text-serenity-700 px-2 py-0.5 rounded-full normal-case font-normal">
                  {appts.length} appointment{appts.length !== 1 ? 's' : ''}
                </span>
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {appts.map((appt, i) => {
                  const patient = appt.patients as { id?: string; name?: string; phone_number?: string } | null
                  const doctor = appt.doctors as { name?: string; speciality?: string } | null
                  const isUpcoming = appt.appointment_date >= today
                  const canRemind = isUpcoming && appt.status === 'confirmed'

                  return (
                    <div key={appt.id} className={`p-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                      <div className="flex items-start justify-between gap-4">
                        {/* Left: appointment info */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="text-center w-14 flex-shrink-0 mt-0.5">
                            <p className="text-lg font-bold text-serenity-700 leading-tight">
                              {appt.appointment_time?.slice(0, 5) ?? '--:--'}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              {patient?.id ? (
                                <a
                                  href={`/dashboard/patients/${patient.id}`}
                                  className="font-medium text-gray-900 text-sm hover:text-serenity-600"
                                >
                                  {patient?.name ?? patient?.phone_number ?? 'Unknown'}
                                </a>
                              ) : (
                                <p className="font-medium text-gray-900 text-sm">
                                  {patient?.name ?? patient?.phone_number ?? 'Unknown'}
                                </p>
                              )}
                              {patient?.phone_number && (
                                <a href={`tel:${patient.phone_number}`} className="text-xs text-gray-400 hover:text-serenity-600">
                                  {patient.phone_number}
                                </a>
                              )}
                            </div>
                            <p className="text-xs text-gray-500">
                              {appt.service_type ?? 'General'} · {appt.center ?? 'TBD'} · {doctor?.name ?? 'No doctor assigned'}
                            </p>
                            {appt.reason && (
                              <p className="text-xs text-gray-400 mt-0.5 truncate max-w-sm">{appt.reason}</p>
                            )}
                            {/* Reminder dots */}
                            <div className="flex items-center gap-2 mt-1.5">
                              <span
                                title={appt.reminder_1week_sent ? '1-week reminder sent' : '1-week reminder not sent'}
                                className={`text-xs flex items-center gap-1 ${appt.reminder_1week_sent ? 'text-green-600' : 'text-gray-300'}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${appt.reminder_1week_sent ? 'bg-green-500' : 'bg-gray-300'}`} />
                                1wk
                              </span>
                              <span
                                title={appt.reminder_24h_sent ? '24h reminder sent' : '24h reminder not sent'}
                                className={`text-xs flex items-center gap-1 ${appt.reminder_24h_sent ? 'text-green-600' : 'text-gray-300'}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${appt.reminder_24h_sent ? 'bg-green-500' : 'bg-gray-300'}`} />
                                24h
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: status + actions */}
                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                          {/* Status dropdown */}
                          {appt.status !== 'cancelled' ? (
                            <form
                              action={async (formData: FormData) => {
                                'use server'
                                const newStatus = formData.get('status') as AppointmentStatus
                                await updateAppointmentStatus(appt.id, newStatus)
                              }}
                              className="flex items-center gap-1"
                            >
                              <select
                                name="status"
                                defaultValue={appt.status}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
                              >
                                {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'cancelled').map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="text-xs px-2 py-1 bg-serenity-600 text-white rounded-lg hover:bg-serenity-700 transition"
                              >
                                Save
                              </button>
                            </form>
                          ) : (
                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-500">
                              Cancelled
                            </span>
                          )}

                          {/* Cancel button */}
                          {appt.status !== 'cancelled' && appt.status !== 'completed' && (
                            <form action={cancelAppointment.bind(null, appt.id)}>
                              <button
                                type="submit"
                                className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition"
                              >
                                Cancel
                              </button>
                            </form>
                          )}

                          {/* Send Reminder buttons — only for upcoming confirmed */}
                          {canRemind && (
                            <div className="flex gap-1">
                              {!appt.reminder_1week_sent && (
                                <form action={sendManualReminder.bind(null, appt.id, '1week')}>
                                  <button
                                    type="submit"
                                    className="text-xs px-2.5 py-1 border border-serenity-200 text-serenity-700 rounded-lg hover:bg-serenity-50 transition"
                                  >
                                    Send 1wk
                                  </button>
                                </form>
                              )}
                              {!appt.reminder_24h_sent && (
                                <form action={sendManualReminder.bind(null, appt.id, '24h')}>
                                  <button
                                    type="submit"
                                    className="text-xs px-2.5 py-1 border border-serenity-200 text-serenity-700 rounded-lg hover:bg-serenity-50 transition"
                                  >
                                    Send 24h
                                  </button>
                                </form>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 text-center py-16">
          <p className="text-4xl mb-3">📅</p>
          <p className="text-gray-500">
            {view === 'upcoming' ? 'No upcoming appointments' : view === 'past' ? 'No past appointments' : 'No appointments yet'}
          </p>
          <p className="text-gray-400 text-sm mt-1">Appointments booked via WhatsApp will appear here</p>
        </div>
      )}
    </div>
  )
}
