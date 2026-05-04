-- ============================================================
-- Migration 010: Staff notifications, calendar sync visibility, Groq provider
-- ============================================================

ALTER TABLE booking_sessions
  ADD COLUMN IF NOT EXISTS collected_email VARCHAR(255);

ALTER TABLE booking_sessions DROP CONSTRAINT IF EXISTS booking_sessions_current_step_check;
ALTER TABLE booking_sessions ADD CONSTRAINT booking_sessions_current_step_check
  CHECK (current_step BETWEEN 0 AND 9);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calendar_sync_status VARCHAR(80),
  ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN (
    'appointment_confirmation', 'appointment_reminder_1week',
    'appointment_reminder_24h', 'appointment_reminder_2h',
    'appointment_request_received', 'staff_booking_alert',
    'emergency_alert', 'feedback_request', 'consent_request',
    'data_export_ready', 'account_deleted'
  ));

ALTER TABLE api_quotas DROP CONSTRAINT IF EXISTS api_quotas_provider_check;
DELETE FROM api_quotas old_nvidia
WHERE old_nvidia.provider = 'nvidia'
  AND EXISTS (
    SELECT 1
    FROM api_quotas existing_groq
    WHERE existing_groq.provider = 'groq'
      AND existing_groq.date = old_nvidia.date
  );

UPDATE api_quotas
SET provider = 'groq'
WHERE provider = 'nvidia';

ALTER TABLE api_quotas ADD CONSTRAINT api_quotas_provider_check
  CHECK (provider IN ('groq', 'deepgram', 'whatsapp', 'twilio', 'google_calendar', 'sendgrid'));

INSERT INTO api_quotas (provider, date, call_count, cost_usd, budget_usd, budget_used, daily_budget_limit)
VALUES ('groq', CURRENT_DATE, 0, 0, 10, 0, 10)
ON CONFLICT (provider, date) DO NOTHING;
