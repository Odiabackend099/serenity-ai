-- ============================================================
-- Migration: Security linter hardening
-- Enables RLS on exposed public tables flagged by Supabase linter
-- and locks down public execution of helper functions that should
-- only run internally/triggers/service-role.
-- ============================================================

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'patient_intake',
    'notifications',
    'patient_requests',
    'messages',
    'patient_consent',
    'follow_ups',
    'reminder_failures'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END $$;

-- Staff/admin read access. No anon policies are created.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'patient_intake',
    'notifications',
    'patient_requests',
    'messages',
    'patient_consent',
    'follow_ups',
    'reminder_failures'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      policy_name := table_name || '_staff_select';
      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = table_name
          AND policyname = policy_name
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_role(ARRAY[''super_admin'',''admin'',''doctor'',''nurse'',''staff'',''dpo'']))',
          policy_name,
          table_name
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Staff/admin write access for legacy operational tables, if present.
-- Edge Functions use service-role and bypass RLS, so this is mainly for
-- authenticated dashboard workflows.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'patient_intake',
    'patient_requests',
    'messages',
    'patient_consent',
    'follow_ups'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      policy_name := table_name || '_staff_insert';
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = table_name AND policyname = policy_name
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_role(ARRAY[''super_admin'',''admin'',''staff'']))',
          policy_name,
          table_name
        );
      END IF;

      policy_name := table_name || '_staff_update';
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = table_name AND policyname = policy_name
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_role(ARRAY[''super_admin'',''admin'',''staff''])) WITH CHECK (public.has_role(ARRAY[''super_admin'',''admin'',''staff'']))',
          policy_name,
          table_name
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Search-path hardening for public functions flagged by the linter.
-- Keep public.has_role/get_admin_role executable by authenticated users because
-- dashboard RLS policies depend on them.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.exec(text)',
    'public.upsert_patient(text)',
    'public.update_updated_at()',
    'public.update_updated_at_column()',
    'public.get_admin_role()',
    'public.has_role(text[])',
    'public.log_data_change()',
    'public.expire_stale_booking_sessions()',
    'public.generate_emergency_dedup_key(uuid,text)',
    'public.process_deletion_requests()'
  ]
  LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
    END IF;
  END LOOP;
END $$;

-- Public RPC hardening. These are not intended for anon/authenticated API calls.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.exec(text)',
    'public.upsert_patient(text)',
    'public.update_updated_at()',
    'public.update_updated_at_column()',
    'public.log_data_change()',
    'public.expire_stale_booking_sessions()',
    'public.generate_emergency_dedup_key(uuid,text)',
    'public.process_deletion_requests()'
  ]
  LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', fn);
    END IF;
  END LOOP;
END $$;

-- Authenticated staff still need these RLS helper functions.
DO $$
BEGIN
  IF to_regprocedure('public.get_admin_role()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_admin_role() FROM anon;
    GRANT EXECUTE ON FUNCTION public.get_admin_role() TO authenticated;
  END IF;

  IF to_regprocedure('public.has_role(text[])') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM anon;
    GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated;
  END IF;
END $$;
