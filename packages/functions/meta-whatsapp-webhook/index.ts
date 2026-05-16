/**
 * Meta WhatsApp Cloud API Webhook Edge Function
 *
 * Supports Meta's GET verification challenge, verifies POST signatures when
 * META_APP_SECRET is configured, queues inbound WhatsApp messages into the
 * same message_queue table used by Twilio, then triggers ai-assistant.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { getSupabaseClient, getSupabaseServiceRoleKey, getSupabaseUrl, upsertPatient } from '../_shared/supabase.ts'
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
  return handleMetaWebhookRequest(req, {
    verifyToken: Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')
      ?? Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')
      ?? Deno.env.get('WEBHOOK_VERIFY_TOKEN'),
    appSecret: Deno.env.get('META_APP_SECRET') ?? Deno.env.get('WHATSAPP_APP_SECRET'),
    processMessage: processMetaMessage,
    triggerAiAssistant,
    runInBackground,
  })
})

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
        console.error(`[meta-webhook] Failed to queue Meta message ${payload.whatsapp_message_id}:`, errorMessage)
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
    console.warn('[meta-webhook] Immediate AI trigger skipped — missing Supabase URL or internal authorization secret')
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
    console.error(`[meta-webhook] Immediate AI trigger failed (${res.status}): ${err.slice(0, 500)}`)
    return
  }

  console.log(`[meta-webhook] Immediate AI trigger accepted for queue ${queueItemId}`)
}

function runInBackground(promise: Promise<unknown>): void {
  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise.catch((err) => {
      console.error('[meta-webhook] Background task failed:', err)
    }))
    return
  }

  void promise.catch((err) => {
    console.error('[meta-webhook] Background task failed:', err)
  })
}
