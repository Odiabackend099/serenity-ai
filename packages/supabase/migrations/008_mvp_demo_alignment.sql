-- ============================================================
-- Migration 008: MVP Demo Schema Alignment
-- Aligns schema constraints with the deployed Edge Function code paths.
-- ============================================================

-- message_queue: current webhook/AI code uses patient_id + phone_number.
-- Keep patient_phone for backward compatibility with older queries/indexes.
ALTER TABLE message_queue
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;

ALTER TABLE message_queue
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);

UPDATE message_queue
SET phone_number = COALESCE(phone_number, patient_phone)
WHERE phone_number IS NULL;

ALTER TABLE message_queue
  ALTER COLUMN patient_phone DROP NOT NULL;

ALTER TABLE message_queue DROP CONSTRAINT IF EXISTS message_queue_message_type_check;
ALTER TABLE message_queue ADD CONSTRAINT message_queue_message_type_check
  CHECK (message_type IN ('text', 'voice', 'audio', 'image', 'video', 'document', 'sticker', 'location'));

CREATE INDEX IF NOT EXISTS idx_message_queue_patient_id ON message_queue(patient_id);
CREATE INDEX IF NOT EXISTS idx_message_queue_phone_number ON message_queue(phone_number);

-- booking_sessions: code uses active/expired/abandoned and has email/confirm steps.
ALTER TABLE booking_sessions DROP CONSTRAINT IF EXISTS booking_sessions_status_check;
UPDATE booking_sessions
SET status = CASE
  WHEN status = 'in_progress' THEN 'active'
  WHEN status = 'timed_out' THEN 'expired'
  ELSE status
END;
ALTER TABLE booking_sessions ADD CONSTRAINT booking_sessions_status_check
  CHECK (status IN ('active', 'expired', 'completed', 'abandoned'));

ALTER TABLE booking_sessions DROP CONSTRAINT IF EXISTS booking_sessions_current_step_check;
ALTER TABLE booking_sessions ADD CONSTRAINT booking_sessions_current_step_check
  CHECK (current_step BETWEEN 0 AND 9);

ALTER TABLE booking_sessions
  ALTER COLUMN status SET DEFAULT 'active';

-- centers: code and hospital materials use Galadimawa; older schema had Galadinmawa.
ALTER TABLE doctors DROP CONSTRAINT IF EXISTS doctors_location_check;
ALTER TABLE doctors ADD CONSTRAINT doctors_location_check
  CHECK (location IN ('Galadimawa', 'Galadinmawa', 'Karu', 'Both'));

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_center_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_center_check
  CHECK (center IN ('Galadimawa', 'Galadinmawa', 'Karu'));

-- appointments: allow the demo booking fallback service while keeping known service list.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_service_type_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_service_type_check
  CHECK (service_type IN (
    'Psychological Medicine and Psychiatry',
    'Drug Abuse Treatment and Rehabilitation',
    'Encephalography (EEG)',
    'Neurology',
    'Physiotherapy',
    'Consultancy Services',
    'General Medical Practice',
    'Dual Diagnosis',
    'Consultation'
  ));

-- emergency_alerts: code can represent high/medium risk and a level-4 manual escalation.
ALTER TABLE emergency_alerts DROP CONSTRAINT IF EXISTS emergency_alerts_severity_check;
ALTER TABLE emergency_alerts ADD CONSTRAINT emergency_alerts_severity_check
  CHECK (severity IN ('warning', 'medium', 'high', 'critical'));

ALTER TABLE emergency_alerts DROP CONSTRAINT IF EXISTS emergency_alerts_escalation_level_check;
ALTER TABLE emergency_alerts ADD CONSTRAINT emergency_alerts_escalation_level_check
  CHECK (escalation_level BETWEEN 1 AND 4);

-- api_quotas: current analytics/functions use budget_used + daily_budget_limit.
ALTER TABLE api_quotas
  ADD COLUMN IF NOT EXISTS budget_used DECIMAL(10,4) DEFAULT 0;

UPDATE api_quotas
SET budget_used = COALESCE(budget_used, cost_usd, 0);

ALTER TABLE api_quotas
  ADD COLUMN IF NOT EXISTS daily_budget_limit DECIMAL(10,4);

UPDATE api_quotas
SET daily_budget_limit = COALESCE(daily_budget_limit, budget_usd, 10);
