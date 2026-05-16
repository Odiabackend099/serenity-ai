/**
 * WhatsApp Webhook Edge Function
 *
 * This entrypoint keeps the historical `whatsapp-webhook` URL working for both
 * Meta Cloud API and Twilio. Meta is the primary production provider, while
 * Twilio remains an explicit backup path.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, getSupabaseServiceRoleKey, getSupabaseUrl, upsertPatient } from '../_shared/supabase.ts'
import { verifyTwilioWebhookSignature } from '../_shared/whatsapp.ts'
import { handleTwilioWebhookRequest, processTwilioMessageParams } from '../_shared/twilio-webhook-flow.ts'
import {
  handleMetaWebhookRequest,
  processMetaInboundMessage,
  type MetaInboundMessage,
  type MetaMessageQueuePayload,
} from '../_shared/meta-whatsapp-webhook-flow.ts'

type EdgeRuntimeLike = {
  waitUntil?: (promise: Promise<unknown>) => void
}

serve(async (req: Request) => {
  if (shouldHandleAsMetaWebhook(req)) {
    return handleMetaWebhookRequest(req, {
      verifyToken: Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')
        ?? Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
        ?? Deno.env.get('WEBHOOK_VERIFY_TOKEN'),
      appSecret: Deno.env.get('META_APP_SECRET') ?? Deno.env.get('WHATSAPP_APP_SECRET'),
      processMessage: processMetaMessage,
      triggerAiAssistant,
      runInBackground,
    })
  }

  return handleTwilioWebhookRequest(req, {
    publicWebhookUrl: Deno.env.get('TWILIO_WEBHOOK_URL'),
    verifySignature: verifyTwilioWebhookSignature,
    processMessage: processTwilioMessage,
    triggerAiAssistant,
    runInBackground,
  })
})

function shouldHandleAsMetaWebhook(req: Request): boolean {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    return url.searchParams.has('hub.mode') || url.searchParams.has('hub.challenge')
  }

  if (req.method !== 'POST') return false

  const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
  return contentType.includes('application/json') || req.headers.has('x-hub-signature-256')
}

async function processTwilioMessage(params: URLSearchParams): Promise<string | null> {
  const supabase = getSupabaseClient()
  return processTwilioMessageParams(params, {
    findExistingQueuedMessage: async (messageSid) => {
      const { data } = await supabase
        .from('message_queue')
        .select('id')
        .eq('whatsapp_message_id', messageSid)
        .single()
      return data ?? null
    },
    upsertPatient: (phoneNumber, contactName) => upsertPatient(supabase, phoneNumber, contactName),
    queueMessage: async (payload) => {
      const { data: queued, error } = await supabase.from('message_queue').insert(payload).select('id').single()
      if (error || !queued) {
        const message = error?.message ?? 'insert returned no queue row'
        console.error(`[webhook] Failed to queue Twilio message ${payload.whatsapp_message_id}:`, message)
        throw error ?? new Error(message)
      }
      return queued
    },
  })
}

async function processMetaMessage(message: MetaInboundMessage): Promise<string | null> {
  const supabase = getSupabaseClient()
  return processMetaInboundMessage(message, {
    findExistingQueuedMessage: async (messageId) => {
      const { data } = await supabase
        .from('message_queue')
        .select('id')
        .eq('whatsapp_message_id', messageId)
        .single()
      return data ?? null
    },
    upsertPatient: (phoneNumber, contactName) => upsertPatient(supabase, phoneNumber, contactName),
    queueMessage: async (payload: MetaMessageQueuePayload) => {
      const { data: queued, error } = await supabase.from('message_queue').insert(payload).select('id').single()
      if (error || !queued) {
        const errorMessage = error?.message ?? 'insert returned no queue row'
        console.error(`[webhook] Failed to queue Meta message ${payload.whatsapp_message_id}:`, errorMessage)
        throw error ?? new Error(errorMessage)
      }
      return queued
    },
  })
}

async function triggerAiAssistant(queueItemId: string): Promise<void> {
  const supabaseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET')
  const authorizationToken = internalSecret ?? serviceRoleKey

  if (!supabaseUrl || !authorizationToken) {
    console.warn('[whatsapp-webhook] Immediate AI trigger skipped — missing Supabase URL or internal authorization secret')
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
    console.error(`[whatsapp-webhook] Immediate AI trigger failed (${res.status}): ${err.slice(0, 500)}`)
    return
  }

  console.log(`[whatsapp-webhook] Immediate AI trigger accepted for queue ${queueItemId}`)
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
