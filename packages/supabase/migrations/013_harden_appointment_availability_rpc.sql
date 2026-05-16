-- ============================================================
-- Migration 013: Harden appointment availability RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION create_appointment_slot_hold_with_lock(
  p_patient_id UUID,
  p_doctor_id UUID,
  p_booking_session_id UUID,
  p_appointment_date DATE,
  p_appointment_time TIME,
  p_duration_minutes INTEGER DEFAULT 60,
  p_hold_minutes INTEGER DEFAULT 10
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold_id UUID;
  v_requested_range TSRANGE;
BEGIN
  IF p_patient_id IS NULL
    OR p_doctor_id IS NULL
    OR p_booking_session_id IS NULL
    OR p_appointment_date IS NULL
    OR p_appointment_time IS NULL
  THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_doctor_id::TEXT || ':' || p_appointment_date::TEXT,
    0
  ));

  UPDATE appointment_slot_holds
  SET status = 'expired'
  WHERE doctor_id = p_doctor_id
    AND appointment_date = p_appointment_date
    AND status = 'active'
    AND expires_at <= NOW();

  UPDATE appointment_slot_holds
  SET status = 'released'
  WHERE booking_session_id = p_booking_session_id
    AND status = 'active';

  v_requested_range := tsrange(
    (p_appointment_date + p_appointment_time)::timestamp,
    (p_appointment_date + p_appointment_time + make_interval(mins => p_duration_minutes))::timestamp,
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

  IF EXISTS (
    SELECT 1
    FROM appointment_slot_holds h
    WHERE h.doctor_id = p_doctor_id
      AND h.appointment_date = p_appointment_date
      AND h.status = 'active'
      AND h.expires_at > NOW()
      AND h.booking_session_id IS DISTINCT FROM p_booking_session_id
      AND tsrange(
        (h.appointment_date + h.appointment_time)::timestamp,
        (h.appointment_date + h.appointment_time + make_interval(mins => h.duration_minutes))::timestamp,
        '[)'
      ) && v_requested_range
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO appointment_slot_holds (
    patient_id,
    booking_session_id,
    doctor_id,
    appointment_date,
    appointment_time,
    duration_minutes,
    status,
    expires_at
  )
  VALUES (
    p_patient_id,
    p_booking_session_id,
    p_doctor_id,
    p_appointment_date,
    p_appointment_time,
    p_duration_minutes,
    'active',
    NOW() + make_interval(mins => p_hold_minutes)
  )
  RETURNING id INTO v_hold_id;

  RETURN v_hold_id;
END;
$$;

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
SET search_path = public
AS $$
DECLARE
  v_appointment_id UUID;
  v_requested_range TSRANGE;
BEGIN
  IF p_doctor_id IS NOT NULL AND p_appointment_time IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_doctor_id::TEXT || ':' || p_appointment_date::TEXT,
      0
    ));

    UPDATE appointment_slot_holds
    SET status = 'expired'
    WHERE doctor_id = p_doctor_id
      AND appointment_date = p_appointment_date
      AND status = 'active'
      AND expires_at <= NOW();

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

CREATE OR REPLACE FUNCTION create_whatsapp_appointment_with_lock(
  p_patient_id UUID,
  p_doctor_id UUID,
  p_booking_session_id UUID,
  p_held_slot_id UUID,
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
SET search_path = public
AS $$
DECLARE
  v_appointment_id UUID;
  v_requested_range TSRANGE;
BEGIN
  IF p_patient_id IS NULL
    OR p_doctor_id IS NULL
    OR p_booking_session_id IS NULL
    OR p_held_slot_id IS NULL
    OR p_appointment_date IS NULL
    OR p_appointment_time IS NULL
  THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_doctor_id::TEXT || ':' || p_appointment_date::TEXT,
    0
  ));

  UPDATE appointment_slot_holds
  SET status = 'expired'
  WHERE doctor_id = p_doctor_id
    AND appointment_date = p_appointment_date
    AND status = 'active'
    AND expires_at <= NOW();

  v_requested_range := tsrange(
    (p_appointment_date + p_appointment_time)::timestamp,
    (p_appointment_date + p_appointment_time + INTERVAL '60 minutes')::timestamp,
    '[)'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM appointment_slot_holds h
    WHERE h.id = p_held_slot_id
      AND h.patient_id = p_patient_id
      AND h.booking_session_id = p_booking_session_id
      AND h.doctor_id = p_doctor_id
      AND h.appointment_date = p_appointment_date
      AND h.appointment_time = p_appointment_time
      AND h.status = 'active'
      AND h.expires_at > NOW()
  ) THEN
    RETURN NULL;
  END IF;

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

  IF EXISTS (
    SELECT 1
    FROM appointment_slot_holds h
    WHERE h.doctor_id = p_doctor_id
      AND h.appointment_date = p_appointment_date
      AND h.status = 'active'
      AND h.expires_at > NOW()
      AND h.id <> p_held_slot_id
      AND tsrange(
        (h.appointment_date + h.appointment_time)::timestamp,
        (h.appointment_date + h.appointment_time + make_interval(mins => h.duration_minutes))::timestamp,
        '[)'
      ) && v_requested_range
  ) THEN
    RETURN NULL;
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
  WHERE id = p_held_slot_id;

  RETURN v_appointment_id;
END;
$$;

REVOKE ALL ON FUNCTION create_appointment_slot_hold_with_lock(UUID, UUID, UUID, DATE, TIME, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_whatsapp_appointment_with_lock(UUID, UUID, UUID, DATE, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_whatsapp_appointment_with_lock(UUID, UUID, UUID, UUID, DATE, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_appointment_slot_hold_with_lock(UUID, UUID, UUID, DATE, TIME, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION create_whatsapp_appointment_with_lock(UUID, UUID, UUID, DATE, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION create_whatsapp_appointment_with_lock(UUID, UUID, UUID, UUID, DATE, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
