import type { ReactNode } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import Link from 'next/link'
import {
  cancelAppointment,
  confirmAppointment,
  sendManualReminder,
  updateAppointmentStatus,
} from './actions'

type View = 'upcoming' | 'pending' | 'confirmed' | 'whatsapp' | 'calendar' | 'past' | 'all'
type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'none'
type NotificationRow = {
  notification_type: string | null
  channel: string | null
  status: string | null
  error_message: string | null
  recipient_role: string | null
  recipient_name: string | null
  recipient_phone: string | null
  created_at: string
}
type AppointmentWithRelations = {
  id: string
  doctor_id: string | null
  appointment_date: string
  appointment_time: string | null
  center: string | null
  service_type: string | null
  reason: string | null
  status: AppointmentStatus | 'rescheduled'
  created_from_whatsapp: boolean | null
  calendar_sync_status: string | null
  calendar_sync_error: string | null
  reminder_1week_sent: boolean
  reminder_24h_sent: boolean
  confirmation_sent: boolean | null
  patients: { id?: string; name?: string; phone_number?: string; email?: string | null } | null
  doctors: { name?: string; speciality?: string } | null
  notifications?: NotificationRow[] | null
}

type DoctorOption = {
  id: string
  name: string
  location: string | null
}

const VALID_VIEWS: View[] = ['upcoming', 'pending', 'confirmed', 'whatsapp', 'calendar', 'past', 'all']

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; appointment?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const view = VALID_VIEWS.includes(resolvedSearchParams.view as View) ? (resolvedSearchParams.view as View) : 'upcoming'
  const highlightedAppointment = resolvedSearchParams.appointment
  const supabase = await createServerSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  let query = supabase
    .from('appointments')
    .select('*, patients(id, name, phone_number, email), doctors(name, speciality), notifications(notification_type, channel, status, error_message, recipient_role, recipient_name, recipient_phone, created_at)')
    .order('appointment_date', { ascending: view !== 'past' })
    .order('appointment_time', { ascending: view !== 'past' })
    .limit(200)

  if (view === 'upcoming') {
    query = query.gte('appointment_date', today).neq('status', 'cancelled')
  } else if (view === 'pending') {
    query = query.eq('status', 'pending').gte('appointment_date', today)
  } else if (view === 'confirmed') {
    query = query.eq('status', 'confirmed').gte('appointment_date', today)
  } else if (view === 'whatsapp') {
    query = query.eq('created_from_whatsapp', true).gte('appointment_date', today).neq('status', 'cancelled')
  } else if (view === 'calendar') {
    query = query.gte('appointment_date', today).neq('status', 'cancelled').or('calendar_sync_status.is.null,calendar_sync_status.neq.synced')
  } else if (view === 'past') {
    query = query.lt('appointment_date', today)
  }

  const [
    { data: appointments },
    { data: doctors },
    { count: upcomingCount },
    { count: pendingCount },
    { count: confirmedCount },
    { count: whatsappCount },
    { count: calendarCount },
    { count: pastCount },
    { count: allCount },
  ] = await Promise.all([
    query,
    supabase.from('doctors').select('id, name, location').eq('is_active', true).order('name'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('appointment_date', today).neq('status', 'cancelled'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending').gte('appointment_date', today),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'confirmed').gte('appointment_date', today),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('created_from_whatsapp', true).gte('appointment_date', today).neq('status', 'cancelled'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('appointment_date', today).neq('status', 'cancelled').or('calendar_sync_status.is.null,calendar_sync_status.neq.synced'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).lt('appointment_date', today),
    supabase.from('appointments').select('*', { count: 'exact', head: true }),
  ])

  const grouped = ((appointments ?? []) as AppointmentWithRelations[]).reduce((acc, appt) => {
    const date = appt.appointment_date
    if (!acc[date]) acc[date] = []
    acc[date].push(appt)
    return acc
  }, {} as Record<string, AppointmentWithRelations[]>)
  const activeDoctors = (doctors ?? []) as DoctorOption[]

  const tabs: { key: View; label: string; count: number | null }[] = [
    { key: 'upcoming', label: 'Upcoming', count: upcomingCount },
    { key: 'pending', label: 'Pending', count: pendingCount },
    { key: 'confirmed', label: 'Confirmed', count: confirmedCount },
    { key: 'whatsapp', label: 'WhatsApp AI', count: whatsappCount },
    { key: 'calendar', label: 'Calendar review', count: calendarCount },
    { key: 'past', label: 'Past', count: pastCount },
    { key: 'all', label: 'All', count: allCount },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-serenity-600">Appointment operations</p>
          <h1 className="text-2xl font-bold text-gray-950 mt-1">Appointments</h1>
          <p className="text-gray-500 text-sm mt-1">Confirm WhatsApp bookings, sync calendar proof, and send patient updates.</p>
        </div>
        <a href="/api/export/appointments" className="w-fit rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          Export CSV
        </a>
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-max min-w-full sm:min-w-0">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={`/dashboard/appointments?view=${tab.key}`}
              className={`whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                view === tab.key
                  ? 'bg-white text-gray-950 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab.label}
              {tab.count !== null && (
                <span className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                  {tab.count}
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {Object.keys(grouped).length > 0 ? (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, appts]) => (
            <section key={date}>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  {format(new Date(`${date}T00:00:00`), 'EEEE, MMMM d, yyyy')}
                </h2>
                <span className="rounded bg-serenity-50 px-2 py-0.5 text-xs font-semibold text-serenity-700">
                  {appts.length} appointment{appts.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {appts.map((appt, index) => (
                  <AppointmentCard
                    key={appt.id}
                    appointment={appt}
                    doctors={activeDoctors}
                    today={today}
                    highlighted={highlightedAppointment === appt.id}
                    withBorder={index > 0}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg text-center py-16">
          <p className="font-semibold text-gray-700">
            {view === 'upcoming' ? 'No upcoming appointments' : view === 'past' ? 'No past appointments' : 'No appointments match this view'}
          </p>
          <p className="text-gray-400 text-sm mt-1">Appointments booked via WhatsApp AI will appear here.</p>
        </div>
      )}
    </div>
  )
}

function AppointmentCard({
  appointment,
  doctors,
  today,
  highlighted,
  withBorder,
}: {
  appointment: AppointmentWithRelations
  doctors: DoctorOption[]
  today: string
  highlighted: boolean
  withBorder: boolean
}) {
  const patient = appointment.patients
  const doctor = appointment.doctors
  const isUpcoming = appointment.appointment_date >= today
  const canRemind = isUpcoming && appointment.status === 'confirmed'
  const patientWhatsapp = latestNotification(appointment, 'appointment_confirmation', 'whatsapp')
  const operationsWhatsapp = latestNotification(appointment, 'staff_booking_alert', 'whatsapp', 'operations_manager')
  const primaryDoctorWhatsapp = latestNotification(appointment, 'staff_booking_alert', 'whatsapp', 'primary_doctor')
  const assignedDoctorWhatsapp = latestNotification(appointment, 'staff_booking_alert', 'whatsapp', 'assigned_doctor')
  const email = latestNotification(appointment, null, 'email')
  const emailStatus: NotificationStatus = email ? normalizeNotificationStatus(email.status) : patient?.email ? 'none' : 'skipped'

  return (
    <div className={`${withBorder ? 'border-t border-gray-100' : ''} ${highlighted ? 'bg-serenity-50/60 ring-1 ring-inset ring-serenity-200' : ''} p-4`}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold tabular-nums text-serenity-800">{appointment.appointment_time?.slice(0, 5) ?? '--:--'}</p>
            <StatusBadge status={appointment.status} />
            {appointment.status === 'pending' && <Badge tone="amber">Awaiting secretary review</Badge>}
            {appointment.created_from_whatsapp && <Badge tone="green">WhatsApp AI</Badge>}
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {patient?.id ? (
              <a href={`/dashboard/patients/${patient.id}`} className="font-semibold text-gray-950 hover:text-serenity-700">
                {patient.name ?? patient.phone_number ?? 'Unknown patient'}
              </a>
            ) : (
              <p className="font-semibold text-gray-950">{patient?.name ?? patient?.phone_number ?? 'Unknown patient'}</p>
            )}
            {patient?.phone_number && (
              <a href={`tel:${patient.phone_number}`} className="text-xs font-medium text-gray-500 hover:text-serenity-700">
                {patient.phone_number}
              </a>
            )}
          </div>

          <p className="mt-1 text-sm text-gray-600 break-words">
            {appointment.service_type ?? 'Consultation'} · {appointment.center ?? 'Center TBD'} · {doctor?.name ?? 'No doctor assigned'}
          </p>
          {appointment.reason && (
            <p className="mt-1 max-w-3xl text-xs text-gray-400 break-words">{appointment.reason}</p>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
            <ProofBadge
              label="Calendar"
              status={calendarStatus(appointment.calendar_sync_status)}
              detail={appointment.calendar_sync_error ?? appointment.calendar_sync_status ?? 'No calendar sync recorded'}
            />
            <ProofBadge
              label="Patient WhatsApp"
              status={normalizeNotificationStatus(patientWhatsapp?.status)}
              detail={patientWhatsapp?.error_message ?? patientWhatsapp?.status ?? 'No confirmation WhatsApp logged yet'}
            />
            <ProofBadge
              label="Ops contact"
              status={normalizeNotificationStatus(operationsWhatsapp?.status)}
              detail={formatNotificationDetail(operationsWhatsapp, 'No Abdullahi operations alert logged yet')}
            />
            <ProofBadge
              label="Dr K oversight"
              status={normalizeNotificationStatus(primaryDoctorWhatsapp?.status)}
              detail={formatNotificationDetail(primaryDoctorWhatsapp, 'No Dr K oversight alert logged yet')}
            />
            <ProofBadge
              label="Assigned doctor"
              status={assignedDoctorWhatsapp ? normalizeNotificationStatus(assignedDoctorWhatsapp.status) : appointment.doctors?.name ? 'none' : 'skipped'}
              detail={formatNotificationDetail(assignedDoctorWhatsapp, appointment.doctors?.name ? 'No assigned doctor alert logged yet' : 'No assigned doctor')}
            />
            <ProofBadge
              label="Email"
              status={emailStatus}
              detail={email?.error_message ?? email?.status ?? (patient?.email ? 'No email notification logged yet' : 'Patient email not provided')}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:max-w-xs xl:justify-end">
          {appointment.status === 'pending' && (
            <form action={confirmAppointment.bind(null, appointment.id)}>
              <div className="mb-2 min-w-56">
                <label htmlFor={`doctor-${appointment.id}`} className="sr-only">Assign doctor</label>
                <select
                  id={`doctor-${appointment.id}`}
                  name="doctor_id"
                  defaultValue={appointment.doctor_id ?? ''}
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:border-serenity-500 focus:outline-none focus:ring-2 focus:ring-serenity-100"
                >
                  <option value="">Assign doctor...</option>
                  {doctors.map((doctorOption) => (
                    <option key={doctorOption.id} value={doctorOption.id}>
                      {doctorOption.name}{doctorOption.location ? ` · ${doctorOption.location}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <ActionButton tone="primary">Confirm</ActionButton>
            </form>
          )}

          {canRemind && !appointment.reminder_1week_sent && (
            <form action={sendManualReminder.bind(null, appointment.id, '1week')}>
              <ActionButton tone="secondary">Send 1wk</ActionButton>
            </form>
          )}

          {canRemind && !appointment.reminder_24h_sent && (
            <form action={sendManualReminder.bind(null, appointment.id, '24h')}>
              <ActionButton tone="secondary">Send 24h</ActionButton>
            </form>
          )}

          {appointment.status === 'confirmed' && (
            <>
              <form action={updateAppointmentStatus.bind(null, appointment.id, 'completed')}>
                <ActionButton tone="secondary">Completed</ActionButton>
              </form>
              <form action={updateAppointmentStatus.bind(null, appointment.id, 'no_show')}>
                <ActionButton tone="secondary">No-show</ActionButton>
              </form>
            </>
          )}

          {appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
            <form action={cancelAppointment.bind(null, appointment.id)}>
              <ActionButton tone="danger">Cancel</ActionButton>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function latestNotification(appointment: AppointmentWithRelations, type: string | null, channel: string, recipientRole?: string) {
  const notifications = appointment.notifications ?? []
  return notifications
    .filter((notification) => notification.channel === channel && (!type || notification.notification_type === type) && (!recipientRole || notification.recipient_role === recipientRole))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
}

function formatNotificationDetail(notification: NotificationRow | undefined, fallback: string): string {
  if (!notification) return fallback
  const recipient = [notification.recipient_name, notification.recipient_phone].filter(Boolean).join(' · ')
  const status = notification.error_message ?? notification.status ?? 'No status'
  return recipient ? `${recipient}: ${status}` : status
}

function normalizeNotificationStatus(status?: string | null): NotificationStatus {
  if (status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed' || status === 'pending') return status
  return 'none'
}

function calendarStatus(status: string | null): NotificationStatus {
  if (status === 'synced') return 'sent'
  if (!status) return 'pending'
  if (status.includes('error') || status.includes('conflict') || status.includes('busy')) return 'failed'
  return 'pending'
}

function StatusBadge({ status }: { status: string | null }) {
  const tone = status === 'confirmed' ? 'green' : status === 'pending' ? 'amber' : status === 'cancelled' ? 'red' : 'gray'
  return <Badge tone={tone}>{status ?? 'pending'}</Badge>
}

function ProofBadge({ label, status, detail }: { label: string; status: NotificationStatus; detail: string }) {
  const tone = status === 'sent' || status === 'delivered' || status === 'read'
    ? 'green'
    : status === 'failed'
      ? 'red'
      : status === 'skipped'
        ? 'gray'
        : 'amber'
  const value = status === 'none' ? 'No proof' : status

  return (
    <div title={detail} className={`rounded-md border px-2.5 py-2 ${toneClasses(tone).soft}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-0.5 text-xs font-bold capitalize">{value}</p>
    </div>
  )
}

function Badge({ children, tone }: { children: ReactNode; tone: 'green' | 'amber' | 'red' | 'gray' }) {
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${toneClasses(tone).soft}`}>{children}</span>
}

function ActionButton({ children, tone }: { children: ReactNode; tone: 'primary' | 'secondary' | 'danger' }) {
  const className = tone === 'primary'
    ? 'bg-serenity-700 text-white hover:bg-serenity-800'
    : tone === 'danger'
      ? 'border border-red-200 bg-white text-red-700 hover:bg-red-50'
      : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'

  return (
    <button type="submit" className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${className}`}>
      {children}
    </button>
  )
}

function toneClasses(tone: 'green' | 'amber' | 'red' | 'gray') {
  switch (tone) {
    case 'green': return { soft: 'border-emerald-100 bg-emerald-50 text-emerald-700' }
    case 'amber': return { soft: 'border-amber-100 bg-amber-50 text-amber-700' }
    case 'red': return { soft: 'border-red-100 bg-red-50 text-red-700' }
    default: return { soft: 'border-gray-200 bg-gray-100 text-gray-600' }
  }
}
