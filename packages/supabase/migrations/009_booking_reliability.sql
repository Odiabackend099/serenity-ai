-- ============================================================
-- Migration 009: MVP Booking Reliability
-- Prevent double-booked doctor slots for non-cancelled appointments.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_doctor_slot_active_unique
  ON appointments (doctor_id, appointment_date, appointment_time)
  WHERE doctor_id IS NOT NULL
    AND appointment_time IS NOT NULL
    AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appointments_created_from_whatsapp
  ON appointments (created_from_whatsapp, created_at DESC);
