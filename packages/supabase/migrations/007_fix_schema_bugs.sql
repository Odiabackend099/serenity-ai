-- ============================================================
-- Migration 007: Fix Schema Bugs + Add DB-Level Idempotency
-- ============================================================

-- Fix 1: booking_sessions status constraint
-- Problem: Migration 001 uses IN ('in_progress', 'timed_out')
-- but all code uses 'active' and 'expired'
-- This causes constraint violations on every booking
ALTER TABLE booking_sessions DROP CONSTRAINT IF EXISTS booking_sessions_status_check;
ALTER TABLE booking_sessions ADD CONSTRAINT booking_sessions_status_check
  CHECK (status IN ('active', 'expired', 'completed'));

-- Fix 2: DB-level unique constraint on whatsapp_message_id
-- Problem: Webhook idempotency check is non-atomic (SELECT then INSERT)
-- Under concurrent webhook retries, duplicates can slip through
-- DB unique constraint catches this at the source
ALTER TABLE message_queue
ADD CONSTRAINT message_queue_whatsapp_message_id_unique
  UNIQUE (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
