/**
 * WhatsApp Webhook Edge Function
 *
 * Responsibilities:
 * 1. Verify webhook via GET challenge (Meta setup)
 * 2. Verify HMAC-SHA256 signature on every POST
 * 3. Idempotency check (deduplicate duplicate webhook deliveries)
 * 4. Parse message, upsert patient, check NDPR consent
 * 5. Queue message in message_queue table — return 200 immediately
 *    (AI processing is async — avoids Edge Function CPU timeout)
 *
 * Does NOT call NVIDIA AI directly — that's ai-assistant's job.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, upsertPatient } from '../_shared/supabase.ts'
import { verifyWebhookSignature, markAsRead } from '../_shared/whatsapp.ts'
import type { WhatsAppWebhookPayload, WhatsAppMessage } from '../_shared/types.ts'

serve(async (req: Request) => {
  const url = new URL(req.url)

  // ── GET: Webhook verification (Meta setup step) ──────────────────────────
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const VERIFY_TOKEN = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
    if (!VERIFY_TOKEN) {
      console.error('[webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN env var not set')
      return new Response('Server misconfigured', { status: 500 })
    }

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[webhook] Webhook verified successfully')
      return new Response(challenge, { status: 200 })
    }

    return new Response('Forbidden', { status: 403 })
  }

  // ── POST: Incoming message ────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Clone body for signature verification (body can only be read once)
  const rawBody = await req.text()

  // HMAC-SHA256 signature verification
  const signature = req.headers.get('x-hub-signature-256') ?? ''
  const isValid = await verifyWebhookSignature(rawBody, signature)
  if (!isValid) {
    console.error('[webhook] Invalid signature — request rejected')
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: WhatsAppWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  // Must respond 200 within 5 seconds or Meta will retry
  // Process asynchronously after responding
  const processing = handlePayload(payload).catch((err) => {
    console.error('[webhook] Processing error:', err)
  })

  // Fire-and-forget — do not await
  void processing

  return new Response('OK', { status: 200 })
})

async function handlePayload(payload: WhatsAppWebhookPayload): Promise<void> {
  const supabase = getSupabaseClient()

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value

      if (change.field !== 'messages') continue

      // Process incoming messages
      for (const message of value.messages ?? []) {
        await processIncomingMessage(supabase, message, value.contacts?.[0]?.profile?.name)
      }
    }
  }
}

async function processIncomingMessage(
  supabase: ReturnType<typeof getSupabaseClient>,
  message: WhatsAppMessage,
  contactName?: string,
): Promise<void> {
  const phoneNumber = message.from

  // ── Idempotency check ────────────────────────────────────────────────────
  // Prevent duplicate processing if Meta delivers the same webhook twice
  const { data: existing } = await supabase
    .from('message_queue')
    .select('id')
    .eq('whatsapp_message_id', message.id)
    .single()

  if (existing) {
    console.log(`[webhook] Duplicate message ${message.id} — skipping`)
    return
  }

  // ── Upsert patient ───────────────────────────────────────────────────────
  const patient = await upsertPatient(supabase, phoneNumber, contactName)

  // Mark message as read immediately (good UX)
  await markAsRead(message.id).catch((err) => {
    console.warn('[webhook] Failed to mark as read:', err.message)
  })

  // ── Extract message content ──────────────────────────────────────────────
  let messageText: string | null = null
  let mediaUrl: string | null = null
  let mimeType: string | null = null

  switch (message.type) {
    case 'text':
      messageText = message.text?.body ?? null
      break
    case 'audio':
      mimeType = message.audio?.mime_type ?? 'audio/ogg'
      // Media ID stored for async download by ai-assistant
      mediaUrl = message.audio?.id ?? null
      messageText = '[Voice note]'
      break
    case 'image':
      mimeType = message.image?.mime_type ?? 'image/jpeg'
      mediaUrl = message.image?.id ?? null
      messageText = message.image?.caption ?? '[Image]'
      break
    case 'video':
      mimeType = message.video?.mime_type ?? 'video/mp4'
      mediaUrl = message.video?.id ?? null
      messageText = message.video?.caption ?? '[Video]'
      break
    case 'document':
      mimeType = message.document?.mime_type ?? 'application/pdf'
      mediaUrl = message.document?.id ?? null
      messageText = message.document?.caption ?? `[${message.document?.filename ?? 'Document'}]`
      break
    default:
      messageText = `[${message.type}]`
  }

  // ── Queue for async AI processing ────────────────────────────────────────
  const { error } = await supabase.from('message_queue').insert({
    patient_id: patient.id,
    phone_number: phoneNumber,
    message_text: messageText,
    message_type: message.type,
    media_url: mediaUrl,
    media_mime_type: mimeType,
    whatsapp_message_id: message.id,
    status: 'queued',
    retry_count: 0,
    next_retry_at: new Date().toISOString(),
  })

  if (error) {
    console.error(`[webhook] Failed to queue message ${message.id}:`, error.message)
    throw error
  }

  console.log(`[webhook] Queued message ${message.id} from ${phoneNumber} (patient: ${patient.id})`)
}
