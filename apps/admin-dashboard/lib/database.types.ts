// Auto-generated Supabase type definitions
// Run: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      patients: {
        Row: {
          id: string
          phone_number: string
          name: string | null
          age: number | null
          gender: string | null
          location: string | null
          email: string | null
          first_contact_date: string | null
          last_active_at: string | null
          consent_ndpr: boolean
          consent_date: string | null
          consent_proof: string | null
          is_archived: boolean
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['patients']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['patients']['Insert']>
      }
      doctors: {
        Row: {
          id: string
          name: string
          speciality: string | null
          bio: string | null
          phone: string | null
          email: string | null
          location: 'Galadimawa' | 'Galadinmawa' | 'Karu' | 'Both' | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['doctors']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['doctors']['Insert']>
      }
      conversations: {
        Row: {
          id: string
          patient_id: string
          message_queue_id: string | null
          message_type: string
          patient_message: string | null
          patient_message_redacted: string | null
          ai_response: string | null
          media_url: string | null
          media_mime_type: string | null
          transcription: string | null
          transcription_redacted: string | null
          transcription_confidence: number | null
          sentiment: 'positive' | 'neutral' | 'negative' | 'distressed' | 'crisis' | null
          has_emergency_keywords: boolean
          emergency_keywords_found: string[] | null
          whatsapp_message_id: string | null
          ai_response_sent: boolean
          ai_tokens_used: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['conversations']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['conversations']['Insert']>
      }
      appointments: {
        Row: {
          id: string
          patient_id: string
          doctor_id: string | null
          booking_session_id: string | null
          appointment_date: string
          appointment_time: string | null
          center: 'Galadimawa' | 'Galadinmawa' | 'Karu' | null
          service_type: string | null
          reason: string | null
          status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled'
          cancellation_reason: string | null
          google_calendar_event_id: string | null
          google_calendar_synced_at: string | null
          calendar_sync_status: string | null
          calendar_sync_error: string | null
          reminder_1week_sent: boolean
          reminder_1week_sent_at: string | null
          reminder_1week_status: string | null
          reminder_24h_sent: boolean
          reminder_24h_sent_at: string | null
          reminder_24h_status: string | null
          reminder_2h_sent: boolean
          reminder_2h_sent_at: string | null
          confirmation_sent: boolean
          confirmation_sent_at: string | null
          feedback_requested: boolean
          feedback_requested_at: string | null
          created_from_whatsapp: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['appointments']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['appointments']['Insert']>
      }
      emergency_alerts: {
        Row: {
          id: string
          patient_id: string
          conversation_id: string | null
          alert_type: 'self_harm' | 'suicidal' | 'drug_overdose' | 'panic_attack' | 'crisis' | 'other' | null
          keywords_detected: string[] | null
          alert_message: string | null
          severity: 'warning' | 'medium' | 'high' | 'critical'
          detection_confidence: number | null
          dedup_key: string | null
          alert_count: number
          whatsapp_notified_at: string | null
          email_notified_at: string | null
          sms_notified_at: string | null
          all_channels_notified: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          response_time_ms: number | null
          response_notes: string | null
          escalation_level: number
          escalated_to: string | null
          last_escalation_at: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['emergency_alerts']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['emergency_alerts']['Insert']>
      }
      admin_users: {
        Row: {
          id: string
          auth_user_id: string | null
          email: string
          name: string
          role: 'super_admin' | 'admin' | 'doctor' | 'nurse' | 'staff' | 'dpo'
          doctor_id: string | null
          is_active: boolean
          mfa_enabled: boolean
          last_login_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['admin_users']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['admin_users']['Insert']>
      }
      audit_log: {
        Row: {
          id: string
          admin_user_id: string | null
          action_type: string
          resource_type: string | null
          resource_id: string | null
          old_value: Json | null
          new_value: Json | null
          ip_address: string | null
          user_agent: string | null
          status: 'success' | 'failed' | 'denied'
          failure_reason: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['audit_log']['Row'], 'id' | 'created_at'>
        Update: never // Immutable
      }
      booking_sessions: {
        Row: {
          id: string
          patient_phone: string | null
          patient_id: string | null
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
          collected_email: string | null
          validation_errors: Json
          step_history: Json
          message_attempts: number
          last_message_at: string
          completed_at: string | null
          abandoned_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['booking_sessions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['booking_sessions']['Insert']>
      }
      message_queue: {
        Row: {
          id: string
          patient_phone: string | null
          patient_id: string | null
          phone_number: string | null
          message_text: string | null
          message_type: string
          whatsapp_message_id: string | null
          media_url: string | null
          media_mime_type: string | null
          raw_payload: Json | null
          status: 'queued' | 'processing' | 'completed' | 'failed' | 'dead_letter'
          retry_count: number
          last_error: string | null
          next_retry_at: string | null
          processed_at: string | null
          ai_response: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['message_queue']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['message_queue']['Insert']>
      }
      on_call_schedule: {
        Row: {
          id: string
          doctor_id: string
          start_date: string
          end_date: string
          is_primary: boolean
          contact_phone: string | null
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['on_call_schedule']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['on_call_schedule']['Insert']>
      }
      api_quotas: {
        Row: {
          id: string
          provider: string
          date: string
          call_count: number
          tokens_used: number
          minutes_processed: number
          cost_usd: number
          budget_usd: number
          budget_used: number
          daily_budget_limit: number | null
          alert_sent: boolean
        }
        Insert: Omit<Database['public']['Tables']['api_quotas']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['api_quotas']['Insert']>
      }
      appointment_feedback: {
        Row: {
          id: string
          appointment_id: string
          patient_id: string
          rating: number | null
          feedback_text: string | null
          would_recommend: boolean | null
          follow_up_needed: boolean | null
          follow_up_notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['appointment_feedback']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['appointment_feedback']['Insert']>
      }
      doctor_availability: {
        Row: {
          id: string
          doctor_id: string
          day_of_week: number | null
          specific_date: string | null
          start_time: string
          end_time: string
          is_recurring: boolean
          is_available: boolean
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['doctor_availability']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['doctor_availability']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: {
      get_admin_role: { Args: Record<string, never>; Returns: string }
      has_role: { Args: { allowed_roles: string[] }; Returns: boolean }
      generate_emergency_dedup_key: { Args: { p_patient_id: string; p_alert_type: string }; Returns: string }
    }
    Enums: Record<string, never>
  }
}
