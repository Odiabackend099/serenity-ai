import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

let _client: SupabaseClient | null = null

/**
 * Returns a singleton Supabase service-role client for use inside Edge Functions.
 * Uses the service role key (bypasses RLS) — only use server-side.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client

  const url = getSupabaseUrl()
  const key = getSupabaseServiceRoleKey()

  if (!url || !key) {
    throw new Error('SUPABASE_URL and service role key must be set')
  }

  _client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return _client
}

export function getSupabaseUrl(): string | undefined {
  return Deno.env.get('SERENITY_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL')
}

export function getSupabaseServiceRoleKey(): string | undefined {
  return Deno.env.get('SERENITY_SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

export function isAuthorizedInternalRequest(req: Request): boolean {
  const authHeader = req.headers.get('Authorization')
  const serviceKey = getSupabaseServiceRoleKey()
  const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET')

  if (serviceKey && authHeader?.includes(serviceKey.slice(0, 20))) {
    return true
  }

  return Boolean(internalSecret && authHeader === `Bearer ${internalSecret}`)
}

/**
 * Look up or create a patient by phone number.
 * Returns the patient row. Creates with NDPR consent = false if new.
 */
export async function upsertPatient(
  supabase: SupabaseClient,
  phoneNumber: string,
  name?: string,
): Promise<{ id: string; phone_number: string; consent_ndpr: boolean; name: string | null }> {
  const normalizedPhone = normalizePatientPhoneNumber(phoneNumber)
  const phoneVariants = patientPhoneVariants(phoneNumber)

  const { data: existingMatches, error: existingError } = await supabase
    .from('patients')
    .select('id, phone_number, consent_ndpr, name, created_at')
    .in('phone_number', phoneVariants)
    .order('created_at', { ascending: true })
    .limit(10)

  if (existingError) {
    throw new Error(`Failed to load patient by phone number: ${existingError.message}`)
  }

  const existing = (existingMatches ?? [])[0] ?? null

  if (existing) {
    // Update name if we now know it and didn't before
    const updates: Record<string, string> = {}
    if (name && !existing.name) {
      updates.name = name
    }
    if (existing.phone_number !== normalizedPhone && !hasConflictingPhoneRecord(existingMatches ?? [], existing.id, normalizedPhone)) {
      updates.phone_number = normalizedPhone
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('patients').update(updates).eq('id', existing.id)
      if (error) throw new Error(`Failed to update patient: ${error.message}`)
      return {
        id: existing.id,
        phone_number: updates.phone_number ?? existing.phone_number,
        consent_ndpr: existing.consent_ndpr,
        name: updates.name ?? existing.name,
      }
    }
    return existing
  }

  const { data: created, error } = await supabase
    .from('patients')
    .insert({
      phone_number: normalizedPhone,
      name: name ?? null,
      consent_ndpr: false,
    })
    .select('id, phone_number, consent_ndpr, name')
    .single()

  if (error || !created) {
    throw new Error(`Failed to create patient: ${error?.message}`)
  }

  return created
}

function normalizePatientPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '')
  return digits ? `+${digits}` : phoneNumber.trim()
}

function patientPhoneVariants(phoneNumber: string): string[] {
  const digits = phoneNumber.replace(/\D/g, '')
  return [...new Set([phoneNumber.trim(), digits, digits ? `+${digits}` : ''].filter(Boolean))]
}

function hasConflictingPhoneRecord(
  matches: Array<{ id: string; phone_number: string }>,
  currentPatientId: string,
  normalizedPhone: string,
): boolean {
  return matches.some((patient) => patient.id !== currentPatientId && patient.phone_number === normalizedPhone)
}

/**
 * Record NDPR consent for a patient.
 * Stores the verbatim consent message as evidence.
 */
export async function recordConsent(
  supabase: SupabaseClient,
  patientId: string,
  consentMessage: string,
): Promise<void> {
  await Promise.all([
    supabase.from('patients').update({ consent_ndpr: true, consent_date: new Date().toISOString() }).eq('id', patientId),
    supabase.from('consent_log').insert({
      patient_id: patientId,
      consent_type: 'ndpr_data_processing',
      consent_given: true,
      consent_text: consentMessage,
    }),
  ])
}

/**
 * Get the last N conversation turns for a patient (for AI context).
 */
export async function getConversationHistory(
  supabase: SupabaseClient,
  patientId: string,
  limit = 10,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data } = await supabase
    .from('conversations')
    .select('patient_message, ai_response, created_at')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!data) return []

  // Reverse to chronological order and build messages array
  return data
    .reverse()
    .flatMap((conv) => {
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
      if (conv.patient_message) messages.push({ role: 'user', content: conv.patient_message })
      if (conv.ai_response) messages.push({ role: 'assistant', content: conv.ai_response })
      return messages
    })
}

/**
 * Save a conversation record to the database.
 */
export async function saveConversation(
  supabase: SupabaseClient,
  data: {
    patientId: string
    messageType: string
    patientMessage: string | null
    patientMessageRedacted: string | null
    aiResponse: string | null
    mediaUrl: string | null
    sentiment: string | null
    hasEmergencyKeywords: boolean
    whatsappMessageId: string
    transcription: string | null
    transcriptionRedacted: string | null
  },
): Promise<string> {
  const { data: conv, error } = await supabase
    .from('conversations')
    .insert({
      patient_id: data.patientId,
      message_type: data.messageType,
      patient_message: data.patientMessage,
      patient_message_redacted: data.patientMessageRedacted,
      ai_response: data.aiResponse,
      media_url: data.mediaUrl,
      sentiment: data.sentiment,
      has_emergency_keywords: data.hasEmergencyKeywords,
      whatsapp_message_id: data.whatsappMessageId,
      transcription: data.transcription,
      transcription_redacted: data.transcriptionRedacted,
    })
    .select('id')
    .single()

  if (error || !conv) {
    throw new Error(`Failed to save conversation: ${error?.message}`)
  }

  return conv.id
}

/**
 * Track API usage for budget monitoring.
 */
export async function trackApiUsage(
  supabase: SupabaseClient,
  provider: string,
  costUsd = 0,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]

  const { data: existing } = await supabase
    .from('api_quotas')
    .select('id, call_count, budget_used')
    .eq('provider', provider)
    .eq('date', today)
    .single()

  if (existing) {
    await supabase
      .from('api_quotas')
      .update({
        call_count: (existing.call_count ?? 0) + 1,
        budget_used: (existing.budget_used ?? 0) + costUsd,
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('api_quotas').insert({
      provider,
      date: today,
      call_count: 1,
      budget_used: costUsd,
    })
  }
}
