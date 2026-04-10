-- ============================================================
-- SERENITY AI - Initial Schema
-- Serenity Royale Hospital, Abuja, Nigeria
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- DOCTORS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  speciality VARCHAR(255),
  bio TEXT,
  phone VARCHAR(20),
  email VARCHAR(255),
  location VARCHAR(50) CHECK (location IN ('Galadinmawa', 'Karu', 'Both')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DOCTOR AVAILABILITY TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  specific_date DATE, -- for one-off overrides
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_recurring BOOLEAN DEFAULT TRUE,
  is_available BOOLEAN DEFAULT TRUE, -- FALSE = blocked (vacation, leave)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ON-CALL SCHEDULE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS on_call_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_primary BOOLEAN DEFAULT TRUE, -- false = backup
  contact_phone VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PATIENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL, -- WhatsApp phone number (+234...)
  name VARCHAR(255),
  age SMALLINT CHECK (age > 0 AND age < 150),
  gender VARCHAR(30),
  location VARCHAR(255), -- "Within Abuja" or "Outside Abuja" or specific state
  email VARCHAR(255),
  first_contact_date TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  consent_ndpr BOOLEAN DEFAULT FALSE,
  consent_date TIMESTAMPTZ,
  consent_proof TEXT, -- patient's "I agree" WhatsApp message stored as proof
  is_archived BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ, -- soft delete
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PATIENT INTAKE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS patient_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  what_feeling TEXT,
  duration_description TEXT, -- "2 weeks", "3 months"
  emergency_risk_level VARCHAR(20) DEFAULT 'low' CHECK (emergency_risk_level IN ('low', 'medium', 'high', 'critical')),
  intake_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MESSAGE QUEUE TABLE (async processing - BLOCKER 1 fix)
-- ============================================================
CREATE TABLE IF NOT EXISTS message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_phone VARCHAR(20) NOT NULL,
  message_text TEXT,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'voice', 'image', 'video', 'document', 'sticker')),
  whatsapp_message_id VARCHAR(255) UNIQUE, -- for idempotency
  media_url TEXT,
  media_mime_type VARCHAR(100),
  raw_payload JSONB, -- full WhatsApp webhook payload
  status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')),
  retry_count SMALLINT DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  ai_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CONVERSATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  message_queue_id UUID REFERENCES message_queue(id) ON DELETE SET NULL,
  message_type VARCHAR(20) DEFAULT 'text',
  patient_message TEXT,
  patient_message_redacted TEXT, -- PII-redacted version for display
  ai_response TEXT,
  media_url TEXT,
  media_mime_type VARCHAR(100),
  transcription TEXT, -- for voice notes
  transcription_redacted TEXT,
  transcription_confidence DECIMAL(4,3),
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive', 'neutral', 'negative', 'distressed', 'crisis')),
  has_emergency_keywords BOOLEAN DEFAULT FALSE,
  emergency_keywords_found TEXT[], -- array of detected keywords
  whatsapp_message_id VARCHAR(255),
  ai_response_sent BOOLEAN DEFAULT FALSE,
  ai_tokens_used INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BOOKING SESSIONS TABLE (state machine - BLOCKER 3 fix)
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_phone VARCHAR(20) NOT NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned', 'timed_out')),
  current_step SMALLINT DEFAULT 0 CHECK (current_step BETWEEN 0 AND 7),
  -- Step 0=name, 1=sex, 2=location, 3=service_type, 4=doctor, 5=date, 6=time, 7=center
  collected_name VARCHAR(255),
  collected_sex VARCHAR(30),
  collected_location VARCHAR(255),
  collected_service_type VARCHAR(100),
  collected_doctor_preference VARCHAR(255),
  collected_date DATE,
  collected_time TIME,
  collected_center VARCHAR(50),
  validation_errors JSONB DEFAULT '{}'::JSONB,
  step_history JSONB DEFAULT '[]'::JSONB,
  message_attempts SMALLINT DEFAULT 0,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- APPOINTMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
  booking_session_id UUID REFERENCES booking_sessions(id) ON DELETE SET NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME,
  center VARCHAR(50) CHECK (center IN ('Galadinmawa', 'Karu')),
  service_type VARCHAR(100) CHECK (service_type IN (
    'Psychological Medicine and Psychiatry',
    'Drug Abuse Treatment and Rehabilitation',
    'Encephalography (EEG)',
    'Neurology',
    'Physiotherapy',
    'Consultancy Services',
    'General Medical Practice',
    'Dual Diagnosis'
  )),
  reason TEXT,
  status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  cancellation_reason TEXT,
  google_calendar_event_id VARCHAR(500),
  google_calendar_synced_at TIMESTAMPTZ,
  -- Reminder tracking
  reminder_1week_sent BOOLEAN DEFAULT FALSE,
  reminder_1week_sent_at TIMESTAMPTZ,
  reminder_1week_status VARCHAR(20),
  reminder_24h_sent BOOLEAN DEFAULT FALSE,
  reminder_24h_sent_at TIMESTAMPTZ,
  reminder_24h_status VARCHAR(20),
  reminder_2h_sent BOOLEAN DEFAULT FALSE,
  reminder_2h_sent_at TIMESTAMPTZ,
  -- Confirmation
  confirmation_sent BOOLEAN DEFAULT FALSE,
  confirmation_sent_at TIMESTAMPTZ,
  -- Feedback
  feedback_requested BOOLEAN DEFAULT FALSE,
  feedback_requested_at TIMESTAMPTZ,
  created_from_whatsapp BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EMERGENCY ALERTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS emergency_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  alert_type VARCHAR(50) CHECK (alert_type IN ('self_harm', 'suicidal', 'drug_overdose', 'panic_attack', 'crisis', 'other')),
  keywords_detected TEXT[],
  alert_message TEXT,
  severity VARCHAR(20) DEFAULT 'critical' CHECK (severity IN ('warning', 'critical')),
  detection_confidence DECIMAL(4,3), -- 0.0 to 1.0
  -- Deduplication (BLOCKER fix)
  dedup_key VARCHAR(255) UNIQUE, -- patient_id + alert_type + 10min_window
  alert_count SMALLINT DEFAULT 1, -- incremented on duplicate suppression
  -- Notification tracking
  whatsapp_notified_at TIMESTAMPTZ,
  email_notified_at TIMESTAMPTZ,
  sms_notified_at TIMESTAMPTZ,
  all_channels_notified BOOLEAN DEFAULT FALSE,
  -- Acknowledgment (senior engineer fix)
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID, -- references admin_users
  response_time_ms INTEGER,
  response_notes TEXT,
  -- Escalation tracking (5min/10min/15min cascade)
  escalation_level SMALLINT DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 3),
  escalated_to VARCHAR(255), -- name of who received escalation
  last_escalation_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  emergency_alert_id UUID REFERENCES emergency_alerts(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) CHECK (notification_type IN (
    'appointment_confirmation', 'appointment_reminder_1week',
    'appointment_reminder_24h', 'appointment_reminder_2h',
    'emergency_alert', 'feedback_request', 'consent_request',
    'data_export_ready', 'account_deleted'
  )),
  channel VARCHAR(20) CHECK (channel IN ('whatsapp', 'sms', 'email')),
  template_name VARCHAR(100), -- WhatsApp template name used
  message_content TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  external_message_id VARCHAR(255), -- WhatsApp/Twilio message ID
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- APPOINTMENT FEEDBACK TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS appointment_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  feedback_text TEXT,
  would_recommend BOOLEAN,
  follow_up_needed BOOLEAN,
  follow_up_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VOICE TRANSCRIPTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  audio_file_path VARCHAR(500),
  original_transcript TEXT NOT NULL,
  redacted_transcript TEXT,
  is_redacted BOOLEAN DEFAULT TRUE,
  confidence DECIMAL(4,3),
  duration_seconds INTEGER,
  language_detected VARCHAR(20),
  cost_usd DECIMAL(10,6),
  deepgram_request_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ADMIN USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE, -- links to Supabase Auth
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'staff' CHECK (role IN ('super_admin', 'admin', 'doctor', 'nurse', 'staff', 'dpo')),
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL, -- if this admin is also a doctor
  is_active BOOLEAN DEFAULT TRUE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG TABLE (NDPR compliance)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action_type VARCHAR(100) NOT NULL,
  -- e.g., READ_PATIENT, UPDATE_APPOINTMENT, DELETE_PATIENT, SEND_ALERT, LOGIN, LOGOUT
  resource_type VARCHAR(50),
  resource_id UUID,
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  status VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'failed', 'denied')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
  -- NOTE: No UPDATE/DELETE allowed on this table (enforced via RLS)
);

