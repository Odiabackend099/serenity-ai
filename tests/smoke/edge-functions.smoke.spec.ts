import { expect, test } from '@playwright/test'

const functionsUrl = process.env.SMOKE_SUPABASE_FUNCTIONS_URL ?? process.env.SUPABASE_FUNCTIONS_URL
const serviceRoleKey = process.env.SMOKE_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const runLiveSmoke = process.env.RUN_LIVE_SMOKE === '1'

test.describe('safe Edge Function smoke checks', () => {
  test.skip(!runLiveSmoke || !functionsUrl, 'Set RUN_LIVE_SMOKE=1 and SMOKE_SUPABASE_FUNCTIONS_URL to run safe live Edge Function smoke checks')

  test('Twilio webhook rejects invalid signatures and wrong methods', async ({ request }) => {
    const base = functionsUrl!.replace(/\/+$/, '')

    const wrongMethod = await request.get(`${base}/whatsapp-webhook`)
    expect(wrongMethod.status()).toBe(405)

    const invalidSignature = await request.post(`${base}/whatsapp-webhook`, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'invalid',
      },
      form: {
        From: 'whatsapp:+15550000000',
        Body: 'smoke test invalid signature',
        MessageSid: 'SMOKE_INVALID_SIGNATURE',
      },
    })
    expect(invalidSignature.status()).toBe(401)
  })

  test('internal notification function rejects unauthenticated requests', async ({ request }) => {
    const base = functionsUrl!.replace(/\/+$/, '')
    const response = await request.post(`${base}/send-notification`, {
      data: { type: 'manual_message', phone: '+15550000000', message: 'smoke test' },
    })

    expect(response.status()).toBe(401)
  })

  test('appointment reminder rejects unauthenticated requests', async ({ request }) => {
    const base = functionsUrl!.replace(/\/+$/, '')
    const response = await request.post(`${base}/appointment-reminder`, {
      data: {
        manual: true,
        appointmentId: 'smoke-unauthenticated',
        reminderType: '2h',
        phone: '15550000000',
        appointmentDate: '2026-05-20',
        appointmentTime: '10:00',
      },
    })

    expect(response.status()).toBe(401)
  })

  test('appointment reminder validates manual reminder payload before sending', async ({ request }) => {
    test.skip(!serviceRoleKey, 'Set SMOKE_SUPABASE_SERVICE_ROLE_KEY to test authenticated validation without sending WhatsApp')

    const base = functionsUrl!.replace(/\/+$/, '')
    const response = await request.post(`${base}/appointment-reminder`, {
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey!,
      },
      data: {
        manual: true,
        appointmentId: 'smoke-invalid-payload',
        reminderType: '12h',
        appointmentDate: '2026-05-20',
        appointmentTime: '10:00',
      },
    })

    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.sent === false || typeof body.error === 'string').toBe(true)
    if (body.allowedReminderTypes) {
      expect(body.allowedReminderTypes).toEqual(['1week', '24h', '2h'])
    }
  })
})
