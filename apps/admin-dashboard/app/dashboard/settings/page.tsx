import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import { redirect } from 'next/navigation'
import {
  addDoctor,
  updateDoctor,
  deactivateDoctor,
  reactivateDoctor,
  addOnCallSchedule,
  removeOnCallSchedule,
  inviteAdminUser,
  deactivateAdminUser,
} from './actions'

export default async function SettingsPage() {
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

  const recentMessageCutoff = new Date()
  recentMessageCutoff.setHours(recentMessageCutoff.getHours() - 24)

  const [
    { data: doctors },
    { data: onCallSchedule },
    { data: adminUsers },
    { count: recentMessages },
    { count: pendingQueue },
    { count: pendingAiAppointments },
    { count: calendarSyncedAppointments },
    { data: latestStaffWhatsApp },
    { data: latestEmailNotification },
  ] = await Promise.all([
    supabase.from('doctors').select('*').order('name'),
    supabase
      .from('on_call_schedule')
      .select('*, doctors(name)')
      .gte('end_date', new Date().toISOString().split('T')[0])
      .order('start_date', { ascending: true })
      .limit(20),
    supabase.from('admin_users').select('*').order('name'),
    supabase.from('message_queue').select('*', { count: 'exact', head: true }).gte('created_at', recentMessageCutoff.toISOString()),
    supabase.from('message_queue').select('*', { count: 'exact', head: true }).in('status', ['queued', 'failed', 'dead_letter']),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('created_from_whatsapp', true),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('calendar_sync_status', 'synced'),
    supabase.from('notifications').select('status, error_message, recipient_role, recipient_name, created_at').eq('notification_type', 'staff_booking_alert').eq('channel', 'whatsapp').eq('recipient_role', 'operations_manager').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('notifications').select('status, error_message, created_at').eq('channel', 'email').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const activeDoctors = doctors?.filter((d) => d.is_active) ?? []
  const inactiveDoctors = doctors?.filter((d) => !d.is_active) ?? []
  const whatsappProvider = process.env.WHATSAPP_PROVIDER ?? 'meta'
  const liveWhatsAppSender = '+234 702 674 3998'
  const readinessItems = [
    {
      label: 'Meta WhatsApp live number',
      value: (recentMessages ?? 0) > 0 ? 'Verified in last 24h' : 'Needs live message',
      tone: (recentMessages ?? 0) > 0 ? 'green' : 'amber',
    },
    {
      label: 'Message delivery',
      value: (pendingQueue ?? 0) === 0 ? 'Clear' : `${pendingQueue} waiting for review`,
      tone: (pendingQueue ?? 0) === 0 ? 'green' : 'red',
    },
    {
      label: 'Pending WhatsApp bookings',
      value: `${pendingAiAppointments ?? 0} pending`,
      tone: (pendingAiAppointments ?? 0) === 0 ? 'green' : 'amber',
    },
    {
      label: 'Hospital calendar',
      value: (calendarSyncedAppointments ?? 0) > 0 ? 'Calendar bookings found' : 'No calendar booking yet',
      tone: (calendarSyncedAppointments ?? 0) > 0 ? 'green' : 'amber',
    },
    {
      label: 'Secretary WhatsApp alert',
      value: latestStaffWhatsApp?.status === 'sent' ? 'Sent' : latestStaffWhatsApp?.status === 'failed' ? 'Failed' : 'Not sent yet',
      tone: latestStaffWhatsApp?.status === 'sent' ? 'green' : latestStaffWhatsApp?.status === 'failed' ? 'red' : 'amber',
    },
    {
      label: 'Email updates',
      value: latestEmailNotification?.status === 'sent' ? 'Sent' : latestEmailNotification?.status === 'failed' ? 'Failed' : 'Not sent yet',
      tone: latestEmailNotification?.status === 'sent' ? 'green' : latestEmailNotification?.status === 'failed' ? 'red' : 'amber',
    },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Hospital Setup</h1>
        <p className="text-gray-500 text-sm">Hospital setup, doctors, on-call schedule, staff access, and connected services.</p>
      </div>

      <div className="space-y-8">

        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">System Readiness</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {readinessItems.map((item) => (
              <div key={item.label} className={`rounded-md border px-3 py-2 ${readinessTone(item.tone)}`} title={item.value}>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{item.label}</p>
                <p className="text-sm font-bold mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Statuses are based on recent dashboard activity and notification records.
          </p>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">WhatsApp Service</h2>
              <p className="text-sm text-gray-500 mt-1">
                Meta WhatsApp Cloud API is the live patient and staff messaging service. Twilio remains backup only.
              </p>
            </div>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold uppercase ${whatsappProvider === 'meta' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {whatsappProvider === 'meta' ? 'Meta live' : 'Backup active'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Live patient number</p>
              <p className="text-gray-800 font-medium">{liveWhatsAppSender}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Backup provider</p>
              <p className="text-gray-800 font-medium">Twilio, backup only</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Live message route</p>
              <p className="text-gray-800 font-medium break-all">https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Current provider setting</p>
              <p className="text-gray-800 font-medium">{whatsappProvider}</p>
            </div>
          </div>
          <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
            Live Meta messaging is the expected setting. Switch to Twilio only for a planned backup procedure.
          </div>
        </section>

        {/* ── Hospital Information ───────────────────────────────────────── */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Hospital Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {[
              { label: 'Hospital Name', value: 'Serenity Royale Hospital' },
              { label: 'Managing Director', value: 'Dr. Kunle Adesina' },
              { label: 'Primary Phone', value: '+234 806 219 7384' },
              { label: 'Secondary Phone', value: '+234 811 689 1990' },
              { label: 'Email', value: 'info@serenityroyalehospital.com' },
              { label: 'Website', value: 'serenityroyalehospital.com' },
              { label: 'Social Media', value: '@serenityroyale_' },
              { label: 'Head Office (Galadimawa)', value: 'No. 10 Royal Homes Estate, Galadinmawa, Abuja' },
              { label: 'Annex (Karu)', value: 'No. 11 Ali Amodu Close (behind CBN Quarters), Karu, Abuja' },
              { label: 'Emergency Hours', value: '24/7 every day including Sunday' },
              { label: 'Outpatient Hours', value: '8am – 4pm daily except Sunday' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-gray-500 text-xs mb-0.5">{label}</p>
                <p className="text-gray-800 font-medium">{value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Doctors ───────────────────────────────────────────────────── */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-5">Doctors ({activeDoctors.length} active)</h2>

          {/* Add Doctor Form */}
          <details className="mb-5">
            <summary className="cursor-pointer text-sm font-medium text-serenity-700 hover:text-serenity-800 select-none">
              Add new doctor
            </summary>
            <form action={addDoctor} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-gray-50 rounded-lg">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input
                  name="name"
                  required
                  placeholder="Dr. Full Name"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Speciality</label>
                <input
                  name="speciality"
                  placeholder="e.g. Psychiatry"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input
                  name="phone"
                  placeholder="+234..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  name="email"
                  type="email"
                  placeholder="doctor@hospital.com"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Center</label>
                <select
                  name="location"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
                >
                  <option value="">Both Centers</option>
                  <option value="Galadimawa">Galadimawa</option>
                  <option value="Karu">Karu</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bio</label>
                <input
                  name="bio"
                  placeholder="Short bio"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-serenity-600 text-white text-sm font-medium rounded-lg hover:bg-serenity-700 transition"
                >
                  Add Doctor
                </button>
              </div>
            </form>
          </details>

          {/* Active Doctors List */}
          {activeDoctors.length > 0 ? (
            <div className="space-y-3">
              {activeDoctors.map((doctor) => (
                <details key={doctor.id} className="border border-gray-100 rounded-lg">
                  <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 rounded-lg select-none">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-serenity-100 rounded-full flex items-center justify-center text-sm font-bold text-serenity-700 flex-shrink-0">
                        {doctor.name?.[0]?.toUpperCase() ?? 'D'}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{doctor.name}</p>
                        <p className="text-xs text-gray-500">{doctor.speciality ?? 'General'}{doctor.location ? ` · ${doctor.location}` : ''}</p>
                      </div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Active</span>
                  </summary>
                  <div className="px-3 pb-3">
                    <form action={updateDoctor.bind(null, doctor.id)} className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg mt-1">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                        <input
                          name="name"
                          defaultValue={doctor.name}
                          required
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Speciality</label>
                        <input
                          name="speciality"
                          defaultValue={doctor.speciality ?? ''}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                        <input
                          name="phone"
                          defaultValue={doctor.phone ?? ''}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                        <input
                          name="email"
                          type="email"
                          defaultValue={doctor.email ?? ''}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Center</label>
                        <select
                          name="location"
                          defaultValue={doctor.location ?? ''}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
                        >
                          <option value="">Both Centers</option>
                          <option value="Galadimawa">Galadimawa</option>
                          <option value="Karu">Karu</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Bio</label>
                        <input
                          name="bio"
                          defaultValue={doctor.bio ?? ''}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
                        />
                      </div>
                      <div className="sm:col-span-2 flex gap-2">
                        <button
                          type="submit"
                          className="px-3 py-1.5 bg-serenity-600 text-white text-xs font-medium rounded-lg hover:bg-serenity-700 transition"
                        >
                          Save Changes
                        </button>
                      </div>
                    </form>
                    <form action={deactivateDoctor.bind(null, doctor.id)} className="mt-2">
                      <button
                        type="submit"
                        className="text-xs text-red-500 hover:text-red-700 transition"
                      >
                        Deactivate doctor
                      </button>
                    </form>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center py-4">No active doctors</p>
          )}

          {/* Inactive Doctors */}
          {inactiveDoctors.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Inactive ({inactiveDoctors.length})</p>
              <div className="space-y-2">
                {inactiveDoctors.map((doctor) => (
                  <div key={doctor.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm text-gray-500 font-medium">{doctor.name}</p>
                      <p className="text-xs text-gray-400">{doctor.speciality}</p>
                    </div>
                    <form action={reactivateDoctor.bind(null, doctor.id)}>
                      <button
                        type="submit"
                        className="text-xs px-3 py-1 border border-serenity-200 text-serenity-600 rounded-lg hover:bg-serenity-50 transition"
                      >
                        Reactivate
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── On-Call Schedule ───────────────────────────────────────────── */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-5">On-Call Schedule</h2>

          {/* Add Schedule Form */}
          <form action={addOnCallSchedule} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5 p-4 bg-gray-50 rounded-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Doctor *</label>
              <select
                name="doctor_id"
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
              >
                <option value="">Select doctor</option>
                {activeDoctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From *</label>
              <input
                name="start_date"
                type="date"
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To *</label>
              <input
                name="end_date"
                type="date"
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div className="flex flex-col justify-between">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mt-1">
                <input name="is_primary" type="checkbox" value="true" className="rounded" />
                Primary on-call
              </label>
              <button
                type="submit"
                className="mt-2 px-4 py-2 bg-serenity-600 text-white text-sm font-medium rounded-lg hover:bg-serenity-700 transition"
              >
                Add
              </button>
            </div>
          </form>

          {/* Schedule List */}
          {onCallSchedule && onCallSchedule.length > 0 ? (
            <div className="space-y-2">
              {onCallSchedule.map((schedule) => {
                const doctor = schedule.doctors as { name?: string } | null
                return (
                  <div key={schedule.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                    <div>
                      <p className="font-medium text-gray-800">{doctor?.name ?? 'Unknown Doctor'}</p>
                      <p className="text-xs text-gray-500">
                        {format(new Date(schedule.start_date + 'T00:00:00'), 'MMM d')} – {format(new Date(schedule.end_date + 'T00:00:00'), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {schedule.is_primary && (
                        <span className="text-xs px-2 py-0.5 bg-serenity-100 text-serenity-700 rounded-full font-medium">Primary</span>
                      )}
                      <form action={removeOnCallSchedule.bind(null, schedule.id)}>
                        <button
                          type="submit"
                          className="text-xs text-red-500 hover:text-red-700 transition px-2 py-1"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center py-4">No upcoming on-call schedules</p>
          )}
        </section>

        {/* ── Admin Users ────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-5">Staff Access ({adminUsers?.filter((u) => u.is_active).length ?? 0} active)</h2>

          {/* Invite Form */}
          <form action={inviteAdminUser} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 p-4 bg-gray-50 rounded-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                name="name"
                required
                placeholder="Full Name"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
              <input
                name="email"
                type="email"
                required
                placeholder="admin@hospital.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <div className="flex gap-2">
                <select
                  name="role"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
                >
                  <option value="staff">Staff</option>
                  <option value="doctor">Doctor</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Lead admin</option>
                </select>
                <button
                  type="submit"
                  className="px-3 py-2 bg-serenity-600 text-white text-sm font-medium rounded-lg hover:bg-serenity-700 transition whitespace-nowrap"
                >
                  Invite
                </button>
              </div>
            </div>
          </form>

          {/* Users List */}
          {adminUsers && adminUsers.length > 0 ? (
            <div className="space-y-2">
              {adminUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                  <div>
                    <p className="font-medium text-gray-800">{user.name}</p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      user.role === 'super_admin' ? 'bg-purple-100 text-purple-700' :
                      user.role === 'admin' ? 'bg-serenity-100 text-serenity-700' :
                      user.role === 'doctor' ? 'bg-gold-100 text-gold-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {staffRoleLabel(user.role)}
                    </span>
                    {user.is_active ? (
                      <span className="text-xs text-green-600">Active</span>
                    ) : (
                      <span className="text-xs text-gray-400">Inactive</span>
                    )}
                    {user.is_active && (
                      <form action={deactivateAdminUser.bind(null, user.id)}>
                        <button
                          type="submit"
                          className="text-xs text-red-500 hover:text-red-700 transition"
                        >
                          Deactivate
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center py-4">No admin users configured</p>
          )}
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Connected Services</h2>
          <div className="space-y-3 text-sm">
            {[
              { name: 'Meta WhatsApp', description: 'Live patient and staff WhatsApp messaging' },
              { name: 'Twilio WhatsApp', description: 'Backup WhatsApp sender only' },
              { name: 'Groq AI', description: 'Dr Ade general-question responses' },
              { name: 'Deepgram Voice', description: 'Voice note transcription and privacy redaction' },
              { name: 'Google Calendar', description: 'Appointment availability and hospital calendar' },
              { name: 'Twilio SMS', description: 'Emergency fallback alerts only' },
              { name: 'Resend Email', description: 'Patient and staff email confirmations' },
              { name: 'Supabase', description: 'Secure patient records and dashboard login' },
            ].map((api) => (
              <div key={api.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-800">{api.name}</p>
                  <p className="text-xs text-gray-500">{api.description}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-semibold">Configured securely</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Service keys are stored securely and are never shown in the dashboard.
          </p>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Data Protection</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {[
              'Explicit NDPR consent on first contact',
              'Consent stored with timestamp & WhatsApp evidence',
              'Audit trail for all data access (immutable)',
              'PII redaction in transcriptions (Deepgram)',
              'Patient data deletion request flow',
              'Row-level security on all tables',
              'Encrypted sensitive fields (pgcrypto)',
              'NDPC breach notification procedure documented',
              'Data retention policy (2yr inactive → pseudonymize)',
              'Emergency alert deduplication (anti-fatigue)',
            ].map((check) => (
              <div key={check} className="flex items-start gap-2">
                <span className="text-green-600 mt-0.5">✓</span>
                <span className="text-gray-700">{check}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Technical Summary</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              { label: 'Platform', value: 'Supabase + Vercel (Next.js 14)' },
              { label: 'AI Engine', value: 'Groq — Llama 3.3' },
              { label: 'Messaging', value: 'Meta WhatsApp Cloud API + Twilio backup' },
              { label: 'Email', value: 'Resend HTTP API' },
              { label: 'Speech-to-Text', value: 'Deepgram (with PII redaction)' },
              { label: 'Data protection', value: 'NDPR consent and access history enabled' },
              { label: 'Version', value: '1.0.0' },
              { label: 'Built by', value: 'ODIADEV AI LTD' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-gray-500 text-xs mb-0.5">{label}</p>
                <p className="text-gray-800 font-medium">{value}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function readinessTone(tone: string) {
  switch (tone) {
    case 'green':
      return 'border-emerald-100 bg-emerald-50 text-emerald-700'
    case 'red':
      return 'border-red-100 bg-red-50 text-red-700'
    default:
      return 'border-amber-100 bg-amber-50 text-amber-700'
  }
}

function staffRoleLabel(role: string | null) {
  switch (role) {
    case 'super_admin':
      return 'Lead admin'
    case 'admin':
      return 'Admin'
    case 'doctor':
      return 'Doctor'
    default:
      return 'Staff'
  }
}