-- ============================================================
-- CONSENT LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS consent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consent_type VARCHAR(50) CHECK (consent_type IN ('ndpr_data_processing', 'marketing', 'research', 'withdrawal')),
  consent_given BOOLEAN NOT NULL,
  consent_text TEXT, -- the actual consent message shown to patient
  patient_response TEXT, -- patient's exact "I agree" message
  channel VARCHAR(20) DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DELETION REQUESTS TABLE (NDPR Right to Erasure)
-- ============================================================
CREATE TABLE IF NOT EXISTS deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  request_type VARCHAR(30) CHECK (request_type IN ('full_deletion', 'data_export', 'partial_deletion')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  rejection_reason TEXT,
  processed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL
);

-- ============================================================
-- API QUOTAS TABLE (cost tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('nvidia', 'deepgram', 'whatsapp', 'twilio', 'google_calendar', 'sendgrid')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  call_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  minutes_processed DECIMAL(10,2) DEFAULT 0, -- for Deepgram
  cost_usd DECIMAL(10,4) DEFAULT 0,
  budget_usd DECIMAL(10,4) DEFAULT 10, -- daily budget limit
  alert_sent BOOLEAN DEFAULT FALSE,
  UNIQUE(provider, date)
);

-- ============================================================
-- REMINDER FAILURES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS reminder_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  reminder_type VARCHAR(20) CHECK (reminder_type IN ('1week', '24h', '2h', 'confirmation', 'feedback')),
  channel VARCHAR(20),
  error_message TEXT,
  retry_count SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
