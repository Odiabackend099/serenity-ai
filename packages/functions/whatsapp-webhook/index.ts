/**
 * Twilio WhatsApp Webhook Edge Function
 *
 * Receives Twilio form-encoded inbound WhatsApp messages, verifies
 * X-Twilio-Signature, queues the message, and returns empty TwiML.
 *
 * Does NOT call the AI provider directly — ai-assistant processes the queue.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, getSupabaseServiceRoleKey, getSupabaseUrl, upsertPatient } from '../_shared/supabase.ts'
import { verifyTwilioWebhookSignature } from '../_shared/whatsapp.ts'

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const rawBody = await req.text()
  const contentType = req.headers.get('content-type') ?? ''

  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return new Response('Unsupported Media Type', { status: 415 })
  }

  const params = new URLSearchParams(rawBody)
  const signature = req.headers.get('x-twilio-signature') ?? ''
  const publicWebhookUrl = Deno.env.get('TWILIO_WEBHOOK_URL')
  const isValid =
    await verifyTwilioWebhookSignature(publicWebhookUrl ?? req.url, params, signature) ||
    Boolean(publicWebhookUrl && await verifyTwilioWebhookSignature(req.url, params, signature))

  if (!isValid) {
    console.error('[webhook] Invalid Twilio signature — request rejected')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const queueItemId = await processTwilioMessage(params)
    if (queueItemId) {
      runInBackground(triggerAiAssistant(queueItemId))
    }
  } catch (err) {
    console.error('[webhook] Twilio processing error:', err)
    throw err
  }

  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
})

async function processTwilioMessage(params: URLSearchParams): Promise<string | null> {
  const supabase = getSupabaseClient()

  const fromRaw = params.get('From') ?? ''
  const phoneNumber = fromRaw.replace(/^whatsapp:/, '')
  const messageSid = params.get('MessageSid') ?? params.get('SmsMessageSid') ?? crypto.randomUUID()
  const contactName = params.get('ProfileName') ?? undefined
  const body = params.get('Body') || null
  const numMedia = Number(params.get('NumMedia') ?? '0')
  const mediaUrl = numMedia > 0 ? params.get('MediaUrl0') : null
  const mimeType = numMedia > 0 ? params.get('MediaContentType0') : null
  const messageType = getTwilioMessageType(mimeType, body)
  const messageText = body || getTwilioMediaPlaceholder(messageType)

  if (!phoneNumber) {
    throw new Error('Twilio webhook missing From phone number')
  }

  const { data: existing } = await supabase
    .from('message_queue')
    .select('id')
    .eq('whatsapp_message_id', messageSid)
    .single()

  if (existing) {
    console.log(`[webhook] Duplicate Twilio message ${messageSid} — skipping`)
    return null
  }

  const patient = await upsertPatient(supabase, phoneNumber, contactName)

  const { data: queued, error } = await supabase.from('message_queue').insert({
    patient_id: patient.id,
    patient_phone: phoneNumber,
    phone_number: phoneNumber,
    message_text: messageText,
    message_type: messageType,
    media_url: mediaUrl,
    media_mime_type: mimeType,
    whatsapp_message_id: messageSid,
    raw_payload: Object.fromEntries(params.entries()),
    status: 'queued',
    retry_count: 0,
    next_retry_at: new Date().toISOString(),
  }).select('id').single()

  if (error || !queued) {
    const message = error?.message ?? 'insert returned no queue row'
    console.error(`[webhook] Failed to queue Twilio message ${messageSid}:`, message)
    throw error ?? new Error(message)
  }

  console.log(`[webhook] Queued Twilio message ${messageSid} from ${phoneNumber} (patient: ${patient.id}, queue: ${queued.id})`)
  return queued.id
}

async function triggerAiAssistant(queueItemId: string): Promise<void> {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET')
  const authorizationToken = internalSecret ?? serviceRoleKey

  if (!supabaseUrl || !authorizationToken) {
    console.warn('[webhook] Immediate AI trigger skipped — missing Supabase URL or internal authorization secret')
    return
  }

  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/ai-assistant`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authorizationToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ queueItemId }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[webhook] Immediate AI trigger failed (${res.status}): ${err.slice(0, 500)}`)
    return
  }

  console.log(`[webhook] Immediate AI trigger accepted for queue ${queueItemId}`)
}

function runInBackground(promise: Promise<unknown>): void {
  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise.catch((err) => {
      console.error('[webhook] Background task failed:', err)
    }))
    return
  }

  void promise.catch((err) => {
    console.error('[webhook] Background task failed:', err)
  })
}

function getTwilioMessageType(mimeType: string | null, body: string | null): string {
  if (!mimeType) return body ? 'text' : 'text'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'document'
}

function getTwilioMediaPlaceholder(messageType: string): string {
  switch (messageType) {
    case 'audio': return '[Voice note]'
    case 'image': return '[Image]'
    case 'video': return '[Video]'
    case 'document': return '[Document]'
    default: return ''
  }
}
