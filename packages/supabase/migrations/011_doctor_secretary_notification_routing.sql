-- ============================================================
-- Migration 011: Doctor + secretary notification routing
-- ============================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(50),
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(30);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_recipient_role_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_recipient_role_check
  CHECK (
    recipient_role IS NULL OR recipient_role IN (
      'primary_doctor',
      'operations_manager',
      'assigned_doctor',
      'patient',
      'staff_email',
      'on_call_backup'
    )
  );

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role
  ON notifications (recipient_role, created_at DESC);

UPDATE doctors
SET name = 'Dr. Adekunle Adesina',
    phone = '+2348062197384',
    location = 'Both',
    is_active = TRUE
WHERE lower(name) IN ('dr. kunle adesina', 'dr kunle adesina', 'dr. adekunle adesina', 'dr adekunle adesina');

INSERT INTO doctors (name, speciality, bio, phone, email, location, is_active)
SELECT name, speciality, bio, phone, email, location, is_active
FROM (VALUES
  (
    'Dr. Adekunle Adesina',
    'Psychological Medicine & Psychiatry',
    'Primary clinical oversight contact for Serenity AI. Specialist in psychological medicine, psychiatry, and addiction treatment.',
    '+2348062197384',
    'info@serenityroyalehospital.com',
    'Both',
    TRUE
  ),
  (
    'Dr. Olaleye Abiola',
    'Psychological Medicine & Psychiatry',
    'Galadimawa clinical team.',
    '+2348083129916',
    NULL,
    'Galadimawa',
    TRUE
  ),
  (
    'Dr. Grace Ikeh',
    'Psychological Medicine & Psychiatry',
    'Galadimawa clinical team.',
    '+2349137565087',
    NULL,
    'Galadimawa',
    TRUE
  ),
  (
    'Dr. Julson Jeles',
    'Psychological Medicine & Psychiatry',
    'Galadimawa clinical team.',
    '+2348164453307',
    NULL,
    'Galadimawa',
    TRUE
  ),
  (
    'Dr. Nnajiofor Osondu',
    'Psychological Medicine & Psychiatry',
    'Karu clinical team.',
    '+2348032706384',
    NULL,
    'Karu',
    TRUE
  )
) AS incoming(name, speciality, bio, phone, email, location, is_active)
WHERE NOT EXISTS (
  SELECT 1
  FROM doctors d
  WHERE lower(regexp_replace(d.name, '[^a-z0-9]+', '', 'g')) = lower(regexp_replace(incoming.name, '[^a-z0-9]+', '', 'g'))
);
