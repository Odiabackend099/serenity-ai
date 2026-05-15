import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { updatePatient, sendManualMessage, requestPatientDeletion } from './actions'

type AppointmentSummary = {
  status: string | null
  appointment_date: string
  appointment_time: string | null
  center?: string | null
  service_type?: string | null
  doctors?: { name?: string } | null
}

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ convPage?: string; tab?: string }>
}) {
  const supabase = await createServerSupabaseClient()
  const [resolvedParams, resolvedSearchParams] = await Promise.all([params, searchParams])
  const convPage = Math.max(1, parseInt(resolvedSearchParams.convPage ?? '1', 10))
  const convPerPage = 20
  const convOffset = (convPage - 1) * convPerPage

  const { data: patient } = await supabase
    .from('patients')
    .select('*, consent_log(*), deletion_requests(*)')
    .eq('id', resolvedParams.id)
    .single()

  if (!patient) notFound()

  const { data: conversations, count: convCount } = await supabase
    .from('conversations')
    .select('*', { count: 'exact' })
    .eq('patient_id', resolvedParams.id)
    .order('created_at', { ascending: false })
    .range(convOffset, convOffset + convPerPage - 1)

  const { data: appointments } = await supabase
    .from('appointments')
    .select('*, doctors(name)')
    .eq('patient_id', resolvedParams.id)
    .order('appointment_date', { ascending: false })

  const { data: emergencyAlerts } = await supabase
    .from('emergency_alerts')
    .select('*')
    .eq('patient_id', resolvedParams.id)
    .order('created_at', { ascending: false })

  const consents = patient.consent_log as Array<{ consent_given: boolean; created_at: string }> | null
  const latestConsent = consents?.at(-1)
  const hasPendingDeletion = (patient.deletion_requests as Array<{ status: string }> | null)?.some((d) => d.status === 'pending')
  const totalConvPages = Math.ceil((convCount ?? 0) / convPerPage)
  const latestAppointment = getLatestRelevantAppointment(appointments ?? [])
  const latestDoctor = latestAppointment?.doctors as { name?: string } | null | undefined
  const openEmergency = (emergencyAlerts ?? []).find((alert) => !alert.resolved_at)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/dashboard/patients" className="inline-flex items-center gap-1 text-sm text-serenity-600 hover:underline mb-5">
        ← Back to Patients
      </Link>

      {/* ── Patient Header ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-serenity-100 rounded-full flex items-center justify-center text-xl font-bold text-serenity-700 flex-shrink-0">
              {patient.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{patient.name ?? 'Unknown Patient'}</h1>
              <p className="text-gray-500 text-sm">{patient.phone_number}</p>
              {patient.email && <p className="text-gray-400 text-xs">{patient.email}</p>}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-gray-500">
                {patient.age && <span>{patient.age} yrs</span>}
                {patient.gender && <span className="capitalize">· {patient.gender}</span>}
                {patient.location && <span>· {patient.location}</span>}
              </div>
            </div>
          </div>
          <div>
            {hasPendingDeletion ? (
              <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">Deletion requested</span>
            ) : (
              <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">Active</span>
            )}
          </div>
        </div>

        {/* NDPR info strip */}
        <div className="pt-4 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Data consent</p>
            <p className={`font-medium ${patient.consent_ndpr ? 'text-green-600' : 'text-red-600'}`}>
              {patient.consent_ndpr ? 'Consented' : 'Not consented'}
            </p>
          </div>
          {latestConsent?.created_at && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Consent Date</p>
              <p className="font-medium text-gray-700">{format(new Date(latestConsent.created_at), 'MMM d, yyyy')}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 mb-0.5">First seen</p>
            <p className="font-medium text-gray-700">{format(new Date(patient.created_at), 'MMM d, yyyy')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Messages</p>
            <p className="font-medium text-gray-700">{convCount?.toLocaleString() ?? 0}</p>
          </div>
        </div>

        {/* ── Patient Memory ── */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Patient memory</h2>
              <p className="text-xs text-gray-500">
                What Dr Ade uses to recognize returning patients on WhatsApp.
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              latestAppointment ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {latestAppointment ? 'Known patient' : 'No appointment yet'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs text-gray-400 mb-1">Profile remembered</p>
              <p className="text-sm font-medium text-gray-800">{patient.name ?? 'Name not provided'}</p>
              <p className="text-xs text-gray-500 mt-1">
                {[patient.gender, patient.location, patient.email].filter(Boolean).join(' · ') || 'No extra profile details yet'}
              </p>
            </div>

            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs text-gray-400 mb-1">Current appointment</p>
              {latestAppointment ? (
                <>
                  <p className="text-sm font-medium text-gray-800">
                    {format(new Date(`${latestAppointment.appointment_date}T00:00:00`), 'MMM d, yyyy')} at {latestAppointment.appointment_time?.slice(0, 5) ?? '--:--'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {latestAppointment.center ?? 'Center not set'} · {appointmentStatusLabel(latestAppointment.status)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">No active or recent appointment found</p>
              )}
            </div>

            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-xs text-gray-400 mb-1">Doctor / safety</p>
              <p className="text-sm font-medium text-gray-800">{latestDoctor?.name ?? 'Doctor not assigned yet'}</p>
              <p className={`text-xs mt-1 ${openEmergency ? 'text-red-600' : 'text-gray-500'}`}>
                {openEmergency ? 'Open urgent alert needs review' : 'No open urgent alert'}
              </p>
            </div>
          </div>
        </div>

        {/* ── Edit Patient Form ── */}
        <details className="mt-4 pt-4 border-t border-gray-100">
          <summary className="cursor-pointer text-sm font-medium text-serenity-700 hover:text-serenity-800 select-none">
            Edit patient details
          </summary>
          <form action={updatePatient.bind(null, patient.id)} className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                name="name"
                defaultValue={patient.name ?? ''}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                name="email"
                type="email"
                defaultValue={patient.email ?? ''}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Age</label>
              <input
                name="age"
                type="number"
                min="1"
                max="120"
                defaultValue={patient.age ?? ''}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
              <select
                name="gender"
                defaultValue={patient.gender ?? ''}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 bg-white"
              >
                <option value="">Not specified</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
              <input
                name="location"
                defaultValue={patient.location ?? ''}
                placeholder="City, State"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="px-4 py-2 bg-serenity-600 text-white text-sm font-medium rounded-lg hover:bg-serenity-700 transition"
              >
                Save Changes
              </button>
            </div>
          </form>
        </details>

        {/* ── Manual WhatsApp Reply ── */}
        <details className="mt-3 pt-3 border-t border-gray-100">
          <summary className="cursor-pointer text-sm font-medium text-serenity-700 hover:text-serenity-800 select-none">
            Send manual WhatsApp message
          </summary>
          <form action={sendManualMessage.bind(null, patient.id)} className="mt-3 flex gap-2">
            <textarea
              name="message"
              required
              rows={2}
              placeholder="Type a message to send directly to this patient via WhatsApp..."
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-serenity-500 resize-none"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition flex-shrink-0 self-start"
            >
              Send
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-1.5">
            Note: Patient replies keep the WhatsApp conversation open for staff follow-up.
          </p>
        </details>

        {/* ── Danger Zone ── */}
        {!hasPendingDeletion && (
          <details className="mt-3 pt-3 border-t border-gray-100">
            <summary className="cursor-pointer text-sm font-medium text-red-600 hover:text-red-800 select-none">
              Request data deletion (NDPR)
            </summary>
            <form
              action={async (formData: FormData) => {
                'use server'
                const reason = formData.get('reason') as string
                await requestPatientDeletion(patient.id, reason)
              }}
              className="mt-3 flex gap-2"
            >
              <input
                name="reason"
                placeholder="Reason for deletion"
                required
                className="flex-1 px-3 py-2 border border-red-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition flex-shrink-0"
              >
                Request Deletion
              </button>
            </form>
            <p className="text-xs text-red-400 mt-1.5">
              This marks the patient for deletion. Data is soft-deleted after 30 days per NDPR policy.
            </p>
          </details>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Conversations ── */}
        <div className="lg:col-span-2">
          <h2 className="font-semibold text-gray-900 mb-3">
            Conversations
            <span className="ml-2 text-xs text-gray-400 font-normal">{convCount?.toLocaleString() ?? 0} total</span>
          </h2>

          {conversations && conversations.length > 0 ? (
            <>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                {conversations.map((conv) => (
                  <div key={conv.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {conv.has_emergency_keywords && (
                          <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">EMERGENCY</span>
                        )}
                        {conv.sentiment && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            conv.sentiment === 'crisis' ? 'bg-red-100 text-red-700' :
                            conv.sentiment === 'distressed' ? 'bg-orange-100 text-orange-700' :
                            conv.sentiment === 'positive' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {conv.sentiment}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 capitalize">{conv.message_type}</span>
                      </div>
                      <p className="text-xs text-gray-400 flex-shrink-0">
                        {format(new Date(conv.created_at), 'MMM d, HH:mm')}
                      </p>
                    </div>

                    {(conv.patient_message_redacted ?? conv.patient_message) && (
                      <div className="mb-1.5">
                        <p className="text-xs text-gray-400 mb-0.5">Patient</p>
                        <p className="text-sm text-gray-700 bg-gray-50 rounded px-2 py-1.5">
                          {conv.patient_message_redacted ?? conv.patient_message}
                        </p>
                      </div>
                    )}

                    {conv.transcription_redacted && (
                      <p className="text-xs text-gray-500 mb-1.5">Voice: {conv.transcription_redacted}</p>
                    )}

                    {conv.ai_response && (
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Dr Ade</p>
                        <p className="text-sm text-serenity-700 bg-serenity-50 rounded px-2 py-1.5">
                          {conv.ai_response}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {totalConvPages > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-gray-500">Page {convPage} of {totalConvPages}</p>
                  <div className="flex gap-2">
                    {convPage > 1 && (
                      <a href={`/dashboard/patients/${resolvedParams.id}?convPage=${convPage - 1}`}
                        className="px-3 py-1 bg-white border border-gray-200 rounded text-xs text-gray-700 hover:bg-gray-50">
                        Previous
                      </a>
                    )}
                    {convPage < totalConvPages && (
                      <a href={`/dashboard/patients/${resolvedParams.id}?convPage=${convPage + 1}`}
                        className="px-3 py-1 bg-white border border-gray-200 rounded text-xs text-gray-700 hover:bg-gray-50">
                        Next
                      </a>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 text-center py-10">
              <p className="text-gray-400 text-sm">No conversations yet</p>
            </div>
          )}
        </div>

        {/* ── Right: Appointments + Alerts ── */}
        <div className="space-y-5">
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">
              Appointments
              <span className="ml-2 text-xs text-gray-400 font-normal">{appointments?.length ?? 0}</span>
            </h2>
            {appointments && appointments.length > 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                {appointments.map((appt) => {
                  const doctor = appt.doctors as { name?: string } | null
                  return (
                    <div key={appt.id} className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-800 text-sm">
                            {format(new Date(appt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')}
                          </p>
                          <p className="text-xs text-gray-500">
                            {appt.appointment_time?.slice(0, 5) ?? '--:--'} · {appt.center ?? 'TBD'}
                          </p>
                          <p className="text-xs text-gray-400 capitalize">
                            {appt.service_type?.replace('_', ' ') ?? 'General'} · {doctor?.name ?? 'TBD'}
                          </p>
                        </div>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                          appt.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                          appt.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                          appt.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {appt.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 text-center py-6">
                <p className="text-gray-400 text-xs">No appointments</p>
              </div>
            )}
          </div>

          {emergencyAlerts && emergencyAlerts.length > 0 && (
            <div>
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full" />
                Urgent alerts
                <span className="text-xs text-gray-400 font-normal">{emergencyAlerts.length}</span>
              </h2>
              <div className="bg-white rounded-xl border border-red-100 overflow-hidden divide-y divide-red-50">
                {emergencyAlerts.map((alert) => (
                  <div key={alert.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-red-700 capitalize">
                          {alert.alert_type?.replace('_', ' ') ?? 'Crisis'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {format(new Date(alert.created_at), 'MMM d, yyyy HH:mm')}
                        </p>
                        {alert.keywords_detected && (
                          <p className="text-xs text-gray-500 mt-0.5">{alert.keywords_detected.join(', ')}</p>
                        )}
                        {alert.response_notes && (
                          <p className="text-xs text-green-700 mt-0.5 italic">{alert.response_notes}</p>
                        )}
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        alert.resolved_at ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {alert.resolved_at ? 'Resolved' : 'Open'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getLatestRelevantAppointment(appointments: AppointmentSummary[]) {
  const active = appointments
    .filter((appt) => appt.status ? ['pending', 'confirmed', 'rescheduled'].includes(appt.status) : false)
    .sort((a, b) => String(a.appointment_date).localeCompare(String(b.appointment_date)) || String(a.appointment_time ?? '').localeCompare(String(b.appointment_time ?? '')))

  return active[0] ?? appointments[0] ?? null
}

function appointmentStatusLabel(status: string | null): string {
  switch (status) {
    case 'pending':
      return 'Waiting for secretary confirmation'
    case 'confirmed':
      return 'Confirmed'
    case 'rescheduled':
      return 'Rescheduled'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    case 'no_show':
      return 'Did not attend'
    default:
      return 'Saved'
  }
}
