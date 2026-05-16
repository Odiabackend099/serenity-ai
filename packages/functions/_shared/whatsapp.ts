/**
 * WhatsApp helpers.
 *
 * Meta Cloud API is the live provider when WHATSAPP_PROVIDER=meta.
 * Twilio remains supported as a backup provider.
 */

type WhatsAppProvider = 'twilio' | 'meta'

function getWhatsAppProvider(): WhatsAppProvider {
  return Deno.env.get('WHATSAPP_PROVIDER') === 'meta' ? 'meta' : 'twilio'
}

function getTwilioConfig(): { accountSid: string; authToken: string; whatsappFrom: string } {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const whatsappFrom = Deno.env.get('TWILIO_WHATSAPP_NUMBER')

  if (!accountSid || !authToken || !whatsappFrom) {
    throw new Error('Twilio WhatsApp is not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER')
  }

  return { accountSid, authToken, whatsappFrom }
}

function normalizeWhatsAppAddress(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.startsWith('whatsapp:')) return trimmed
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed}`
  return `whatsapp:${withPlus}`
}

function basicAuth(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`
}

async function sendTwilioWhatsApp(to: string, text: string): Promise<string> {
  const { accountSid, authToken, whatsappFrom } = getTwilioConfig()

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: normalizeWhatsAppAddress(whatsappFrom),
      To: normalizeWhatsAppAddress(to),
      Body: text,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio WhatsApp send failed (${res.status}): ${err}`)
  }

  const data = await res.json() as { sid?: string }
  return data.sid ?? ''
}

async function sendMetaWhatsApp(to: string, text: string): Promise<string> {
  const { phoneNumberId, accessToken, apiVersion } = getMetaWhatsAppConfig()
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeMetaRecipient(to),
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Meta WhatsApp send failed (${res.status}): ${err}`)
  }

  const data = await res.json() as { messages?: Array<{ id?: string }> }
  return data.messages?.[0]?.id ?? ''
}

async function sendMetaAudioWhatsApp(to: string, mediaId: string): Promise<string> {
  const { phoneNumberId, accessToken, apiVersion } = getMetaWhatsAppConfig()
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeMetaRecipient(to),
      type: 'audio',
      audio: { id: mediaId },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Meta WhatsApp audio send failed (${res.status}): ${err}`)
  }

  const data = await res.json() as { messages?: Array<{ id?: string }> }
  return data.messages?.[0]?.id ?? ''
}

async function uploadMetaMedia(
  mediaData: ArrayBuffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const { phoneNumberId, accessToken, apiVersion } = getMetaWhatsAppConfig()
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)
  form.append('file', new Blob([mediaData], { type: mimeType }), filename)

  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Meta WhatsApp media upload failed (${res.status}): ${err}`)
  }

  const data = await res.json() as { id?: string }
  if (!data.id) throw new Error('Meta WhatsApp media upload did not return a media ID')
  return data.id
}

