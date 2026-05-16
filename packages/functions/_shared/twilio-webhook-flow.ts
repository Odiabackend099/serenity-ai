export type TwilioWebhookLogger = Pick<Console, 'error' | 'log' | 'warn'>

export type TwilioWebhookHandlerDeps = {
  publicWebhookUrl?: string | null
  verifySignature: (requestUrl: string, params: URLSearchParams, signatureHeader: string) => Promise<boolean>
  processMessage: (params: URLSearchParams) => Promise<string | null>
  triggerAiAssistant: (queueItemId: string) => Promise<void>
  runInBackground?: (promise: Promise<unknown>) => void
  logger?: TwilioWebhookLogger
}

export type TwilioQueuedPatient = {
  id: string
}

export type TwilioQueuedMessage = {
  id: string
}

export type TwilioMessageQueuePayload = {
  patient_id: string
  patient_phone: string
  phone_number: string
  message_text: string
  message_type: string
  media_url: string | null
  media_mime_type: string | null
  whatsapp_message_id: string
  raw_payload: Record<string, string>
  status: 'queued'
  retry_count: 0
  next_retry_at: string
}

export type TwilioMessageProcessorDeps = {
  findExistingQueuedMessage: (messageSid: string) => Promise<TwilioQueuedMessage | null>
  upsertPatient: (phoneNumber: string, contactName?: string) => Promise<TwilioQueuedPatient>
  queueMessage: (payload: TwilioMessageQueuePayload) => Promise<TwilioQueuedMessage>
  generateMessageSid?: () => string
  now?: () => Date
  logger?: TwilioWebhookLogger
}

export async function handleTwilioWebhookRequest(
  req: Request,
  deps: TwilioWebhookHandlerDeps,
): Promise<Response> {
  const logger = deps.logger ?? console

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
  const publicWebhookUrl = deps.publicWebhookUrl ?? null
  const isValid =
    await deps.verifySignature(publicWebhookUrl ?? req.url, params, signature) ||
    Boolean(publicWebhookUrl && await deps.verifySignature(req.url, params, signature))

  if (!isValid) {
    logger.error('[webhook] Invalid Twilio signature — request rejected')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const queueItemId = await deps.processMessage(params)
    if (queueItemId) {
      const trigger = deps.triggerAiAssistant(queueItemId)
      if (deps.runInBackground) deps.runInBackground(trigger)
      else void trigger.catch((err) => logger.error('[webhook] Background task failed:', err))
    }
  } catch (err) {
    logger.error('[webhook] Twilio processing error:', err)
    throw err
  }

  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function processTwilioMessageParams(
  params: URLSearchParams,
  deps: TwilioMessageProcessorDeps,
): Promise<string | null> {
  const logger = deps.logger ?? console
  const fromRaw = params.get('From') ?? ''
  const phoneNumber = fromRaw.replace(/^whatsapp:/, '')
  const messageSid = params.get('MessageSid') ?? params.get('SmsMessageSid') ?? (deps.generateMessageSid?.() ?? crypto.randomUUID())
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

  const existing = await deps.findExistingQueuedMessage(messageSid)
  if (existing) {
    logger.log(`[webhook] Duplicate Twilio message ${messageSid} — skipping`)
    return null
  }

  const patient = await deps.upsertPatient(phoneNumber, contactName)
  const queued = await deps.queueMessage({
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
    next_retry_at: (deps.now?.() ?? new Date()).toISOString(),
  })

  logger.log(`[webhook] Queued Twilio message ${messageSid} from ${phoneNumber} (patient: ${patient.id}, queue: ${queued.id})`)
  return queued.id
}

export function getTwilioMessageType(mimeType: string | null, body: string | null): string {
  if (!mimeType) return body ? 'text' : 'text'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'document'
}

export function getTwilioMediaPlaceholder(messageType: string): string {
  switch (messageType) {
    case 'audio': return '[Voice note]'
    case 'image': return '[Image]'
    case 'video': return '[Video]'
    case 'document': return '[Document]'
    default: return ''
  }
}
