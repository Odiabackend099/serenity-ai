import { sendTemplateMessage, sendTextMessage } from './whatsapp.ts'

export type StaffWhatsAppNotificationKind =
  | 'booking_request'
  | 'dashboard_confirmation'
  | 'assigned_doctor_confirmation'

export type StaffWhatsAppNotificationInput = {
  kind: StaffWhatsAppNotificationKind
  to: string
  text: string
  bodyParameters: string[]
}

export type StaffWhatsAppNotificationResult = {
  externalMessageId: string
  messageContent: string
  templateName: string
  usedTemplate: boolean
}

export async function sendStaffWhatsAppNotification(
  input: StaffWhatsAppNotificationInput,
): Promise<StaffWhatsAppNotificationResult> {
  const templateName = staffTemplateName(input.kind)
  const requireTemplates = envFlag('STAFF_WHATSAPP_REQUIRE_TEMPLATES', false)
  const allowFreeformFallback = envFlag('STAFF_WHATSAPP_FREEFORM_FALLBACK', !templateName && !requireTemplates)

  if (templateName) {
    try {
      const externalMessageId = await sendTemplateMessage(input.to, templateName, input.bodyParameters)
      return {
        externalMessageId,
        messageContent: templateAuditContent(templateName, input.bodyParameters),
        templateName,
        usedTemplate: true,
      }
    } catch (err) {
      if (!allowFreeformFallback) throw err
      console.warn(`[staff-whatsapp] Template send failed for ${input.kind}; falling back to free-form text:`, err)
    }
  } else if (requireTemplates) {
    throw new Error(`Meta WhatsApp template is not configured for staff notification: ${input.kind}`)
  }

  const externalMessageId = await sendTextMessage(input.to, input.text)
  return {
    externalMessageId,
    messageContent: input.text,
    templateName: `${input.kind}_freeform`,
    usedTemplate: false,
  }
}

export function staffTemplateName(kind: StaffWhatsAppNotificationKind): string | null {
  switch (kind) {
    case 'booking_request':
      return env('WHATSAPP_STAFF_BOOKING_ALERT_TEMPLATE')
        ?? env('META_STAFF_BOOKING_ALERT_TEMPLATE')
        ?? null
    case 'dashboard_confirmation':
      return env('WHATSAPP_STAFF_CONFIRMATION_TEMPLATE')
        ?? env('META_STAFF_CONFIRMATION_TEMPLATE')
        ?? null
    case 'assigned_doctor_confirmation':
      return env('WHATSAPP_ASSIGNED_DOCTOR_CONFIRMATION_TEMPLATE')
        ?? env('META_ASSIGNED_DOCTOR_CONFIRMATION_TEMPLATE')
        ?? env('WHATSAPP_STAFF_CONFIRMATION_TEMPLATE')
        ?? env('META_STAFF_CONFIRMATION_TEMPLATE')
        ?? null
  }
}

function templateAuditContent(templateName: string, bodyParameters: string[]): string {
  return `WhatsApp template ${templateName} sent with: ${bodyParameters.join(' | ')}`.slice(0, 2000)
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const value = env(name)
  if (value === null) return defaultValue
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes'
}

function env(name: string): string | null {
  const value = Deno.env.get(name)
  return value && value.trim() ? value.trim() : null
}
