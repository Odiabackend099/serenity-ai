-- ============================================================
-- MIGRATION 005: pg_cron + pg_net scheduled jobs
-- Run this AFTER deploying all Edge Functions to Supabase
-- Requires: pg_cron and pg_net extensions enabled in Supabase dashboard
--           (Dashboard → Database → Extensions → search pg_cron / pg_net)
-- ============================================================

-- Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- HELPER: read the Supabase service role key from vault
-- Store it once with:
--   SELECT vault.create_secret('supabase-service-key', '<your-service-role-key>', 'Supabase service role key for Edge Function calls');
-- ============================================================

-- ============================================================
-- JOB 1: Process message queue every 1 minute
-- (Picks up queued WhatsApp messages and runs AI responses)
-- Note: pg_cron minimum is 1 minute; for near-realtime use
--       Supabase Realtime triggers or set up a Replit/Render cron
-- ============================================================
SELECT cron.schedule(
  'process-message-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM vault.decrypted_secrets WHERE name = 'supabase-url') || '/functions/v1/ai-assistant',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase-service-key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ============================================================
-- JOB 2: Send appointment reminders daily at 9am WAT (8am UTC)
-- (1-week reminders + 24h reminders + feedback requests + MD daily list)
-- ============================================================
SELECT cron.schedule(
  'appointment-reminders-daily',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM vault.decrypted_secrets WHERE name = 'supabase-url') || '/functions/v1/appointment-reminder',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase-service-key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ============================================================
-- JOB 3: Check and escalate unacknowledged emergency alerts
-- Runs every 5 minutes to catch alerts that need escalation
-- ============================================================
SELECT cron.schedule(
  'escalation-check',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM vault.decrypted_secrets WHERE name = 'supabase-url') || '/functions/v1/escalation-check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase-service-key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ============================================================
-- JOB 4: Expire stale booking sessions (30-min timeout)
-- ============================================================
SELECT cron.schedule(
  'expire-booking-sessions',
  '*/10 * * * *',
  $$
  UPDATE booking_sessions
  SET status = 'expired'
  WHERE status = 'active'
    AND last_message_at < NOW() - INTERVAL '30 minutes';
  $$
);

-- ============================================================
-- JOB 5: Process pending deletion requests (NDPR compliance)
-- Runs daily at midnight WAT (23:00 UTC)
-- Hard-deletes patient data 30 days after soft-delete request
-- ============================================================
SELECT cron.schedule(
  'process-deletion-requests',
  '0 23 * * *',
  $$
  -- Hard delete patients where deletion was requested >30 days ago
  DELETE FROM patients
  WHERE id IN (
    SELECT patient_id FROM deletion_requests
    WHERE status = 'pending'
      AND requested_at < NOW() - INTERVAL '30 days'
  );

  -- Mark those requests as processed
  UPDATE deletion_requests
  SET status = 'completed', processed_at = NOW()
  WHERE status = 'pending'
    AND requested_at < NOW() - INTERVAL '30 days';
  $$
);

-- ============================================================
-- SETUP INSTRUCTIONS (run manually after migration):
--
-- 1. Enable extensions in Supabase Dashboard:
--    Database → Extensions → Enable pg_cron and pg_net
--
-- 2. Store secrets in Supabase Vault:
--    SELECT vault.create_secret(
--      'supabase-url',
--      'https://YOUR_PROJECT_REF.supabase.co',
--      'Supabase project URL'
--    );
--    SELECT vault.create_secret(
--      'supabase-service-key',
--      'YOUR_SERVICE_ROLE_KEY',
--      'Supabase service role key for Edge Function calls'
--    );
--
-- 3. Verify jobs are scheduled:
--    SELECT jobname, schedule, command FROM cron.job;
--
-- 4. Monitor job runs:
--    SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- 5. To remove a job:
--    SELECT cron.unschedule('job-name-here');
-- ============================================================