async function sendMetaTemplateMessage(
  to: string,
  templateName: string,
  bodyParameters: string[] = [],
  languageCode = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? Deno.env.get('META_WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en_US',
): Promise<string> {
  const { phoneNumberId, accessToken, apiVersion } = getMetaWhatsAppConfig()
  const components = bodyParameters.length > 0
    ? [{
      type: 'body',
      parameters: bodyParameters.map((text) => ({
        type: 'text',
        text,
      })),
    }]
    : undefined

  const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeMetaRecipient(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components ? { components } : {}),
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Meta WhatsApp template send failed (${res.status}): ${err}`)
  }

  const data = await res.json() as { messages?: Array<{ id?: string }> }
  return data.messages?.[0]?.id ?? ''
}

function getMetaWhatsAppConfig(): { phoneNumberId: string; accessToken: string; apiVersion: string } {
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const accessToken = Deno.env.get('WHATSAPP_PERMANENT_ACCESS_TOKEN')
    ?? Deno.env.get('WHATSAPP_API_TOKEN')
    ?? Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')

  if (!phoneNumberId || !accessToken) {
    throw new Error('Meta WhatsApp is not configured — set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_PERMANENT_ACCESS_TOKEN')
  }

  const apiVersion = Deno.env.get('META_GRAPH_API_VERSION') ?? Deno.env.get('WHATSAPP_API_VERSION') ?? 'v21.0'
  return { phoneNumberId, accessToken, apiVersion }
}

/**
 * Send a plain text WhatsApp message through the configured provider.
 */
export async function sendTextMessage(to: string, text: string): Promise<string> {
  return getWhatsAppProvider() === 'meta'
    ? sendMetaWhatsApp(to, text)
    : sendTwilioWhatsApp(to, text)
}

/**
 * Upload and send an audio message through Meta WhatsApp.
 *
 * Twilio media replies require a public media URL, so generated in-memory TTS
 * audio is supported only on the Meta provider path used in production.
 */
export async function sendAudioMessage(
  to: string,
  audioData: ArrayBuffer,
  mimeType = 'audio/ogg; codecs=opus',
): Promise<string> {
  if (getWhatsAppProvider() !== 'meta') {
    throw new Error('Generated WhatsApp audio replies require WHATSAPP_PROVIDER=meta')
  }

  const mediaId = await uploadMetaMedia(audioData, mimeType, audioFilenameForMimeType(mimeType))
  return sendMetaAudioWhatsApp(to, mediaId)
}

/**
 * Send an approved Meta template message. Templates are only supported on the
 * Meta provider path; Twilio remains available for plain-text backup sends.
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string,
  bodyParameters: string[] = [],
  languageCode?: string,
): Promise<string> {
  if (getWhatsAppProvider() !== 'meta') {
    throw new Error('WhatsApp template sends require WHATSAPP_PROVIDER=meta')
  }

  return sendMetaTemplateMessage(to, templateName, bodyParameters, languageCode)
}

/**
 * Download media from WhatsApp.
 *
 * Twilio stores an absolute MediaUrl. Meta stores a media ID, which must first
 * be resolved to a temporary download URL through the Graph API.
 */
export async function downloadMedia(
  mediaReference: string,
  fallbackMimeType?: string | null,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  if (!mediaReference.startsWith('http://') && !mediaReference.startsWith('https://')) {
    return downloadMetaMedia(mediaReference, fallbackMimeType)
  }

  return downloadTwilioMedia(mediaReference)
}

async function downloadTwilioMedia(mediaUrl: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const { accountSid, authToken } = getTwilioConfig()
  const fileRes = await fetch(mediaUrl, {
    headers: { Authorization: basicAuth(accountSid, authToken) },
  })

  if (!fileRes.ok) {
    throw new Error(`Failed to download Twilio media: ${fileRes.status}`)
  }

  return {
    data: await fileRes.arrayBuffer(),
    mimeType: fileRes.headers.get('content-type') ?? 'application/octet-stream',
  }
}

async function downloadMetaMedia(
  mediaId: string,
  fallbackMimeType?: string | null,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const { accessToken, apiVersion } = getMetaWhatsAppConfig()
  const metadataRes = await fetch(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!metadataRes.ok) {
    const err = await metadataRes.text()
    throw new Error(`Meta WhatsApp media metadata failed (${metadataRes.status}): ${err}`)
  }

  const metadata = await metadataRes.json() as { url?: string; mime_type?: string }
  if (!metadata.url) {
    throw new Error('Meta WhatsApp media metadata did not include a download URL')
  }

  const fileRes = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!fileRes.ok) {
    const err = await fileRes.text()
    throw new Error(`Meta WhatsApp media download failed (${fileRes.status}): ${err}`)
  }

  return {
    data: await fileRes.arrayBuffer(),
    mimeType: fileRes.headers.get('content-type') ?? metadata.mime_type ?? fallbackMimeType ?? 'application/octet-stream',
  }
}

/**
 * Verify Twilio webhook signatures for form-encoded requests.
 */
export async function verifyTwilioWebhookSignature(
  requestUrl: string,
  params: URLSearchParams,
  signatureHeader: string,
): Promise<boolean> {
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  if (!authToken || !signatureHeader) return false

  const sortedKeys = [...new Set([...params.keys()])].sort()
  const data = requestUrl + sortedKeys.map((key) => `${key}${params.get(key) ?? ''}`).join('')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))

  return expected === signatureHeader
}

function normalizeMetaRecipient(phone: string): string {
  return phone.replace(/^whatsapp:/, '').replace(/[^\d]/g, '')
}

function audioFilenameForMimeType(mimeType: string): string {
  if (mimeType.includes('ogg') || mimeType.includes('opus')) return 'dr-ade-reply.ogg'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'dr-ade-reply.mp3'
  if (mimeType.includes('wav')) return 'dr-ade-reply.wav'
  return 'dr-ade-reply.audio'
}

export async function sendAppointmentReminder1Week(
  to: string,
  patientName: string,
  appointmentDate: string,
  appointmentTime: string,
  center: string,
  doctorName: string,
): Promise<string> {
  return sendTextMessage(
    to,
    `Dear ${patientName}, this is a reminder of your appointment at Serenity Royale Hospital in one week.\n\nDate: ${appointmentDate}\nTime: ${appointmentTime}\nCenter: ${center}\nDoctor: ${doctorName}\n\nTo reschedule, reply here or call +234 806 219 7384.`,
  )
}

export async function sendAppointmentReminder24h(
  to: string,
  patientName: string,
  appointmentDate: string,
  appointmentTime: string,
  center: string,
): Promise<string> {
  return sendTextMessage(
    to,
    `Dear ${patientName}, this is a 24-hour reminder for your Serenity Royale Hospital appointment.\n\nDate: ${appointmentDate}\nTime: ${appointmentTime}\nCenter: ${center}\n\nPlease arrive 10-15 minutes early. To reschedule, reply here or call +234 806 219 7384.`,
  )
}

export async function sendAppointmentReminder2h(
  to: string,
  patientName: string,
  appointmentDate: string,
  appointmentTime: string,
  center: string,
): Promise<string> {
  return sendTextMessage(
    to,
    `Dear ${patientName}, this is a 2-hour reminder for your Serenity Royale Hospital appointment.\n\nDate: ${appointmentDate}\nTime: ${appointmentTime}\nCenter: ${center}\n\nPlease arrive 10-15 minutes early. To reschedule, reply here or call +234 806 219 7384.`,
  )
}

export async function sendAppointmentConfirmation(
  to: string,
  patientName: string,
  appointmentDate: string,
  appointmentTime: string,
  center: string,
  doctorName: string,
  serviceType: string,
): Promise<string> {
  return sendTextMessage(
    to,
    `Appointment confirmed for ${patientName} at Serenity Royale Hospital.\n\nService: ${serviceType}\nDate: ${appointmentDate}\nTime: ${appointmentTime}\nCenter: ${center}\nDoctor: ${doctorName}\n\nPlease arrive 10-15 minutes early. To reschedule, reply here or call +234 806 219 7384.`,
  )
}

export async function sendFeedbackRequest(
  to: string,
  patientName: string,
  doctorName: string,
): Promise<string> {
  return sendTextMessage(
    to,
    `Dear ${patientName}, thank you for visiting Serenity Royale Hospital. How would you rate your appointment with ${doctorName}? Reply with a number from 1 to 5 and any comment you would like to share.`,
  )
}

export async function sendEmergencyFollowUp(to: string, patientName: string): Promise<string> {
  return sendTextMessage(
    to,
    `Dear ${patientName}, Serenity Royale Hospital is checking in after your recent emergency support message. If you are still in immediate danger, call +234 806 219 7384 now or go to the nearest emergency department.`,
  )
}
