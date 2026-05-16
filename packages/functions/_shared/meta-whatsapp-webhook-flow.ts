export type MetaWebhookLogger = Pick<Console, 'error' | 'log' | 'warn'>

export type MetaWebhookHandlerDeps = {
  verifyToken?: string | null
  appSecret?: string | null
  processMessage: (message: MetaInboundMessage) => Promise<string | null>
  triggerAiAssistant: (queueItemId: string) => Promise<void>
  runInBackground?: (promise: Promise<unknown>) => void
  logger?: MetaWebhookLogger
}

export type MetaInboundMessage = {
  from: string
  phoneNumber: string
  messageId: string
  contactName?: string
  messageText: string
  messageType: string
  mediaId: string | null
  mediaMimeType: string | null
  rawPayload: Record<string, unknown>
}

export type MetaQueuedPatient = {
  id: string
}

export type MetaQueuedMessage = {
  id: string
}

export type MetaMessageQueuePayload = {
  patient_id: string
  patient_phone: string
  phone_number: string
  message_text: string
  message_type: string
  media_url: string | null
  media_mime_type: string | null
  whatsapp_message_id: string
  raw_payload: Record<string, unknown>
  status: 'queued'
  retry_count: 0
  next_retry_at: string
}

export type MetaMessageProcessorDeps = {
  findExistingQueuedMessage: (messageId: string) => Promise<MetaQueuedMessage | null>
  upsertPatient: (phoneNumber: string, contactName?: string) => Promise<MetaQueuedPatient>
  queueMessage: (payload: MetaMessageQueuePayload) => Promise<MetaQueuedMessage>
  now?: () => Date
  logger?: MetaWebhookLogger
}

export async function handleMetaWebhookRequest(
  req: Request,
  deps: MetaWebhookHandlerDeps,
): Promise<Response> {
  const logger = deps.logger ?? console

  if (req.method === 'GET') {
    return handleMetaWebhookVerification(req, deps.verifyToken)
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const rawBody = await req.text()

  if (deps.appSecret) {
    const signatureHeader = req.headers.get('x-hub-signature-256') ?? ''
    const validSignature = await verifyMetaWebhookSignature(rawBody, deps.appSecret, signatureHeader)
    if (!validSignature) {
      logger.error('[meta-webhook] Invalid Meta signature — request rejected')
      return new Response('Unauthorized', { status: 401 })
    }
  } else {
    logger.warn('[meta-webhook] META_APP_SECRET is not set — POST signature verification skipped')
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const messages = extractMetaInboundMessages(payload)

  try {
    const triggers: Array<Promise<void>> = []
    for (const message of messages) {
      const queueItemId = await deps.processMessage(message)
      if (queueItemId) {
        triggers.push(deps.triggerAiAssistant(queueItemId))
      }
    }

    if (triggers.length > 0) {
      const triggerAll = Promise.all(triggers)
      if (deps.runInBackground) deps.runInBackground(triggerAll)
      else void triggerAll.catch((err) => logger.error('[meta-webhook] Background task failed:', err))
    }
  } catch (err) {
    logger.error('[meta-webhook] Processing error:', err)
    throw err
  }

  return new Response('EVENT_RECEIVED', { status: 200 })
}

export function handleMetaWebhookVerification(req: Request, verifyToken?: string | null): Response {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new Response('Forbidden', { status: 403 })
}

export async function processMetaInboundMessage(
  message: MetaInboundMessage,
  deps: MetaMessageProcessorDeps,
): Promise<string | null> {
  const logger = deps.logger ?? console

  if (!message.phoneNumber) {
    throw new Error('Meta webhook missing sender phone number')
  }

  const existing = await deps.findExistingQueuedMessage(message.messageId)
  if (existing) {
    logger.log(`[meta-webhook] Duplicate Meta message ${message.messageId} — skipping`)
    return null
  }

  const patient = await deps.upsertPatient(message.phoneNumber, message.contactName)
  const queued = await deps.queueMessage({
    patient_id: patient.id,
    patient_phone: message.phoneNumber,
    phone_number: message.phoneNumber,
    message_text: message.messageText,
    message_type: message.messageType,
    media_url: message.mediaId,
    media_mime_type: message.mediaMimeType,
    whatsapp_message_id: message.messageId,
    raw_payload: message.rawPayload,
    status: 'queued',
    retry_count: 0,
    next_retry_at: (deps.now?.() ?? new Date()).toISOString(),
  })

  logger.log(`[meta-webhook] Queued Meta message ${message.messageId} from ${message.phoneNumber} (patient: ${patient.id}, queue: ${queued.id})`)
  return queued.id
}

export function extractMetaInboundMessages(payload: Record<string, unknown>): MetaInboundMessage[] {
  const entries = asArray(payload.entry)
  const messages: MetaInboundMessage[] = []

  for (const entry of entries) {
    const changes = asArray(entry.changes)
    for (const change of changes) {
      const value = asRecord(change.value)
      const contacts = asArray(value.contacts)
      const inboundMessages = asArray(value.messages)

      for (const rawMessage of inboundMessages) {
        const message = asRecord(rawMessage)
        const from = asString(message.from)
        const messageId = asString(message.id)
        const messageType = normalizeMetaMessageType(asString(message.type))
        const contact = contacts.find((item) => asString(item.wa_id) === from)
        const contactName = asString(asRecord(asRecord(contact).profile).name) || undefined
        const { text, mediaId, mediaMimeType } = getMetaMessageContent(message, messageType)

        if (!from || !messageId) continue

        messages.push({
          from,
          phoneNumber: normalizeMetaPhone(from),
          messageId,
          contactName,
          messageText: text,
          messageType,
          mediaId,
          mediaMimeType,
          rawPayload: payload,
        })
      }
    }
  }

  return messages
}

export async function verifyMetaWebhookSignature(
  rawBody: string,
  appSecret: string,
  signatureHeader: string,
): Promise<boolean> {
  if (!signatureHeader.startsWith('sha256=')) return false

  const expectedHex = signatureHeader.slice('sha256='.length)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const actualHex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  return timingSafeEqual(actualHex, expectedHex)
}

function getMetaMessageContent(
  message: Record<string, unknown>,
  messageType: string,
): { text: string; mediaId: string | null; mediaMimeType: string | null } {
  if (messageType === 'text') {
    return {
      text: asString(asRecord(message.text).body) || '',
      mediaId: null,
      mediaMimeType: null,
    }
  }

  const media = asRecord(message[messageType])
  const mediaId = asString(media.id) || null
  const mimeType = asString(media.mime_type) || null

  return {
    text: getMetaMediaPlaceholder(messageType),
    mediaId,
    mediaMimeType: mimeType,
  }
}

function getMetaMediaPlaceholder(messageType: string): string {
  switch (messageType) {
    case 'audio': return '[Voice note]'
    case 'image': return '[Image]'
    case 'video': return '[Video]'
    case 'document': return '[Document]'
    case 'sticker': return '[Sticker]'
    default: return '[Message]'
  }
}

function normalizeMetaMessageType(type: string): string {
  if (['text', 'audio', 'image', 'video', 'document', 'sticker'].includes(type)) return type
  return type || 'unknown'
}

function normalizeMetaPhone(phone: string): string {
  const trimmed = phone.trim()
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
