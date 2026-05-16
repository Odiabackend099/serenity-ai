import { describe, expect, it } from 'vitest'
import {
  extractMetaOutboundStatuses,
  extractMetaInboundMessages,
  handleMetaWebhookRequest,
  metaStatusToNotificationUpdate,
  processMetaInboundMessage,
  processMetaOutboundStatuses,
  verifyMetaWebhookSignature,
  type MetaStatusNotificationUpdate,
  type MetaMessageQueuePayload,
} from './meta-whatsapp-webhook-flow.ts'

const fixedNow = new Date('2026-05-11T09:30:00.000Z')

function quietLogger() {
  return {
    error: () => undefined,
    log: () => undefined,
    warn: () => undefined,
  }
}

function metaPayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1710198646805009',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '15556497530',
            phone_number_id: '1094588787071221',
          },
          contacts: [{
            profile: { name: 'Austin Samuah' },
            wa_id: '2348141995397',
          }],
          messages: [{
            from: '2348141995397',
            id: 'wamid.test-1',
            timestamp: '1778490000',
            text: { body: 'Book an appointment' },
            type: 'text',
          }],
        },
      }],
    }],
  }
}

async function signedPost(payload: Record<string, unknown>, appSecret = 'app-secret'): Promise<Request> {
  const body = JSON.stringify(payload)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  return new Request('https://serenity.example/functions/v1/meta-whatsapp-webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${hex}`,
    },
    body,
  })
}

