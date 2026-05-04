import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format, formatDistanceToNow } from 'date-fns'

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray'

type AppointmentRow = {
  id: string
  appointment_date: string
  appointment_time: string | null
  center: string | null
  service_type: string | null
  status: string | null
  calendar_sync_status: string | null
  created_from_whatsapp: boolean | null
  patients: { name?: string | null; phone_number?: string | null } | null
  doctors: { name?: string | null } | null
}

type QueueRow = {
  patient_phone: string | null
  message_text: string | null
  status: string
  created_at: string
  last_error?: string | null
}

type ConversationRow = {
  id: string
  patient_message: string | null
  ai_response: string | null
  message_type: string | null
  sentiment: string | null
  has_emergency_keywords: boolean
  created_at: string
  patients: { name?: string | null; phone_number?: string | null } | null
}

type NotificationRow = {
  status: string | null
  channel: string | null
  notification_type: string | null
  error_message: string | null
  created_at: string
}

async function getDashboardData(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const today = new Date().toISOString().split('T')[0]

  const [
    { count: totalPatients },
    { count: todayAppointments },
    { count: activeConversations },
    { count: unresolvedEmergencies },
    { count: queuedMessages },
    { count: failedMessages },
    { count: pendingAiAppointments },
    { count: calendarNeedsReview },
    { data: lastInbound },
    { data: lastConversation },
    { data: todayAppts },
    { data: pendingAppts },
    { data: recentConversations },
    { data: lastStaffWhatsapp },
    { data: lastPatientWhatsapp },
    { data: lastEmail },
  ] = await Promise.all([
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('is_archived', false),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('appointment_date', today).neq('status', 'cancelled'),
    supabase.from('conversations').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('emergency_alerts').select('*', { count: 'exact', head: true }).is('resolved_at', null),
    supabase.from('message_queue').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
    supabase.from('message_queue').select('*', { count: 'exact', head: true }).in('status', ['failed', 'dead_letter']),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('created_from_whatsapp', true),
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .gte('appointment_date', today)
      .neq('status', 'cancelled')
      .or('calendar_sync_status.is.null,calendar_sync_status.neq.synced'),
    supabase.from('message_queue').select('patient_phone, message_text, status, created_at, last_error').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('conversations').select('patient_message, ai_response, message_type, sentiment, has_emergency_keywords, created_at, patients(name, phone_number)').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from('appointments')
      .select('id, appointment_date, appointment_time, center, service_type, status, calendar_sync_status, created_from_whatsapp, patients(name, phone_number), doctors(name)')
      .eq('appointment_date', today)
      .neq('status', 'cancelled')
      .order('appointment_time', { ascending: true })
      .limit(6),
    supabase
      .from('appointments')
      .select('id, appointment_date, appointment_time, center, service_type, status, calendar_sync_status, created_from_whatsapp, patients(name, phone_number), doctors(name)')
      .eq('status', 'pending')
      .eq('created_from_whatsapp', true)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('conversations')
      .select('id, patient_message, ai_response, message_type, sentiment, has_emergency_keywords, created_at, patients(name, phone_number)')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('notifications').select('status, channel, notification_type, error_message, created_at').eq('notification_type', 'staff_booking_alert').eq('channel', 'whatsapp').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('notifications').select('status, channel, notification_type, error_message, created_at').eq('notification_type', 'appointment_confirmation').eq('channel', 'whatsapp').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('notifications').select('status, channel, notification_type, error_message, created_at').eq('channel', 'email').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  return {
    today,
    stats: {
      totalPatients: totalPatients ?? 0,
      todayAppointments: todayAppointments ?? 0,
      activeConversations: activeConversations ?? 0,
      unresolvedEmergencies: unresolvedEmergencies ?? 0,
      queuedMessages: queuedMessages ?? 0,
      failedMessages: failedMessages ?? 0,
      pendingAiAppointments: pendingAiAppointments ?? 0,
      calendarNeedsReview: calendarNeedsReview ?? 0,
    },
    lastInbound: lastInbound as QueueRow | null,
    lastConversation: lastConversation as ConversationRow | null,
    todayAppts: (todayAppts ?? []) as AppointmentRow[],
    pendingAppts: (pendingAppts ?? []) as AppointmentRow[],
    recentConversations: (recentConversations ?? []) as ConversationRow[],
    lastStaffWhatsapp: lastStaffWhatsapp as NotificationRow | null,
    lastPatientWhatsapp: lastPatientWhatsapp as NotificationRow | null,
    lastEmail: lastEmail as NotificationRow | null,
  }
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()
  const data = await getDashboardData(supabase)
  const queueTone: Tone = data.stats.failedMessages > 0 ? 'red' : data.stats.queuedMessages > 0 ? 'amber' : 'green'
  const whatsappTone: Tone = data.lastInbound && data.lastConversation ? 'green' : 'amber'
  const calendarTone: Tone = data.stats.calendarNeedsReview > 0 ? 'amber' : 'green'
  const staffTone: Tone = data.lastStaffWhatsapp?.status === 'sent' ? 'green' : data.lastStaffWhatsapp?.status === 'failed' ? 'red' : 'amber'

  const metrics = [
    { label: 'Patients', value: data.stats.totalPatients, detail: 'Active patient records', tone: 'blue' as Tone, icon: 'patients' },
    { label: 'Today', value: data.stats.todayAppointments, detail: 'Non-cancelled appointments', tone: 'green' as Tone, icon: 'calendar' },
    { label: 'AI Requests', value: data.stats.pendingAiAppointments, detail: 'Pending WhatsApp bookings', tone: data.stats.pendingAiAppointments ? 'amber' as Tone : 'green' as Tone, icon: 'clock' },
    { label: 'Emergencies', value: data.stats.unresolvedEmergencies, detail: 'Unresolved alerts', tone: data.stats.unresolvedEmergencies ? 'red' as Tone : 'green' as Tone, icon: 'alert' },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-serenity-600">Serenity AI command center</p>
          <h1 className="text-2xl font-bold text-gray-950 mt-1">Operations Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')} · WhatsApp, bookings, calendar, and alert readiness</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/dashboard/appointments?view=pending" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">
            Review pending bookings
          </a>
          <a href="/dashboard/conversations" className="rounded-md border border-serenity-200 bg-white px-3 py-2 text-xs font-semibold text-serenity-700 hover:bg-serenity-50">
            Open AI conversations
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-5">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 mb-6">
        <HealthCard
          title="WhatsApp AI"
          tone={whatsappTone}
          value={data.lastConversation ? 'Live' : 'Needs activity'}
          detail={data.lastInbound ? `Last inbound ${timeAgo(data.lastInbound.created_at)}` : 'No inbound message found'}
          icon="message"
        />
        <HealthCard
          title="Queue"
          tone={queueTone}
          value={data.stats.failedMessages > 0 ? 'Action needed' : data.stats.queuedMessages > 0 ? 'Processing' : 'Clear'}
          detail={`${data.stats.queuedMessages} queued · ${data.stats.failedMessages} failed`}
          icon="queue"
        />
        <HealthCard
          title="Calendar Sync"
          tone={calendarTone}
          value={data.stats.calendarNeedsReview > 0 ? 'Review needed' : 'Healthy'}
          detail={`${data.stats.calendarNeedsReview} upcoming appointment${data.stats.calendarNeedsReview === 1 ? '' : 's'} not synced`}
          icon="calendar"
        />
        <HealthCard
          title="Staff Alerts"
          tone={staffTone}
          value={statusText(data.lastStaffWhatsapp)}
          detail={data.lastStaffWhatsapp ? `Last staff WhatsApp ${timeAgo(data.lastStaffWhatsapp.created_at)}` : 'No staff alert logged yet'}
          icon="bell"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <section className="xl:col-span-2 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <PanelHeader title="Pending AI appointment requests" href="/dashboard/appointments?view=pending" />
          {data.pendingAppts.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {data.pendingAppts.map((appt) => (
                <AppointmentLine key={appt.id} appointment={appt} urgent />
              ))}
            </div>
          ) : (
            <EmptyState title="No pending AI bookings" detail="New WhatsApp appointment requests will appear here for staff review." />
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <PanelHeader title="Today’s schedule" href="/dashboard/appointments" />
          {data.todayAppts.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {data.todayAppts.map((appt) => (
                <AppointmentLine key={appt.id} appointment={appt} />
              ))}
            </div>
          ) : (
            <EmptyState title="No appointments today" detail="Confirmed and pending appointments for today will show here." />
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mt-5">
        <section className="xl:col-span-2 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <PanelHeader title="Recent AI activity" href="/dashboard/conversations" />
          {data.recentConversations.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {data.recentConversations.map((conversation) => (
                <ConversationLine key={conversation.id} conversation={conversation} />
              ))}
            </div>
          ) : (
            <EmptyState title="No AI activity yet" detail="Patient messages and Dr Ade replies will appear after WhatsApp traffic starts." />
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="font-semibold text-gray-950 text-sm">MVP readiness</h2>
          <div className="mt-4 space-y-3">
            <ReadinessRow label="Two-way WhatsApp" tone={whatsappTone} value={data.lastConversation ? 'Verified' : 'Needs live test'} />
            <ReadinessRow label="Patient confirmation" tone={notificationTone(data.lastPatientWhatsapp)} value={statusText(data.lastPatientWhatsapp)} />
            <ReadinessRow label="Staff WhatsApp alert" tone={staffTone} value={statusText(data.lastStaffWhatsapp)} />
            <ReadinessRow label="Email notifications" tone={notificationTone(data.lastEmail)} value={statusText(data.lastEmail)} />
            <ReadinessRow label="Calendar sync" tone={calendarTone} value={data.stats.calendarNeedsReview > 0 ? 'Needs review' : 'Ready'} />
          </div>
          {data.lastConversation && (
            <div className="mt-5 rounded-md bg-gray-50 border border-gray-100 p-3">
              <p className="text-xs font-semibold text-gray-700">Latest AI reply</p>
              <p className="mt-1 text-xs text-gray-500 line-clamp-4">{data.lastConversation.ai_response ?? 'No response text saved'}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MetricCard({ label, value, detail, tone, icon }: { label: string; value: number; detail: string; tone: Tone; icon: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-950 mt-1 tabular-nums">{value.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">{detail}</p>
        </div>
        <Icon name={icon} className={`h-9 w-9 rounded-md p-2 ${toneClasses(tone).soft}`} />
      </div>
    </div>
  )
}

function HealthCard({ title, value, detail, tone, icon }: { title: string; value: string; detail: string; tone: Tone; icon: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <Icon name={icon} className={`h-9 w-9 rounded-md p-2 ${toneClasses(tone).soft}`} />
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{title}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${toneClasses(tone).dot}`} />
            <p className="text-sm font-semibold text-gray-950">{value}</p>
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
      <h2 className="font-semibold text-gray-950 text-sm">{title}</h2>
      <a href={href} className="text-xs font-semibold text-serenity-700 hover:text-serenity-900">View all</a>
    </div>
  )
}

function AppointmentLine({ appointment, urgent = false }: { appointment: AppointmentRow; urgent?: boolean }) {
  const patient = appointment.patients
  const doctor = appointment.doctors
  const statusTone = appointment.status === 'confirmed' ? 'green' : appointment.status === 'pending' ? 'amber' : 'gray'
  return (
    <a href={`/dashboard/appointments?appointment=${appointment.id}`} className="block px-4 py-3 hover:bg-gray-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-950 truncate">{patient?.name ?? patient?.phone_number ?? 'Unknown patient'}</p>
            {urgent && <Badge tone="amber">Needs confirmation</Badge>}
            {appointment.created_from_whatsapp && <Badge tone="green">WhatsApp AI</Badge>}
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">
            {format(new Date(`${appointment.appointment_date}T00:00:00`), 'MMM d')} · {appointment.appointment_time?.slice(0, 5) ?? '--:--'} · {appointment.center ?? 'No center'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{appointment.service_type ?? 'Consultation'} · {doctor?.name ?? 'No doctor assigned'}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge tone={statusTone}>{appointment.status ?? 'pending'}</Badge>
          <span className="text-[11px] text-gray-400">{calendarLabel(appointment.calendar_sync_status)}</span>
        </div>
      </div>
    </a>
  )
}

function ConversationLine({ conversation }: { conversation: ConversationRow }) {
  const patient = conversation.patients
  const tone: Tone = conversation.has_emergency_keywords ? 'red' : conversation.sentiment === 'distressed' || conversation.sentiment === 'crisis' ? 'amber' : 'blue'
  return (
    <a href="/dashboard/conversations" className="block px-4 py-3 hover:bg-gray-50">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-950 truncate">{patient?.name ?? patient?.phone_number ?? 'Unknown patient'}</p>
            <Badge tone={tone}>{conversation.message_type ?? 'text'}</Badge>
            {conversation.has_emergency_keywords && <Badge tone="red">Emergency keyword</Badge>}
          </div>
          <p className="text-xs text-gray-600 mt-1 truncate">Patient: {conversation.patient_message ?? '(media)'}</p>
          <p className="text-xs text-serenity-700 mt-0.5 truncate">Dr Ade: {conversation.ai_response ?? 'No AI response saved'}</p>
        </div>
        <p className="text-[11px] text-gray-400 flex-shrink-0">{timeAgo(conversation.created_at)}</p>
      </div>
    </a>
  )
}

function ReadinessRow({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${toneClasses(tone).dot}`} />
        <p className="text-sm text-gray-700 truncate">{label}</p>
      </div>
      <span className={`text-xs font-semibold px-2 py-1 rounded-md ${toneClasses(tone).soft}`}>{value}</span>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">{detail}</p>
    </div>
  )
}

function Badge({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold capitalize ${toneClasses(tone).soft}`}>{children}</span>
}

function Icon({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    patients: <path d="M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0M19 8a3 3 0 0 1 0 6M22 20a6 6 0 0 0-3-5.2" />,
    calendar: <path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />,
    clock: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
    alert: <path d="M12 8v5M12 17h.01M10.3 4.4 2.8 17.6A2 2 0 0 0 4.5 21h15a2 2 0 0 0 1.7-3.4L13.7 4.4a2 2 0 0 0-3.4 0Z" />,
    message: <path d="M21 12a8 8 0 0 1-8 8H5l-2 2v-7a8 8 0 1 1 18-3Z" />,
    queue: <path d="M5 7h14M5 12h14M5 17h9" />,
    bell: <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? paths.message}
    </svg>
  )
}

function toneClasses(tone: Tone) {
  switch (tone) {
    case 'green': return { soft: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' }
    case 'amber': return { soft: 'bg-amber-50 text-amber-700 border-amber-100', dot: 'bg-amber-500' }
    case 'red': return { soft: 'bg-red-50 text-red-700 border-red-100', dot: 'bg-red-500' }
    case 'blue': return { soft: 'bg-serenity-50 text-serenity-700 border-serenity-100', dot: 'bg-serenity-500' }
    default: return { soft: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400' }
  }
}

function notificationTone(notification: NotificationRow | null): Tone {
  if (!notification) return 'amber'
  if (notification.status === 'sent' || notification.status === 'delivered' || notification.status === 'read') return 'green'
  if (notification.status === 'failed') return 'red'
  return 'amber'
}

function statusText(notification: NotificationRow | null): string {
  if (!notification) return 'No proof yet'
  if (notification.status === 'sent') return 'Sent'
  if (notification.status === 'delivered') return 'Delivered'
  if (notification.status === 'read') return 'Read'
  if (notification.status === 'failed') return 'Failed'
  return notification.status ?? 'Unknown'
}

function calendarLabel(status: string | null): string {
  if (status === 'synced') return 'Calendar synced'
  if (!status) return 'Calendar pending'
  if (status.includes('error') || status.includes('conflict') || status.includes('busy')) return 'Calendar warning'
  return 'Calendar pending'
}

function timeAgo(value: string): string {
  return `${formatDistanceToNow(new Date(value), { addSuffix: true })}`
}
