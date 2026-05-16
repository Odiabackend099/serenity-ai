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
import {
  calendarStatus,
  formatAppointmentReason,
  formatCalendarDetail,
  formatNotificationDetail,
  humanizeNotificationStatus,
  normalizeNotificationStatus,
} from '@/lib/appointment-display'
import type { NotificationStatus } from '@/lib/appointment-display'

type View = 'upcoming' | 'pending' | 'confirmed' | 'whatsapp' | 'calendar' | 'past' | 'all'
type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
type Tone = 'green' | 'amber' | 'red' | 'gray'

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
  reminder_2h_sent: boolean
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
const APPOINTMENT_SELECT = '*, patients(id, name, phone_number, email), doctors(name, speciality), notifications(notification_type, channel, status, error_message, recipient_role, recipient_name, recipient_phone, created_at)'

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; appointment?: string; notice?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const view = VALID_VIEWS.includes(resolvedSearchParams.view as View) ? (resolvedSearchParams.view as View) : 'upcoming'
  const highlightedAppointment = resolvedSearchParams.appointment
  const notice = resolvedSearchParams.notice
  const supabase = await createServerSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  let query = supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
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

  const visibleAppointments = ((appointments ?? []) as AppointmentWithRelations[])
    .filter((appointment) => !isInternalDemoAppointment(appointment))

  let pinnedAppointment = highlightedAppointment
    ? visibleAppointments.find((appointment) => appointment.id === highlightedAppointment) ?? null
    : null

  if (highlightedAppointment && !pinnedAppointment) {
    const { data: exactAppointment } = await supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .eq('id', highlightedAppointment)
      .maybeSingle()

    const exact = exactAppointment as AppointmentWithRelations | null
    if (exact && !isInternalDemoAppointment(exact)) {
      pinnedAppointment = exact
    }
  }

  const groupedAppointments = visibleAppointments.filter((appointment) => appointment.id !== pinnedAppointment?.id)
  const grouped = groupedAppointments.reduce((acc, appt) => {
    const date = appt.appointment_date
    if (!acc[date]) acc[date] = []
    acc[date].push(appt)
    return acc
  }, {} as Record<string, AppointmentWithRelations[]>)
  const activeDoctors = (doctors ?? []) as DoctorOption[]

  const tabs: { key: View; label: string; count: number | null }[] = [
    { key: 'upcoming', label: 'Upcoming', count: upcomingCount },
    { key: 'pending', label: 'Waiting', count: pendingCount },
    { key: 'confirmed', label: 'Confirmed', count: confirmedCount },
    { key: 'whatsapp', label: 'WhatsApp bookings', count: whatsappCount },
    { key: 'calendar', label: 'Schedule check', count: calendarCount },
    { key: 'past', label: 'Past', count: pastCount },
    { key: 'all', label: 'All', count: allCount },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-serenity-600">Booking desk</p>
          <h1 className="text-2xl font-bold text-gray-950 mt-1">Bookings</h1>
          <p className="text-gray-500 text-sm mt-1">Review WhatsApp requests, choose a doctor, and confirm the patient visit.</p>
        </div>
        <a href="/api/export/appointments" className="w-fit rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          Download list
        </a>
      </div>

      <NoticeBanner notice={notice} />

      {pinnedAppointment && (
        <section className="mb-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-950">Booking request from WhatsApp</h2>
            <Badge tone="green">Opened from staff link</Badge>
          </div>
          <div className="overflow-hidden rounded-lg border border-serenity-200 bg-white shadow-sm">
            <AppointmentCard
              appointment={pinnedAppointment}
              doctors={activeDoctors}
              today={today}
              highlighted
              withBorder={false}
            />
          </div>
        </section>
      )}

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
                  {appts.length} booking{appts.length !== 1 ? 's' : ''}
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
            {view === 'upcoming' ? 'No upcoming bookings' : view === 'past' ? 'No past bookings' : 'No bookings match this view'}
          </p>
          <p className="text-gray-400 text-sm mt-1">WhatsApp booking requests will appear here.</p>
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
  const needsDoctorAssignment = appointment.status === 'confirmed' && !appointment.doctor_id
  const needsConfirmation = appointment.status === 'pending' || needsDoctorAssignment
  const canRemind = isUpcoming && appointment.status === 'confirmed' && !needsDoctorAssignment
  const patientWhatsapp = latestNotification(appointment, 'appointment_confirmation', 'whatsapp')
  const operationsWhatsapp = latestNotification(appointment, 'staff_booking_alert', 'whatsapp', 'operations_manager')
  const primaryDoctorWhatsapp = latestNotification(appointment, 'staff_booking_alert', 'whatsapp', 'primary_doctor')
  const assignedDoctorWhatsapp = latestNotification(appointment, 'staff_booking_alert', 'whatsapp', 'assigned_doctor')
  const email = latestNotification(appointment, null, 'email')
  const proofItems = notificationProofItems(appointment, {
    patientWhatsapp,
    operationsWhatsapp,
    primaryDoctorWhatsapp,
    assignedDoctorWhatsapp,
    email,
  })
  const updateSummary = getUpdateSummary(appointment, proofItems)
  const status = appointmentStatus(appointment, needsDoctorAssignment)

  return (
    <div className={`${withBorder ? 'border-t border-gray-100' : ''} ${highlighted ? 'bg-serenity-50/60 ring-1 ring-inset ring-serenity-200' : ''} p-4`}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold tabular-nums text-serenity-800">{appointment.appointment_time?.slice(0, 5) ?? '--:--'}</p>
            <StatusBadge status={needsDoctorAssignment ? 'pending' : appointment.status} />
            {appointment.created_from_whatsapp && <Badge tone="green">WhatsApp booking</Badge>}
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

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <InfoTile label="Requested time" value={`${format(new Date(`${appointment.appointment_date}T00:00:00`), 'MMM d, yyyy')} at ${appointment.appointment_time?.slice(0, 5) ?? '--:--'}`} />
            <InfoTile label="Branch" value={appointment.center ?? 'Branch not set'} />
            <InfoTile label="Service" value={appointment.service_type ?? 'Consultation'} />
            <InfoTile label="Doctor" value={doctor?.name ?? 'Doctor not assigned yet'} />
          </div>

          <div className={`mt-3 rounded-md border px-3 py-2 ${toneClasses(status.tone).soft}`}>
            <p className="text-sm font-semibold">{status.label}</p>
            <p className="mt-0.5 text-xs opacity-80">{status.detail}</p>
          </div>

          <div className={`mt-2 rounded-md border px-3 py-2 ${toneClasses(updateSummary.tone).soft}`}>
            <p className="text-sm font-semibold">{updateSummary.label}</p>
            <p className="mt-0.5 text-xs opacity-80">{updateSummary.detail}</p>
          </div>

          <details className="mt-3 rounded-md border border-gray-100 bg-white px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-serenity-700">More details</summary>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {proofItems.map((item) => (
                <ProofRow key={item.label} {...item} />
              ))}
            </div>
            {appointment.reason && (
              <p className="mt-3 text-xs text-gray-500 break-words">{formatAppointmentReason(appointment.reason)}</p>
            )}
          </details>
        </div>

        <div className="flex flex-col gap-2">
          {needsConfirmation && (
            <form action={confirmAppointment.bind(null, appointment.id)} className="rounded-md border border-amber-100 bg-amber-50 p-3">
              <label htmlFor={`doctor-${appointment.id}`} className="mb-1 block text-xs font-semibold text-amber-900">
                Choose doctor
              </label>
              <select
                id={`doctor-${appointment.id}`}
                name="doctor_id"
                defaultValue={appointment.doctor_id ?? ''}
                required
                disabled={doctors.length === 0}
                className="w-full rounded-md border border-amber-200 bg-white px-2 py-2 text-sm font-medium text-gray-800 shadow-sm focus:border-serenity-500 focus:outline-none focus:ring-2 focus:ring-serenity-100 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                <option value="">Select doctor</option>
                {doctors.map((doctorOption) => (
                  <option key={doctorOption.id} value={doctorOption.id}>
                    {doctorOption.name}{doctorOption.location ? ` - ${doctorOption.location}` : ''}
                  </option>
                ))}
              </select>
              <ActionButton tone="primary" disabled={doctors.length === 0}>Confirm booking</ActionButton>
              {doctors.length === 0 && (
                <p className="mt-2 text-xs text-amber-800">No active doctors are available in setup.</p>
              )}
            </form>
          )}

          {appointment.status === 'confirmed' && !needsDoctorAssignment && (
            <>
              <form action={confirmAppointment.bind(null, appointment.id)}>
                <input type="hidden" name="intent" value="resend" />
                <ActionButton tone="secondary">Resend updates</ActionButton>
              </form>
              <details className="rounded-md border border-gray-100 bg-white px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-gray-600">Other actions</summary>
                <div className="mt-3 flex flex-col gap-2">
                  {canRemind && !appointment.reminder_1week_sent && (
                    <form action={sendManualReminder.bind(null, appointment.id, '1week')}>
                      <ActionButton tone="secondary">Send 1-week reminder</ActionButton>
                    </form>
                  )}
                  {canRemind && !appointment.reminder_24h_sent && (
                    <form action={sendManualReminder.bind(null, appointment.id, '24h')}>
                      <ActionButton tone="secondary">Send 24-hour reminder</ActionButton>
                    </form>
                  )}
                  {canRemind && !appointment.reminder_2h_sent && (
                    <form action={sendManualReminder.bind(null, appointment.id, '2h')}>
                      <ActionButton tone="secondary">Send 2-hour reminder</ActionButton>
                    </form>
                  )}
                  <form action={updateAppointmentStatus.bind(null, appointment.id, 'completed')}>
                    <ActionButton tone="secondary">Mark completed</ActionButton>
                  </form>
                  <form action={updateAppointmentStatus.bind(null, appointment.id, 'no_show')}>
                    <ActionButton tone="secondary">Mark did not attend</ActionButton>
                  </form>
                </div>
              </details>
            </>
          )}

          {appointment.status !== 'cancelled' && appointment.status !== 'completed' && (
            <form action={cancelAppointment.bind(null, appointment.id)}>
              <ActionButton tone="danger">Cancel booking</ActionButton>
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

function notificationProofItems(
  appointment: AppointmentWithRelations,
  notifications: {
    patientWhatsapp?: NotificationRow
    operationsWhatsapp?: NotificationRow
    primaryDoctorWhatsapp?: NotificationRow
    assignedDoctorWhatsapp?: NotificationRow
    email?: NotificationRow
  },
) {
  const patient = appointment.patients
  const emailStatus: NotificationStatus = notifications.email ? normalizeNotificationStatus(notifications.email.status) : patient?.email ? 'none' : 'skipped'
  return [
    {
      label: 'Hospital calendar',
      status: calendarStatus(appointment.calendar_sync_status),
      detail: formatCalendarDetail(appointment.calendar_sync_status, appointment.calendar_sync_error),
    },
    {
      label: 'Patient',
      status: normalizeNotificationStatus(notifications.patientWhatsapp?.status),
      detail: formatNotificationDetail(notifications.patientWhatsapp, 'Patient update has not been sent yet'),
    },
    {
      label: 'Secretary',
      status: normalizeNotificationStatus(notifications.operationsWhatsapp?.status),
      detail: formatNotificationDetail(notifications.operationsWhatsapp, 'Secretary update has not been sent yet'),
    },
    {
      label: 'Dr K',
      status: normalizeNotificationStatus(notifications.primaryDoctorWhatsapp?.status),
      detail: formatNotificationDetail(notifications.primaryDoctorWhatsapp, 'Dr K update has not been sent yet'),
    },
    {
      label: 'Doctor',
      status: notifications.assignedDoctorWhatsapp ? normalizeNotificationStatus(notifications.assignedDoctorWhatsapp.status) : appointment.doctor_id ? 'none' as NotificationStatus : 'skipped' as NotificationStatus,
      detail: formatNotificationDetail(notifications.assignedDoctorWhatsapp, appointment.doctor_id ? 'Doctor update has not been sent yet' : 'Doctor not assigned yet'),
    },
    {
      label: 'Email',
      status: emailStatus,
      detail: formatNotificationDetail(notifications.email, patient?.email ? 'Email has not been sent yet' : 'Patient email not provided'),
    },
  ]
}

function getUpdateSummary(appointment: AppointmentWithRelations, proofItems: ReturnType<typeof notificationProofItems>) {
  const calendar = proofItems.find((item) => item.label === 'Hospital calendar')
  const notificationItems = proofItems.filter((item) => item.label !== 'Hospital calendar' && item.status !== 'skipped')
  const failed = proofItems.some((item) => item.status === 'failed')
  const pending = notificationItems.some((item) => item.status === 'none' || item.status === 'pending')
  const waitingForDelivery = notificationItems.some((item) => item.status === 'sent')
  const delivered = notificationItems.length > 0 && notificationItems.every((item) => ['delivered', 'read'].includes(item.status))

  if (appointment.status === 'pending' || (appointment.status === 'confirmed' && !appointment.doctor_id)) {
    return {
      label: 'Updates pending',
      detail: 'Patient and staff updates will be sent after the booking is confirmed.',
      tone: 'amber' as Tone,
    }
  }

  if (calendar?.status === 'failed') {
    return {
      label: 'Schedule needs check',
      detail: 'Review the hospital calendar before relying on this booking.',
      tone: 'amber' as Tone,
    }
  }

  if (failed || pending) {
    return {
      label: 'Needs resend',
      detail: 'The booking is saved, but one or more updates have not gone through.',
      tone: failed ? 'red' as Tone : 'amber' as Tone,
    }
  }

  if (waitingForDelivery) {
    return {
      label: 'Updates sent',
      detail: 'WhatsApp accepted the updates. Waiting for phone delivery confirmation.',
      tone: 'amber' as Tone,
    }
  }

  if (delivered) {
    return {
      label: 'Updates sent',
      detail: 'Patient and staff updates have reached WhatsApp phones.',
      tone: 'green' as Tone,
    }
  }

  return {
    label: 'Needs resend',
    detail: 'Use Resend updates if anyone did not receive the booking message.',
    tone: 'amber' as Tone,
  }
}

function appointmentStatus(appointment: AppointmentWithRelations, needsDoctorAssignment: boolean) {
  if (appointment.status === 'pending') {
    return {
      label: 'Waiting for confirmation',
      detail: 'Choose a doctor, then confirm this booking.',
      tone: 'amber' as Tone,
    }
  }
  if (needsDoctorAssignment) {
    return {
      label: 'Choose a doctor before confirming',
      detail: 'This request came in as any available doctor.',
      tone: 'amber' as Tone,
    }
  }
  if (appointment.status === 'confirmed') {
    return {
      label: 'Confirmed',
      detail: 'This booking is confirmed for the patient.',
      tone: 'green' as Tone,
    }
  }
  if (appointment.status === 'completed') {
    return {
      label: 'Completed',
      detail: 'The visit has been marked as completed.',
      tone: 'gray' as Tone,
    }
  }
  if (appointment.status === 'no_show') {
    return {
      label: 'Patient did not attend',
      detail: 'This booking was marked as not attended.',
      tone: 'gray' as Tone,
    }
  }
  if (appointment.status === 'cancelled') {
    return {
      label: 'Cancelled',
      detail: 'This booking has been cancelled.',
      tone: 'red' as Tone,
    }
  }
  return {
    label: 'Saved',
    detail: 'This booking is saved in the dashboard.',
    tone: 'gray' as Tone,
  }
}

function NoticeBanner({ notice }: { notice?: string }) {
  if (!notice) return null
  const messages: Record<string, { title: string; detail: string; tone: Tone }> = {
    confirmed: {
      title: 'Booking confirmed',
      detail: 'Patient and staff updates were sent.',
      tone: 'green',
    },
    'notification-issue': {
      title: 'Booking saved, but updates need resend',
      detail: 'Use Resend updates if the patient or staff did not receive the message.',
      tone: 'amber',
    },
    'missing-doctor': {
      title: 'Choose a doctor first',
      detail: 'A booking cannot be confirmed until a doctor is selected.',
      tone: 'amber',
    },
    cancelled: {
      title: 'Booking cancelled',
      detail: 'The booking is no longer active.',
      tone: 'red',
    },
    completed: {
      title: 'Marked completed',
      detail: 'The visit is now saved as completed.',
      tone: 'green',
    },
    'did-not-attend': {
      title: 'Marked did not attend',
      detail: 'The booking is now saved as patient did not attend.',
      tone: 'gray',
    },
    'reminder-sent': {
      title: 'Reminder sent',
      detail: 'The patient reminder was sent.',
      tone: 'green',
    },
    'reminder-1week-sent': {
      title: '1-week reminder sent',
      detail: 'The patient reminder was sent and saved.',
      tone: 'green',
    },
    'reminder-24h-sent': {
      title: '24-hour reminder sent',
      detail: 'The patient reminder was sent and saved.',
      tone: 'green',
    },
    'reminder-2h-sent': {
      title: '2-hour reminder sent',
      detail: 'The patient reminder was sent and saved.',
      tone: 'green',
    },
    'reminder-not-confirmed': {
      title: 'Confirm the booking first',
      detail: 'Reminders can only be sent after a doctor is assigned and the booking is confirmed.',
      tone: 'amber',
    },
    'reminder-past': {
      title: 'Reminder not sent',
      detail: 'This booking time has passed, so a patient reminder was not sent.',
      tone: 'amber',
    },
    'reminder-unavailable': {
      title: 'Reminder not sent',
      detail: 'The reminder service is not available. Ask a manager to check deployment, then resend.',
      tone: 'red',
    },
    'reminder-failed': {
      title: 'Reminder needs resend',
      detail: 'The booking is still saved, but WhatsApp did not accept the reminder. Try sending it again.',
      tone: 'amber',
    },
    'reminder-audit-issue': {
      title: 'Reminder sent, audit needs check',
      detail: 'The patient reminder was sent, but the dashboard could not save the reminder record. Ask support to review.',
      tone: 'amber',
    },
    'missing-phone': {
      title: 'Patient phone number missing',
      detail: 'Add a patient phone number before sending updates.',
      tone: 'amber',
    },
    'not-found': {
      title: 'Booking not found',
      detail: 'This booking may have been moved or removed. Refresh the bookings list.',
      tone: 'red',
    },
    'not-authorized': {
      title: 'Action not available',
      detail: 'Your staff account does not have permission to make this change.',
      tone: 'red',
    },
    'not-signed-in': {
      title: 'Please sign in again',
      detail: 'Your session ended before the change was saved.',
      tone: 'amber',
    },
    'could-not-save': {
      title: 'Could not save that change',
      detail: 'Please try again. If it repeats, ask a manager to review.',
      tone: 'red',
    },
  }
  const message = messages[notice]
  if (!message) return null

  return (
    <div className={`mb-5 rounded-md border px-4 py-3 ${toneClasses(message.tone).soft}`}>
      <p className="text-sm font-semibold">{message.title}</p>
      <p className="mt-0.5 text-xs opacity-80">{message.detail}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const tone = status === 'confirmed' ? 'green' : status === 'pending' ? 'amber' : status === 'cancelled' ? 'red' : 'gray'
  const label = status === 'pending'
    ? 'Needs confirmation'
    : status === 'no_show'
      ? 'Did not attend'
      : status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : 'Needs confirmation'
  return <Badge tone={tone}>{label}</Badge>
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-800 break-words">{value}</p>
    </div>
  )
}

function ProofRow({ label, status, detail }: { label: string; status: NotificationStatus; detail: string }) {
  const tone = status === 'delivered' || status === 'read' || status === 'synced'
    ? 'green'
    : status === 'failed'
      ? 'red'
      : status === 'skipped'
        ? 'gray'
        : 'amber'
  const value = status === 'none' ? 'Not sent yet' : humanizeNotificationStatus(status)

  return (
    <div title={detail} className={`rounded-md border px-2.5 py-2 ${toneClasses(tone).soft}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-0.5 text-xs font-bold capitalize">{value}</p>
    </div>
  )
}

function Badge({ children, tone }: { children: ReactNode; tone: Tone }) {
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${toneClasses(tone).soft}`}>{children}</span>
}

function ActionButton({ children, tone, disabled = false }: { children: ReactNode; tone: 'primary' | 'secondary' | 'danger'; disabled?: boolean }) {
  const className = tone === 'primary'
    ? 'bg-serenity-700 text-white hover:bg-serenity-800 disabled:bg-serenity-300'
    : tone === 'danger'
      ? 'border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300'
      : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:text-gray-300'

  return (
    <button type="submit" disabled={disabled} className={`mt-2 min-h-10 w-full rounded-md px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed ${className}`}>
      {children}
    </button>
  )
}

function toneClasses(tone: Tone) {
  switch (tone) {
    case 'green': return { soft: 'border-emerald-100 bg-emerald-50 text-emerald-700' }
    case 'amber': return { soft: 'border-amber-100 bg-amber-50 text-amber-700' }
    case 'red': return { soft: 'border-red-100 bg-red-50 text-red-700' }
    default: return { soft: 'border-gray-200 bg-gray-100 text-gray-600' }
  }
}

function isInternalDemoAppointment(appointment: AppointmentWithRelations): boolean {
  const patientName = appointment.patients?.name?.toLowerCase().trim() ?? ''
  return patientName.startsWith('qa ')
    || patientName.startsWith('test ')
    || patientName === 'health check'
    || patientName.includes('qa selected')
}
