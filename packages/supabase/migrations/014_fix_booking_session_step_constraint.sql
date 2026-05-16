-- Ensure booking_sessions can advance through the full WhatsApp booking flow,
-- including the final confirmation step.

ALTER TABLE booking_sessions
  DROP CONSTRAINT IF EXISTS booking_sessions_current_step_check;

ALTER TABLE booking_sessions
  ADD CONSTRAINT booking_sessions_current_step_check
  CHECK (current_step BETWEEN 0 AND 9);
