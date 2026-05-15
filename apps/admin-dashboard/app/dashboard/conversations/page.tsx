import { createServerSupabaseClient } from '@/lib/supabase-server'
import { format } from 'date-fns'

const PER_PAGE = 25

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sentiment?: string; type?: string; emergency?: string }>
}) {
  const supabase = await createServerSupabaseClient()
  const resolvedSearchParams = await searchParams
  const search = resolvedSearchParams.q ?? ''
  const page = Math.max(1, parseInt(resolvedSearchParams.page ?? '1', 10))
  const sentimentFilter = resolvedSearchParams.sentiment ?? ''
  const typeFilter = resolvedSearchParams.type ?? ''
  const emergencyOnly = resolvedSearchParams.emergency === '1'
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('conversations')
    .select('*, patients(id, name, phone_number)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (sentimentFilter) query = query.eq('sentiment', sentimentFilter)
  if (typeFilter) query = query.eq('message_type', typeFilter)
  if (emergencyOnly) query = query.eq('has_emergency_keywords', true)

  const { data: conversations, count } = await query

  // If searching by patient name/phone, do a secondary join filter
  let filtered = conversations ?? []
  if (search) {
    filtered = filtered.filter((conv) => {
      const patient = conv.patients as { name?: string; phone_number?: string } | null
      const name = (patient?.name ?? '').toLowerCase()
      const phone = (patient?.phone_number ?? '').toLowerCase()
      const msg = (conv.patient_message ?? '').toLowerCase()
      const q = search.toLowerCase()
      return name.includes(q) || phone.includes(q) || msg.includes(q)
    })
  }

  const totalPages = Math.ceil((count ?? 0) / PER_PAGE)

  const SENTIMENT_OPTIONS = ['positive', 'neutral', 'distressed', 'crisis']
  const TYPE_OPTIONS = ['text', 'audio', 'image', 'video', 'document']

  function buildUrl(params: Record<string, string>) {
    const base = { q: search, page: '1', sentiment: sentimentFilter, type: typeFilter, emergency: emergencyOnly ? '1' : '' }
    const merged = { ...base, ...params }
    const qs = Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return `/dashboard/conversations?${qs}`
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Patient Chats</h1>
        <p className="text-gray-500 text-sm">Patient WhatsApp conversations · {count?.toLocaleString() ?? 0} records</p>
      </div>

      {/* ── Filters bar ── */}
      <form method="GET" className="mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search patient or message</label>
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="Name, phone, or keyword..."
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-serenity-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Patient mood / risk</label>
          <select name="sentiment" defaultValue={sentimentFilter} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-serenity-500">
            <option value="">All</option>
            {SENTIMENT_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Message type</label>
          <select name="type" defaultValue={typeFilter} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-serenity-500">
            <option value="">All</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <input type="checkbox" name="emergency" value="1" id="emergency-check" defaultChecked={emergencyOnly} className="rounded" />
          <label htmlFor="emergency-check" className="text-sm text-gray-700">Urgent only</label>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="px-4 py-2 bg-serenity-600 text-white rounded-lg text-sm font-medium hover:bg-serenity-700 transition">
            Filter
          </button>
          {(search || sentimentFilter || typeFilter || emergencyOnly) && (
            <a href="/dashboard/conversations" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition">
              Clear
            </a>
          )}
        </div>
      </form>

      {/* ── Conversation list ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {filtered.map((conv) => {
              const patient = conv.patients as { id?: string; name?: string; phone_number?: string } | null
              return (
                <a
                  key={conv.id}
                  href={patient?.id ? `/dashboard/patients/${patient.id}` : '#'}
                  className="block p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                        conv.has_emergency_keywords
                          ? 'bg-red-100 text-red-700'
                          : 'bg-serenity-100 text-serenity-700'
                      }`}>
                        {conv.has_emergency_keywords ? '!' : (patient?.name?.[0]?.toUpperCase() ?? '?')}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 text-sm">
                            {patient?.name ?? patient?.phone_number ?? 'Unknown'}
                          </p>
                          {patient?.id && (
                            <span className="text-xs px-2 py-0.5 bg-serenity-50 text-serenity-700 rounded-full font-medium">
                              Known patient
                            </span>
                          )}
                          {conv.has_emergency_keywords && (
                            <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                              Urgent
                            </span>
                          )}
                          {conv.sentiment && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
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

                        <p className="text-sm text-gray-600 mt-1 truncate">
                          <span className="text-gray-400">Patient: </span>
                          {conv.patient_message_redacted ?? conv.patient_message ?? '(media)'}
                        </p>

                        {conv.ai_response && (
                          <p className="text-sm text-serenity-600 mt-0.5 truncate">
                            <span className="text-gray-400">Dr Ade: </span>
                            {conv.ai_response}
                          </p>
                        )}

                        {conv.transcription_redacted && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Voice: {conv.transcription_redacted}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-400">
                        {format(new Date(conv.created_at), 'MMM d, HH:mm')}
                      </p>
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="mx-auto mb-3 h-10 w-10 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-400">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a8 8 0 0 1-8 8H5l-2 2v-7a8 8 0 1 1 18-3Z" />
              </svg>
            </div>
            <p className="text-gray-500">
              {(search || sentimentFilter || typeFilter || emergencyOnly)
                ? 'No conversations match your filters'
                : 'No conversations yet'}
            </p>
            <p className="text-gray-400 text-sm mt-1">Conversations appear when patients message on WhatsApp</p>
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && !search && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {offset + 1}–{Math.min(offset + PER_PAGE, count ?? 0)} of {count?.toLocaleString()} conversations
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a href={buildUrl({ page: String(page - 1) })} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition">
                Previous
              </a>
            )}
            {page < totalPages && (
              <a href={buildUrl({ page: String(page + 1) })} className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition">
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
