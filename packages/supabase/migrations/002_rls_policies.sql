-- ============================================================
-- SERENITY AI - Row Level Security Policies
-- ============================================================

-- Helper function to get current admin role
CREATE OR REPLACE FUNCTION get_admin_role()
RETURNS TEXT AS $$
  SELECT role FROM admin_users WHERE auth_user_id = auth.uid() AND is_active = TRUE LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Helper: check if current user has one of these roles
CREATE OR REPLACE FUNCTION has_role(allowed_roles TEXT[])
RETURNS BOOLEAN AS $$
  SELECT get_admin_role() = ANY(allowed_roles);
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ============================================================
-- PATIENTS
-- ============================================================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_patients" ON patients
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','nurse','staff','dpo']));

CREATE POLICY "admin_insert_patients" ON patients
  FOR INSERT WITH CHECK (has_role(ARRAY['super_admin','admin','staff']));

CREATE POLICY "admin_update_patients" ON patients
  FOR UPDATE USING (has_role(ARRAY['super_admin','admin','staff']));

CREATE POLICY "super_admin_delete_patients" ON patients
  FOR DELETE USING (has_role(ARRAY['super_admin']));

-- ============================================================
-- CONVERSATIONS (sensitive - limited by role)
-- ============================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Doctors see own patients' conversations; admins/staff see all
CREATE POLICY "view_conversations" ON conversations
  FOR SELECT USING (
    has_role(ARRAY['super_admin','admin','dpo']) OR
    (has_role(ARRAY['doctor']) AND patient_id IN (
      SELECT p.id FROM patients p
      JOIN appointments a ON a.patient_id = p.id
      JOIN admin_users au ON au.doctor_id = a.doctor_id
      WHERE au.auth_user_id = auth.uid()
    )) OR
    has_role(ARRAY['staff','nurse'])
  );

CREATE POLICY "no_modify_conversations" ON conversations
  FOR UPDATE USING (has_role(ARRAY['super_admin']));

CREATE POLICY "no_delete_conversations" ON conversations
  FOR DELETE USING (has_role(ARRAY['super_admin']));

-- ============================================================
-- APPOINTMENTS
-- ============================================================
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_appointments" ON appointments
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','nurse','staff','dpo']));

CREATE POLICY "staff_insert_appointments" ON appointments
  FOR INSERT WITH CHECK (has_role(ARRAY['super_admin','admin','staff']));

CREATE POLICY "staff_update_appointments" ON appointments
  FOR UPDATE USING (has_role(ARRAY['super_admin','admin','staff','doctor']));

-- ============================================================
-- EMERGENCY ALERTS
-- ============================================================
ALTER TABLE emergency_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_alerts" ON emergency_alerts
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','nurse','staff','dpo']));

CREATE POLICY "admin_update_alerts" ON emergency_alerts
  FOR UPDATE USING (has_role(ARRAY['super_admin','admin','doctor','nurse','staff']));

-- ============================================================
-- AUDIT LOG (immutable - only read, never modify)
-- ============================================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dpo_admin_view_audit" ON audit_log
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','dpo']));

-- Explicitly no UPDATE or DELETE policies = immutable

-- ============================================================
-- ADMIN USERS
-- ============================================================
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_own_profile" ON admin_users
  FOR SELECT USING (auth_user_id = auth.uid() OR has_role(ARRAY['super_admin','admin']));

CREATE POLICY "super_admin_manage_users" ON admin_users
  FOR ALL USING (has_role(ARRAY['super_admin']));

-- ============================================================
-- DOCTORS (all staff can view)
-- ============================================================
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_view_doctors" ON doctors
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','nurse','staff','dpo']));

CREATE POLICY "admin_manage_doctors" ON doctors
  FOR ALL USING (has_role(ARRAY['super_admin','admin']));

-- ============================================================
-- DOCTOR AVAILABILITY
-- ============================================================
ALTER TABLE doctor_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_availability" ON doctor_availability
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','nurse','staff']));

CREATE POLICY "admin_manage_availability" ON doctor_availability
  FOR ALL USING (has_role(ARRAY['super_admin','admin']));

-- ============================================================
-- ON-CALL SCHEDULE
-- ============================================================
ALTER TABLE on_call_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_oncall" ON on_call_schedule
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','nurse','staff']));

CREATE POLICY "admin_manage_oncall" ON on_call_schedule
  FOR ALL USING (has_role(ARRAY['super_admin','admin']));

-- ============================================================
-- BOOKING SESSIONS
-- ============================================================
ALTER TABLE booking_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_sessions" ON booking_sessions
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','staff']));

-- ============================================================
-- CONSENT LOG
-- ============================================================
ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dpo_admin_view_consent" ON consent_log
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','dpo']));

-- ============================================================
-- MESSAGE QUEUE (internal use - admin only)
-- ============================================================
ALTER TABLE message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_view_queue" ON message_queue
  FOR SELECT USING (has_role(ARRAY['super_admin','admin']));

-- ============================================================
-- API QUOTAS
-- ============================================================
ALTER TABLE api_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_view_quotas" ON api_quotas
  FOR SELECT USING (has_role(ARRAY['super_admin','admin']));

-- ============================================================
-- DELETION REQUESTS
-- ============================================================
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dpo_admin_view_deletions" ON deletion_requests
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','dpo']));

CREATE POLICY "dpo_admin_update_deletions" ON deletion_requests
  FOR UPDATE USING (has_role(ARRAY['super_admin','admin','dpo']));

-- ============================================================
-- APPOINTMENT FEEDBACK
-- ============================================================
ALTER TABLE appointment_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_view_feedback" ON appointment_feedback
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','staff']));

-- ============================================================
-- VOICE TRANSCRIPTIONS
-- ============================================================
ALTER TABLE voice_transcriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctor_admin_view_transcriptions" ON voice_transcriptions
  FOR SELECT USING (has_role(ARRAY['super_admin','admin','doctor','dpo']));
