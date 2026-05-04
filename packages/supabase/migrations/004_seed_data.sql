-- ============================================================
-- SERENITY AI - Seed Data
-- Serenity Royale Hospital, Abuja, Nigeria
-- ============================================================

-- ============================================================
-- DOCTORS
-- ============================================================
INSERT INTO doctors (name, speciality, bio, phone, email, location, is_active)
VALUES
  (
    'Dr. Kunle Adesina',
    'Psychological Medicine & Psychiatry',
    'Managing Director of Serenity Royale Hospital. Specialist in psychological medicine, psychiatry, and addiction treatment. Dedicated to transforming lives through evidence-based, compassionate care.',
    '+2348062197384',
    'info@serenityroyalehospital.com',
    'Both',
    TRUE
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DR. ADESINA DEFAULT AVAILABILITY
-- Monday-Friday 8am-4pm (outpatient hours)
-- ============================================================
INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, is_recurring, is_available, notes)
SELECT
  d.id,
  day_num,
  '08:00:00'::TIME,
  '16:00:00'::TIME,
  TRUE,
  TRUE,
  'Regular outpatient hours'
FROM doctors d,
  UNNEST(ARRAY[1,2,3,4,5,6]) AS day_num  -- Mon=1 through Sat=6
WHERE d.name = 'Dr. Kunle Adesina';

-- Sunday closed for outpatient
INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time, is_recurring, is_available, notes)
SELECT
  d.id,
  0,  -- Sunday
  '00:00:00'::TIME,
  '23:59:00'::TIME,
  TRUE,
  FALSE,
  'Closed on Sundays for outpatient (Emergency only 24/7)'
FROM doctors d
WHERE d.name = 'Dr. Kunle Adesina';

-- ============================================================
-- DEFAULT ON-CALL (Dr. Adesina as primary)
-- ============================================================
INSERT INTO on_call_schedule (doctor_id, start_date, end_date, is_primary, contact_phone, notes)
SELECT
  d.id,
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '365 days',
  TRUE,
  '+2348062197384',
  'Primary on-call. Secondary: +2348116891990'
FROM doctors d
WHERE d.name = 'Dr. Kunle Adesina';

-- ============================================================
-- INITIAL API QUOTAS (daily budget defaults)
-- ============================================================
INSERT INTO api_quotas (provider, date, call_count, cost_usd, budget_usd)
VALUES
  ('groq', CURRENT_DATE, 0, 0, 10),
  ('deepgram', CURRENT_DATE, 0, 0, 5),
  ('whatsapp', CURRENT_DATE, 0, 0, 20),
  ('twilio', CURRENT_DATE, 0, 0, 5),
  ('google_calendar', CURRENT_DATE, 0, 0, 1)
ON CONFLICT (provider, date) DO NOTHING;

-- ============================================================
-- NOTES FOR MANUAL STEPS
-- ============================================================
-- After running migrations, in Supabase dashboard:
-- 1. Enable pg_cron extension
-- 2. Enable pg_net extension (for HTTP calls from cron)
-- 3. Run the pg_cron schedule commands in 003_indexes_triggers.sql (uncomment them)
-- 4. Create Supabase Storage bucket: 'media' (for voice notes, images)
-- 5. Set Storage bucket to private (not public)
-- 6. Enable Realtime for: emergency_alerts, conversations, appointments tables
