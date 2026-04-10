import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
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

  const [
    { data: doctors },
    { data: onCallSchedule },
    { data: adminUsers },
  ] = await Promise.all([
    supabase.from('doctors').select('*').order('name'),
    supabase
      .from('on_call_schedule')
      .select('*, doctors(name)')
      .gte('end_date', new Date().toISOString().split('T')[0])
      .order('start_date', { ascending: true })
      .limit(20),
    supabase.from('admin_users').select('*').order('name'),
  ])

  const activeDoctors = doctors?.filter((d) => d.is_active) ?? []
  const inactiveDoctors = doctors?.filter((d) => !d.is_active) ?? []

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm">Hospital configuration · Doctors · On-call · Admin users</p>
      </div>

      <div className="space-y-8">

        {/* ── Hospital Information ───────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            🏥 Hospital Information
          </h2>
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
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
            👨‍⚕️ Doctors ({activeDoctors.length} active)
          </h2>

          {/* Add Doctor Form */}
          <details className="mb-5">
            <summary className="cursor-pointer text-sm font-medium text-serenity-700 hover:text-serenity-800 select-none">
              + Add New Doctor
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
                        <button
                          type="button"
                          formAction={deactivateDoctor.bind(null, doctor.id) as unknown as string}
                          className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs font-medium rounded-lg hover:bg-gray-50 transition"
                          onClick={undefined}
                        >
                          Deactivate
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
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
            📅 On-Call Schedule
          </h2>

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
          <h2 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
            🔐 Admin Users ({adminUsers?.filter((u) => u.is_active).length ?? 0} active)
          </h2>

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
                  <option value="super_admin">Super Admin</option>
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
                      user.role === 'doctor' ? 'bg-teal-100 text-teal-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {user.role}
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

        {/* ── API Configuration ─────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            ⚙️ API Configuration
          </h2>
          <div className="space-y-3 text-sm">
            {[
              { name: 'WhatsApp (Meta Cloud API)', envKey: 'WHATSAPP_API_TOKEN', description: 'Patient messaging channel' },
              { name: 'NVIDIA AI (Kimi K2.5 / Llama 3.3)', envKey: 'NVIDIA_API_KEY', description: 'Dr Ade AI engine' },
              { name: 'Deepgram STT/TTS', envKey: 'DEEPGRAM_API_KEY', description: 'Voice note transcription + PII redaction' },
              { name: 'Google Calendar', envKey: 'GOOGLE_SERVICE_ACCOUNT_JSON', description: 'Appointment sync' },
              { name: 'Twilio SMS', envKey: 'TWILIO_ACCOUNT_SID', description: 'Emergency SMS alerts' },
              { name: 'Gmail SMTP', envKey: 'SMTP_HOST', description: 'Email notifications' },
            ].map((api) => (
              <div key={api.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-800">{api.name}</p>
                  <p className="text-xs text-gray-500">{api.description}</p>
                </div>
                <code className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600 font-mono">{api.envKey}</code>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            API keys are configured via environment variables and Supabase Vault. Never expose them in this interface.
          </p>
        </section>

        {/* ── NDPR Compliance ───────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            🛡️ NDPR / NDPA 2025 Compliance
          </h2>
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

        {/* ── System Info ───────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            ℹ️ System Information
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              { label: 'Platform', value: 'Supabase + Vercel (Next.js 14)' },
              { label: 'AI Engine', value: 'NVIDIA NIM — Kimi K2.5 / Llama 3.3 70B' },
              { label: 'Messaging', value: 'WhatsApp Business (Meta Cloud API)' },
              { label: 'Speech-to-Text', value: 'Deepgram (with PII redaction)' },
              { label: 'Monorepo', value: 'Turborepo' },
              { label: 'NDPR Data Region', value: 'US (Supabase) — see compliance notes' },
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
