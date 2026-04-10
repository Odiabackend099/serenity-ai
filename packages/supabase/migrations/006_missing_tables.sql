-- Migration 006: Missing tables referenced in Edge Functions
-- Run after 005_pgcron_jobs.sql

-- ── reminder_failures ─────────────────────────────────────────────────────────
-- Tracks failed reminder attempts for monitoring and retry
CREATE TABLE IF NOT EXISTS reminder_failures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  reminder_type  text NOT NULL CHECK (reminder_type IN ('24h', '1week', 'feedback')),
  channel        text NOT NULL DEFAULT 'whatsapp',
  error_message  text,
  attempted_at   timestamptz NOT NULL DEFAULT now(),
  retry_count    int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reminder_failures_appointment ON reminder_failures(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminder_failures_attempted ON reminder_failures(attempted_at DESC);

-- RLS: admin can read, service role can write
ALTER TABLE reminder_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read reminder_failures"
  ON reminder_failures FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role can insert reminder_failures"
  ON reminder_failures FOR INSERT
  TO service_role WITH CHECK (true);

-- ── notifications.sent_at column (if not already present) ────────────────────
-- Ensure sent_at exists on notifications table (some schema versions omit it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'sent_at'
  ) THEN
    ALTER TABLE notifications ADD COLUMN sent_at timestamptz;
  END IF;
END $$;

-- ── notifications.error_message column ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE notifications ADD COLUMN error_message text;
  END IF;
END $$;

-- ── appointments: ensure reminder column names match code ────────────────────
-- The code uses reminder_1week_sent and reminder_24h_sent
-- (Some versions may have reminder_sent_1week / reminder_sent_24h)
DO $$
BEGIN
  -- Add reminder_1week_sent if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'reminder_1week_sent'
  ) THEN
    ALTER TABLE appointments ADD COLUMN reminder_1week_sent boolean NOT NULL DEFAULT false;
  END IF;

  -- Add reminder_24h_sent if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'reminder_24h_sent'
  ) THEN
    ALTER TABLE appointments ADD COLUMN reminder_24h_sent boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ── emergency_alerts: ensure all columns used by code exist ──────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'response_time_ms'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN response_time_ms int;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'escalated_to'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN escalated_to text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'response_notes'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN response_notes text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'whatsapp_notified_at'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN whatsapp_notified_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'email_notified_at'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN email_notified_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'sms_notified_at'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN sms_notified_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emergency_alerts' AND column_name = 'alert_message'
  ) THEN
    ALTER TABLE emergency_alerts ADD COLUMN alert_message text;
  END IF;
END $$;

-- ── api_quotas: ensure daily_budget_limit column exists ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_quotas' AND column_name = 'daily_budget_limit'
  ) THEN
    ALTER TABLE api_quotas ADD COLUMN daily_budget_limit numeric(10, 4);
  END IF;
END $$;

-- ── patients: ensure is_archived column exists ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'is_archived'
  ) THEN
    ALTER TABLE patients ADD COLUMN is_archived boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ── conversations: ensure redacted columns exist ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'patient_message_redacted'
  ) THEN
    ALTER TABLE conversations ADD COLUMN patient_message_redacted text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'transcription_redacted'
  ) THEN
    ALTER TABLE conversations ADD COLUMN transcription_redacted text;
  END IF;
END $$;
