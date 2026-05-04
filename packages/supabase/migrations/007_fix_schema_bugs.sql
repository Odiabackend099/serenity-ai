-- ============================================================
-- Migration 007: Fix Schema Bugs + Add DB-Level Idempotency
-- ============================================================

-- Fix 1: booking_sessions status constraint
-- Problem: Migration 001 uses IN ('in_progress', 'timed_out')
-- but all code uses 'active' and 'expired'
-- This causes constraint violations on every booking
ALTER TABLE booking_sessions DROP CONSTRAINT IF EXISTS booking_sessions_status_check;
UPDATE booking_sessions
SET status = CASE
  WHEN status = 'in_progress' THEN 'active'
  WHEN status = 'timed_out' THEN 'expired'
  ELSE status
END;
ALTER TABLE booking_sessions ADD CONSTRAINT booking_sessions_status_check
  CHECK (status IN ('active', 'expired', 'completed', 'abandoned'));

-- Fix 2: DB-level unique constraint on whatsapp_message_id
-- Problem: Webhook idempotency check is non-atomic (SELECT then INSERT)
-- Under concurrent webhook retries, duplicates can slip through
-- DB unique constraint catches this at the source
CREATE UNIQUE INDEX IF NOT EXISTS message_queue_whatsapp_message_id_unique
  ON message_queue (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;
