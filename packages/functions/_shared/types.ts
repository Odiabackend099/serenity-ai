// Shared types for all Supabase Edge Functions

export interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'location'
  text?: { body: string }
  audio?: { id: string; mime_type: string }
  image?: { id: string; caption?: string; mime_type: string }
  video?: { id: string; caption?: string; mime_type: string }
  document?: { id: string; filename?: string; caption?: string; mime_type: string }
}

export interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messaging_product: string
        metadata: { display_phone_number: string; phone_number_id: string }
        contacts?: Array<{ profile: { name: string }; wa_id: string }>
        messages?: WhatsAppMessage[]
        statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>
      }
      field: string
    }>
  }>
}

export interface PatientRow {
  id: string
  phone_number: string
  name: string | null
  age: number | null
  gender: string | null
  location: string | null
  email: string | null
  consent_ndpr: boolean
  consent_date: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface ConversationRow {
  id: string
  patient_id: string
  message_type: string
  patient_message: string | null
  patient_message_redacted: string | null
  ai_response: string | null
  media_url: string | null
  sentiment: string | null
  has_emergency_keywords: boolean
  whatsapp_message_id: string | null
  transcription: string | null
  transcription_redacted: string | null
  created_at: string
}

export interface MessageQueueRow {
  id: string
  patient_id: string
  phone_number: string
  message_text: string | null
  message_type: string
  media_url: string | null
  media_mime_type: string | null
  whatsapp_message_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'dead_letter'
  retry_count: number
  last_error: string | null
  next_retry_at: string | null
  created_at: string
}

export interface BookingSessionRow {
  id: string
  patient_id: string
  status: 'active' | 'completed' | 'abandoned' | 'expired'
  current_step: number
  collected_name: string | null
  collected_sex: string | null
  collected_location: string | null
  collected_service_type: string | null
  collected_doctor_preference: string | null
  collected_date: string | null
  collected_time: string | null
  collected_center: string | null
  last_message_at: string
  completed_at: string | null
  created_at: string
}

export interface EmergencyAlertRow {
  id: string
  patient_id: string
  conversation_id: string | null
  alert_type: 'suicidal' | 'self_harm' | 'drug_overdose' | 'panic_attack' | null
  keywords_detected: string[] | null
  severity: 'critical' | 'high' | 'medium' | null
  alert_message: string | null
  whatsapp_notified_at: string | null
  email_notified_at: string | null
  sms_notified_at: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
  resolved_at: string | null
  response_notes: string | null
  dedup_key: string | null
  escalation_level: number
  escalated_to: string | null
  response_time_ms: number | null
  created_at: string
}

export interface AppointmentRow {
  id: string
  patient_id: string
  doctor_id: string | null
  appointment_date: string
  appointment_time: string | null
  center: string | null
  service_type: string | null
  reason: string | null
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  google_calendar_event_id: string | null
  reminder_1week_sent: boolean
  reminder_24h_sent: boolean
  created_at: string
}

// AI conversation message format
export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Emergency detection result
export interface EmergencyDetection {
  isEmergency: boolean
  alertType: EmergencyAlertRow['alert_type'] | null
  severity: EmergencyAlertRow['severity'] | null
  keywordsFound: string[]
  confidence: number
}

// Booking session steps
export const BOOKING_STEPS = {
  NAME: 0,
  SEX: 1,
  LOCATION: 2,
  SERVICE_TYPE: 3,
  DOCTOR: 4,
  DATE: 5,
  TIME: 6,
  CENTER: 7,
  CONFIRM: 8,
} as const

export type BookingStep = typeof BOOKING_STEPS[keyof typeof BOOKING_STEPS]

// WhatsApp template names (must match Meta-approved templates)
export const WA_TEMPLATES = {
  APPOINTMENT_REMINDER_1WEEK: 'appointment_reminder_1week',
  APPOINTMENT_REMINDER_24H: 'appointment_reminder_24h',
  APPOINTMENT_CONFIRMATION: 'appointment_confirmation',
  FEEDBACK_REQUEST: 'feedback_request',
  EMERGENCY_FOLLOW_UP: 'emergency_follow_up',
} as const
