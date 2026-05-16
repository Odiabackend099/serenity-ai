-- ============================================================
-- Migration 012: Appointment availability holds and atomic booking
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE booking_sessions
  ADD COLUMN IF NOT EXISTS availability_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS availability_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS availability_doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS availability_alternatives JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS held_slot_id UUID;

CREATE TABLE IF NOT EXISTS appointment_slot_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  booking_session_id UUID REFERENCES booking_sessions(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0 AND duration_minutes <= 240),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'expired', 'released')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE booking_sessions
  DROP CONSTRAINT IF EXISTS booking_sessions_held_slot_id_fkey;

ALTER TABLE booking_sessions
  ADD CONSTRAINT booking_sessions_held_slot_id_fkey
  FOREIGN KEY (held_slot_id) REFERENCES appointment_slot_holds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointment_slot_holds_active_lookup
  ON appointment_slot_holds (doctor_id, appointment_date, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_appointment_slot_holds_booking_session
  ON appointment_slot_holds (booking_session_id, status);

DROP TRIGGER IF EXISTS set_updated_at_appointment_slot_holds ON appointment_slot_holds;
CREATE TRIGGER set_updated_at_appointment_slot_holds BEFORE UPDATE ON appointment_slot_holds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP INDEX IF EXISTS idx_appointments_doctor_slot_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_doctor_slot_active_unique
  ON appointments (doctor_id, appointment_date, appointment_time)
  WHERE doctor_id IS NOT NULL
    AND appointment_time IS NOT NULL
    AND status NOT IN ('cancelled', 'no_show');

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_doctor_slot_no_overlap;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_doctor_slot_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tsrange(
      (appointment_date + appointment_time)::timestamp,
      (appointment_date + appointment_time + INTERVAL '60 minutes')::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (
    doctor_id IS NOT NULL
    AND appointment_time IS NOT NULL
    AND status NOT IN ('cancelled', 'no_show')
  );

CREATE OR REPLACE FUNCTION create_whatsapp_appointment_with_lock(
  p_patient_id UUID,
  p_doctor_id UUID,
  p_booking_session_id UUID,
  p_appointment_date DATE,
  p_appointment_time TIME,
  p_center TEXT,
  p_service_type TEXT,
  p_reason TEXT,
  p_status TEXT DEFAULT 'pending',
  p_calendar_sync_status TEXT DEFAULT NULL,
  p_calendar_sync_error TEXT DEFAULT NULL,
  p_created_from_whatsapp BOOLEAN DEFAULT TRUE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_appointment_id UUID;
  v_requested_range TSRANGE;
BEGIN
  IF p_doctor_id IS NOT NULL AND p_appointment_time IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_doctor_id::TEXT || ':' || p_appointment_date::TEXT || ':' || p_appointment_time::TEXT,
      0
    ));

    v_requested_range := tsrange(
      (p_appointment_date + p_appointment_time)::timestamp,
      (p_appointment_date + p_appointment_time + INTERVAL '60 minutes')::timestamp,
      '[)'
    );

    IF EXISTS (
      SELECT 1
      FROM appointments a
      WHERE a.doctor_id = p_doctor_id
        AND a.appointment_date = p_appointment_date
        AND a.appointment_time IS NOT NULL
        AND a.status NOT IN ('cancelled', 'no_show')
        AND tsrange(
          (a.appointment_date + a.appointment_time)::timestamp,
          (a.appointment_date + a.appointment_time + INTERVAL '60 minutes')::timestamp,
          '[)'
        ) && v_requested_range
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO appointments (
    patient_id,
    doctor_id,
    booking_session_id,
    appointment_date,
    appointment_time,
    center,
    service_type,
    reason,
    status,
    calendar_sync_status,
    calendar_sync_error,
    confirmation_sent,
    created_from_whatsapp
  )
  VALUES (
    p_patient_id,
    p_doctor_id,
    p_booking_session_id,
    p_appointment_date,
    p_appointment_time,
    p_center,
    p_service_type,
    p_reason,
    p_status,
    p_calendar_sync_status,
    p_calendar_sync_error,
    FALSE,
    p_created_from_whatsapp
  )
  RETURNING id INTO v_appointment_id;

  UPDATE appointment_slot_holds
  SET status = 'consumed'
  WHERE booking_session_id = p_booking_session_id
    AND doctor_id = p_doctor_id
    AND appointment_date = p_appointment_date
    AND appointment_time = p_appointment_time
    AND status = 'active';

  RETURN v_appointment_id;
END;
$$;
