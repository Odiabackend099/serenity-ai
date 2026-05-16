import { describe, expect, it } from 'vitest'
import {
  handleTwilioWebhookRequest,
  processTwilioMessageParams,
  type TwilioMessageQueuePayload,
} from './twilio-webhook-flow.ts'

const fixedNow = new Date('2026-05-09T09:30:00.000Z')

function formRequest(body: URLSearchParams, signature = 'valid-signature', contentType = 'application/x-www-form-urlencoded'): Request {
  return new Request('https://serenity.example/functions/v1/whatsapp-webhook', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-twilio-signature': signature,
    },
    body,
  })
}

function quietLogger() {
  return {
    error: () => undefined,
    log: () => undefined,
    warn: () => undefined,
  }
}

describe('Twilio webhook integration flow', () => {
  it('queues a valid signed WhatsApp message and triggers AI immediately', async () => {
    const queuedPayloads: TwilioMessageQueuePayload[] = []
    const background: Promise<unknown>[] = []
    const triggered: string[] = []
    const params = new URLSearchParams({
      From: 'whatsapp:+2348141995397',
      Body: 'Book an appointment',
      MessageSid: 'SM-valid-1',
      ProfileName: 'Austyn Samuah',
      NumMedia: '0',
    })

    const response = await handleTwilioWebhookRequest(formRequest(params), {
      logger: quietLogger(),
      verifySignature: async (_url, _params, signature) => signature === 'valid-signature',
      processMessage: (messageParams) => processTwilioMessageParams(messageParams, {
        now: () => fixedNow,
        logger: quietLogger(),
        findExistingQueuedMessage: async () => null,
        upsertPatient: async (phoneNumber, contactName) => ({
          id: `patient-${phoneNumber}-${contactName}`,
        }),
        queueMessage: async (payload) => {
          queuedPayloads.push(payload)
          return { id: 'queue-1' }
        },
      }),
      triggerAiAssistant: async (queueItemId) => {
        triggered.push(queueItemId)
      },
      runInBackground: (promise) => background.push(promise),
    })

    await Promise.all(background)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<Response></Response>')
    expect(queuedPayloads).toHaveLength(1)
    expect(queuedPayloads[0]).toMatchObject({
      patient_phone: '+2348141995397',
      phone_number: '+2348141995397',
      message_text: 'Book an appointment',
      message_type: 'text',
      whatsapp_message_id: 'SM-valid-1',
      status: 'queued',
      retry_count: 0,
      next_retry_at: fixedNow.toISOString(),
    })
    expect(triggered).toEqual(['queue-1'])
  })

  it('does not queue or trigger duplicates for the same Twilio MessageSid', async () => {
    const queuedPayloads: TwilioMessageQueuePayload[] = []
    const triggered: string[] = []
    const params = new URLSearchParams({
      From: 'whatsapp:+2348141995397',
      Body: 'hello',
      MessageSid: 'SM-duplicate',
      NumMedia: '0',
    })

    const response = await handleTwilioWebhookRequest(formRequest(params), {
      logger: quietLogger(),
      verifySignature: async () => true,
      processMessage: (messageParams) => processTwilioMessageParams(messageParams, {
        logger: quietLogger(),
        findExistingQueuedMessage: async () => ({ id: 'queue-existing' }),
        upsertPatient: async () => ({ id: 'patient-1' }),
        queueMessage: async (payload) => {
          queuedPayloads.push(payload)
          return { id: 'queue-new' }
        },
      }),
      triggerAiAssistant: async (queueItemId) => {
        triggered.push(queueItemId)
      },
    })

    expect(response.status).toBe(200)
    expect(queuedPayloads).toHaveLength(0)
    expect(triggered).toHaveLength(0)
  })

  it('rejects invalid Twilio signatures and unsupported content types', async () => {
    const params = new URLSearchParams({
      From: 'whatsapp:+2348141995397',
      Body: 'hello',
      MessageSid: 'SM-invalid',
    })

    const invalidSignature = await handleTwilioWebhookRequest(formRequest(params, 'bad-signature'), {
      logger: quietLogger(),
      verifySignature: async () => false,
      processMessage: async () => 'queue-never',
      triggerAiAssistant: async () => undefined,
    })

    const badContentType = await handleTwilioWebhookRequest(formRequest(params, 'valid-signature', 'application/json'), {
      logger: quietLogger(),
      verifySignature: async () => true,
      processMessage: async () => 'queue-never',
      triggerAiAssistant: async () => undefined,
    })

    expect(invalidSignature.status).toBe(401)
    expect(badContentType.status).toBe(415)
  })

  it('accepts media payloads and stores a safe placeholder for AI processing', async () => {
    const queuedPayloads: TwilioMessageQueuePayload[] = []
    const params = new URLSearchParams({
      From: 'whatsapp:+2348141995397',
      MessageSid: 'SM-media',
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/audio',
      MediaContentType0: 'audio/ogg',
    })

    await processTwilioMessageParams(params, {
      logger: quietLogger(),
      findExistingQueuedMessage: async () => null,
      upsertPatient: async () => ({ id: 'patient-media' }),
      queueMessage: async (payload) => {
        queuedPayloads.push(payload)
        return { id: 'queue-media' }
      },
    })

    expect(queuedPayloads[0]).toMatchObject({
      message_text: '[Voice note]',
      message_type: 'audio',
      media_url: 'https://api.twilio.com/media/audio',
      media_mime_type: 'audio/ogg',
    })
  })
})
