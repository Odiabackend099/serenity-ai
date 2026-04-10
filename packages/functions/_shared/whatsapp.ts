/**
 * WhatsApp Business Cloud API helpers.
 * Handles sending messages, media downloads, and template messages.
 * Rate limiting: per-patient 30 msg/min, global 80 msg/sec enforced by Meta.
 */

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v19.0'

function getConfig() {
  const token = Deno.env.get('WHATSAPP_API_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set')
  }
  return { token, phoneNumberId }
}

async function whatsappRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const { token, phoneNumberId } = getConfig()
  const url = `${WHATSAPP_API_BASE}/${phoneNumberId}${path}`

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`WhatsApp API ${method} ${path} failed (${res.status}): ${err}`)
  }

  return res.json()
}

/**
 * Send a plain text message to a WhatsApp number.
 * Use this within the 24-hour customer service window.
 */
export async function sendTextMessage(to: string, text: string): Promise<string> {
  const data = await whatsappRequest('POST', '/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text, preview_url: false },
  }) as { messages?: Array<{ id: string }> }

  return data.messages?.[0]?.id ?? ''
}

/**
 * Mark a WhatsApp message as read.
 */
export async function markAsRead(messageId: string): Promise<void> {
  await whatsappRequest('POST', '/messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  })
}

/**
 * Send a WhatsApp template message.
 * REQUIRED for messaging outside the 24-hour window (reminders, confirmations, etc.)
 * Templates must be pre-approved in Meta Business Manager.
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string = 'en',
  components: Array<{
    type: 'header' | 'body' | 'button'
    parameters: Array<{ type: 'text' | 'date_time' | 'currency'; text?: string }>
  }> = [],
): Promise<string> {
  const data = await whatsappRequest('POST', '/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: components.length > 0 ? components : undefined,
    },
  }) as { messages?: Array<{ id: string }> }

  return data.messages?.[0]?.id ?? ''
}

/**
 * Download media from WhatsApp by media ID.
 * Returns the raw bytes of the media file.
 */
export async function downloadMedia(mediaId: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const { token } = getConfig()

  // Step 1: Get media URL
  const metaRes = await fetch(`${WHATSAPP_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!metaRes.ok) {
    throw new Error(`Failed to get media URL for ${mediaId}: ${metaRes.status}`)
  }

  const meta = await metaRes.json() as { url: string; mime_type: string }

  // Step 2: Download actual file
  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!fileRes.ok) {
    throw new Error(`Failed to download media: ${fileRes.status}`)
  }

  return {
    data: await fileRes.arrayBuffer(),
    mimeType: meta.mime_type,
  }
}

/**
 * Send an appointment reminder (1 week before).
 * Uses pre-approved template message.
 */
export async function sendAppointmentReminder1Week(
  to: string,
  patientName: string,
  appointmentDate: string,
  appointmentTime: string,
  center: string,
  doctorName: string,
): Promise<string> {
  return sendTemplateMessage(to, 'appointment_reminder_1week', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: patientName },
        { type: 'text', text: appointmentDate },
        { type: 'text', text: appointmentTime },
        { type: 'text', text: center },
        { type: 'text', text: doctorName },
      ],
    },
  ])
}

/**
 * Send an appointment reminder (24 hours before).
 */
export async function sendAppointmentReminder24h(
  to: string,
  patientName: string,
  appointmentDate: string,
  appointmentTime: string,
  center: string,
): Promise<string> {
  return sendTemplateMessage(to, 'appointment_reminder_24h', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: patientName },
        { type: 'text', text: appointmentDate },
        { type: 'text', text: appointmentTime },
        { type: 'text', text: center },
      ],
    },
  ])
}

/**
 * Send appointment confirmation to patient.
 */
export async function sendAppointmentConfirmation(
  to: string,
  patientName: string,
  appointmentDate: string,
  appointmentTime: string,
  center: string,
  doctorName: string,
  serviceType: string,
): Promise<string> {
  return sendTemplateMessage(to, 'appointment_confirmation', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: patientName },
        { type: 'text', text: serviceType },
        { type: 'text', text: appointmentDate },
        { type: 'text', text: appointmentTime },
        { type: 'text', text: center },
        { type: 'text', text: doctorName },
      ],
    },
  ])
}

/**
 * Send feedback request 24 hours after appointment.
 */
export async function sendFeedbackRequest(
  to: string,
  patientName: string,
  doctorName: string,
): Promise<string> {
  return sendTemplateMessage(to, 'feedback_request', 'en', [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: patientName },
        { type: 'text', text: doctorName },
      ],
    },
  ])
}

/**
 * Send an emergency follow-up message to patient (24h after emergency).
 */
export async function sendEmergencyFollowUp(to: string, patientName: string): Promise<string> {
  return sendTemplateMessage(to, 'emergency_follow_up', 'en', [
    {
      type: 'body',
      parameters: [{ type: 'text', text: patientName }],
    },
  ])
}

/**
 * Verify WhatsApp webhook HMAC-SHA256 signature.
 * Call this on every incoming webhook request.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!appSecret) {
    console.error('WHATSAPP_APP_SECRET not set — cannot verify webhook signature')
    return false
  }

  const expectedSig = signatureHeader.replace('sha256=', '')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return hex === expectedSig
}