describe('Meta WhatsApp webhook integration flow', () => {
  it('validates Meta webhook subscription challenge', async () => {
    const request = new Request('https://serenity.example/functions/v1/meta-whatsapp-webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=challenge-123')
    const response = await handleMetaWebhookRequest(request, {
      verifyToken: 'verify-me',
      processMessage: async () => null,
      triggerAiAssistant: async () => undefined,
      logger: quietLogger(),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('challenge-123')
  })

  it('rejects invalid verification tokens and invalid signatures', async () => {
    const verification = await handleMetaWebhookRequest(
      new Request('https://serenity.example/functions/v1/meta-whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123'),
      {
        verifyToken: 'verify-me',
        processMessage: async () => null,
        triggerAiAssistant: async () => undefined,
        logger: quietLogger(),
      },
    )

    const invalidSignature = await handleMetaWebhookRequest(
      new Request('https://serenity.example/functions/v1/meta-whatsapp-webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=bad',
        },
        body: JSON.stringify(metaPayload()),
      }),
      {
        appSecret: 'app-secret',
        processMessage: async () => 'queue-never',
        triggerAiAssistant: async () => undefined,
        logger: quietLogger(),
      },
    )

    expect(verification.status).toBe(403)
    expect(invalidSignature.status).toBe(401)
  })

  it('queues a valid signed Meta text message and triggers AI immediately', async () => {
    const queuedPayloads: MetaMessageQueuePayload[] = []
    const background: Promise<unknown>[] = []
    const triggered: string[] = []

    const response = await handleMetaWebhookRequest(await signedPost(metaPayload()), {
      appSecret: 'app-secret',
      logger: quietLogger(),
      processMessage: (message) => processMetaInboundMessage(message, {
        now: () => fixedNow,
        logger: quietLogger(),
        findExistingQueuedMessage: async () => null,
        upsertPatient: async (phoneNumber, contactName) => ({
          id: `patient-${phoneNumber}-${contactName}`,
        }),
        queueMessage: async (payload) => {
          queuedPayloads.push(payload)
          return { id: 'queue-meta-1' }
        },
      }),
      triggerAiAssistant: async (queueItemId) => {
        triggered.push(queueItemId)
      },
      runInBackground: (promise) => background.push(promise),
    })

    await Promise.all(background)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('EVENT_RECEIVED')
    expect(queuedPayloads).toHaveLength(1)
    expect(queuedPayloads[0]).toMatchObject({
      patient_phone: '+2348141995397',
      phone_number: '+2348141995397',
      message_text: 'Book an appointment',
      message_type: 'text',
      whatsapp_message_id: 'wamid.test-1',
      status: 'queued',
      retry_count: 0,
      next_retry_at: fixedNow.toISOString(),
    })
    expect(triggered).toEqual(['queue-meta-1'])
  })

  it('records status callbacks and skips duplicate inbound messages safely', async () => {
    const statusOnly = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            statuses: [{
              id: 'wamid.status-only',
              status: 'delivered',
              timestamp: '1778490000',
              recipient_id: '2348072023652',
            }],
          },
        }],
      }],
    }
    const updates: Array<{ messageId: string; update: MetaStatusNotificationUpdate }> = []

    const noMessages = extractMetaInboundMessages(statusOnly)
    const statuses = extractMetaOutboundStatuses(statusOnly)
    await processMetaOutboundStatuses(statuses, {
      logger: quietLogger(),
      updateNotificationByExternalMessageId: async (messageId, update) => {
        updates.push({ messageId, update })
      },
    })
    const duplicate = await processMetaInboundMessage(extractMetaInboundMessages(metaPayload())[0], {
      logger: quietLogger(),
      findExistingQueuedMessage: async () => ({ id: 'queue-existing' }),
      upsertPatient: async () => ({ id: 'patient-1' }),
      queueMessage: async () => ({ id: 'queue-new' }),
    })

    expect(noMessages).toEqual([])
    expect(statuses).toEqual([{
      messageId: 'wamid.status-only',
      status: 'delivered',
      recipientId: '2348072023652',
      timestamp: '2026-05-11T09:00:00.000Z',
      errorMessage: null,
      rawPayload: statusOnly,
    }])
    expect(updates).toEqual([{
      messageId: 'wamid.status-only',
      update: {
        status: 'delivered',
        delivered_at: '2026-05-11T09:00:00.000Z',
        error_message: null,
      },
    }])
    expect(duplicate).toBeNull()
  })

  it('maps failed Meta status callbacks into staff-readable notification updates', () => {
    const statuses = extractMetaOutboundStatuses({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            statuses: [{
              id: 'wamid.failed-1',
              status: 'failed',
              recipient_id: '2348062197384',
              errors: [{
                code: 131030,
                title: 'Recipient phone number not in allowed list',
                message: 'Message failed to send',
                error_data: { details: 'Recipient phone number not in allowed list' },
              }],
            }],
          },
        }],
      }],
    })

    expect(statuses).toHaveLength(1)
    expect(metaStatusToNotificationUpdate(statuses[0])).toEqual({
      status: 'failed',
      error_message: 'Meta error 131030: Recipient phone number not in allowed list: Message failed to send: Recipient phone number not in allowed list',
    })
  })

  it('extracts media messages using safe placeholders', () => {
    const payload = metaPayload()
    const value = payload.entry[0].changes[0].value
    value.messages = [{
      from: '2348141995397',
      id: 'wamid.audio-1',
      timestamp: '1778490000',
      audio: { id: 'media-audio-1', mime_type: 'audio/ogg' },
      type: 'audio',
    }]

    const messages = extractMetaInboundMessages(payload)

    expect(messages[0]).toMatchObject({
      messageId: 'wamid.audio-1',
      messageText: '[Voice note]',
      messageType: 'audio',
      mediaId: 'media-audio-1',
      mediaMimeType: 'audio/ogg',
    })
  })

  it('verifies Meta HMAC signatures with SHA-256', async () => {
    const request = await signedPost(metaPayload(), 'shared-secret')
    const signature = request.headers.get('x-hub-signature-256') ?? ''

    await expect(verifyMetaWebhookSignature(JSON.stringify(metaPayload()), 'shared-secret', signature)).resolves.toBe(true)
    await expect(verifyMetaWebhookSignature(JSON.stringify(metaPayload()), 'wrong-secret', signature)).resolves.toBe(false)
  })
})
