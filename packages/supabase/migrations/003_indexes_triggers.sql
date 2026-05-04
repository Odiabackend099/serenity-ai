-- ============================================================
-- SERENITY AI - Indexes & Triggers
-- ============================================================

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

-- Patients
CREATE INDEX idx_patients_phone ON patients(phone_number);
CREATE INDEX idx_patients_created_at ON patients(created_at DESC);
CREATE INDEX idx_patients_last_active ON patients(last_active_at DESC);

-- Conversations
CREATE INDEX idx_conversations_patient_id ON conversations(patient_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX idx_conversations_has_emergency ON conversations(has_emergency_keywords) WHERE has_emergency_keywords = TRUE;

-- Appointments
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor_id ON appointments(doctor_id);
CREATE INDEX idx_appointments_date ON appointments(appointment_date);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_reminder_24h ON appointments(reminder_24h_sent, appointment_date) WHERE reminder_24h_sent = FALSE;
CREATE INDEX idx_appointments_reminder_1week ON appointments(reminder_1week_sent, appointment_date) WHERE reminder_1week_sent = FALSE;
CREATE INDEX idx_appointments_feedback ON appointments(feedback_requested, appointment_date) WHERE feedback_requested = FALSE;

-- Emergency Alerts
CREATE INDEX idx_emergency_patient_id ON emergency_alerts(patient_id);
CREATE INDEX idx_emergency_created_at ON emergency_alerts(created_at DESC);
CREATE INDEX idx_emergency_unresolved ON emergency_alerts(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_emergency_dedup ON emergency_alerts(dedup_key);

-- Message Queue
CREATE INDEX idx_message_queue_status ON message_queue(status, created_at) WHERE status IN ('queued', 'failed');
CREATE INDEX idx_message_queue_phone ON message_queue(patient_phone);
CREATE INDEX idx_message_queue_next_retry ON message_queue(next_retry_at) WHERE status = 'failed';
CREATE UNIQUE INDEX idx_message_queue_whatsapp_id ON message_queue(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

-- Booking Sessions
CREATE INDEX idx_booking_sessions_phone ON booking_sessions(patient_phone);
CREATE INDEX idx_booking_sessions_status ON booking_sessions(status) WHERE status = 'active';

-- Audit Log
CREATE INDEX idx_audit_log_user ON audit_log(admin_user_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action_type, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- Doctor Availability
CREATE INDEX idx_doctor_avail_doctor_day ON doctor_availability(doctor_id, day_of_week);
CREATE INDEX idx_doctor_avail_specific_date ON doctor_availability(specific_date) WHERE specific_date IS NOT NULL;

-- API Quotas
CREATE INDEX idx_api_quotas_provider_date ON api_quotas(provider, date);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at_patients BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_appointments BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_emergency_alerts BEFORE UPDATE ON emergency_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_doctors BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_admin_users BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_message_queue BEFORE UPDATE ON message_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUDIT LOG TRIGGERS (auto-log all data changes)
-- ============================================================
CREATE OR REPLACE FUNCTION log_data_change()
RETURNS TRIGGER AS $$
DECLARE
  v_action TEXT;
  v_old_value JSONB := NULL;
  v_new_value JSONB := NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'CREATE_' || UPPER(TG_TABLE_NAME);
    v_new_value := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'UPDATE_' || UPPER(TG_TABLE_NAME);
    v_old_value := to_jsonb(OLD);
    v_new_value := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'DELETE_' || UPPER(TG_TABLE_NAME);
    v_old_value := to_jsonb(OLD);
  END IF;

  INSERT INTO audit_log (action_type, resource_type, resource_id, old_value, new_value)
  VALUES (
    v_action,
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN (OLD.id)::UUID ELSE (NEW.id)::UUID END,
    v_old_value,
    v_new_value
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers to sensitive tables
CREATE TRIGGER audit_patients AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION log_data_change();

CREATE TRIGGER audit_appointments AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION log_data_change();

CREATE TRIGGER audit_emergency_alerts AFTER INSERT OR UPDATE OR DELETE ON emergency_alerts
  FOR EACH ROW EXECUTE FUNCTION log_data_change();

CREATE TRIGGER audit_doctors AFTER INSERT OR UPDATE OR DELETE ON doctors
  FOR EACH ROW EXECUTE FUNCTION log_data_change();

CREATE TRIGGER audit_admin_users AFTER INSERT OR UPDATE OR DELETE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION log_data_change();

-- ============================================================
-- PG_CRON JOBS (scheduled tasks)
-- ============================================================
-- Enable pg_cron extension (must be enabled in Supabase dashboard)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Daily appointment reminders at 9am WAT (8am UTC = WAT is UTC+1)
-- SELECT cron.schedule('appointment-reminders', '0 8 * * *', $$
--   SELECT net.http_post(
--     url := current_setting('app.supabase_url') || '/functions/v1/appointment-reminder',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
--     body := '{}'::jsonb
--   );
-- $$);

-- Process message queue every 5 seconds
-- SELECT cron.schedule('process-message-queue', '*/5 * * * * *', $$
--   SELECT net.http_post(
--     url := current_setting('app.supabase_url') || '/functions/v1/process-queue',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
--     body := '{}'::jsonb
--   );
-- $$);

-- Daily MD appointment list at 6pm WAT (5pm UTC)
-- SELECT cron.schedule('md-appointment-list', '0 17 * * *', $$
--   SELECT net.http_post(
--     url := current_setting('app.supabase_url') || '/functions/v1/send-md-list',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
--     body := '{}'::jsonb
--   );
-- $$);

-- ============================================================
-- BOOKING SESSION TIMEOUT FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION expire_stale_booking_sessions()
RETURNS void AS $$
BEGIN
  UPDATE booking_sessions
  SET status = 'expired', abandoned_at = NOW()
  WHERE status = 'active'
    AND last_message_at < NOW() - INTERVAL '30 minutes';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- EMERGENCY DEDUP KEY FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION generate_emergency_dedup_key(
  p_patient_id UUID,
  p_alert_type TEXT
)
RETURNS TEXT AS $$
BEGIN
  -- Key is patient + type + 10-minute window
  RETURN p_patient_id::TEXT || '_' || p_alert_type || '_' ||
    TO_CHAR(DATE_TRUNC('hour', NOW()) + INTERVAL '10 min' * FLOOR(EXTRACT(MINUTE FROM NOW()) / 10), 'YYYYMMDDHH24MI');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SOFT DELETE CLEANUP JOB
-- ============================================================
CREATE OR REPLACE FUNCTION process_deletion_requests()
RETURNS void AS $$
DECLARE
  v_request RECORD;
BEGIN
  -- Find deletion requests older than 30 days
  FOR v_request IN
    SELECT dr.*, p.id as p_id
    FROM deletion_requests dr
    JOIN patients p ON p.id = dr.patient_id
    WHERE dr.request_type = 'full_deletion'
      AND dr.status = 'pending'
      AND dr.requested_at < NOW() - INTERVAL '30 days'
  LOOP
    -- Anonymize patient data (retain for audit)
    UPDATE patients SET
      name = 'DELETED_' || v_request.p_id,
      phone_number = 'DELETED_' || v_request.p_id,
      email = NULL,
      age = NULL,
      gender = NULL,
      location = NULL,
      deleted_at = NOW()
    WHERE id = v_request.p_id;

    -- Mark request complete
    UPDATE deletion_requests SET
      status = 'completed',
      processed_at = NOW()
    WHERE id = v_request.id;

    -- Log the deletion
    INSERT INTO audit_log (action_type, resource_type, resource_id, new_value)
    VALUES ('HARD_DELETE_PATIENT', 'patients', v_request.p_id,
      jsonb_build_object('deletion_request_id', v_request.id, 'completed_at', NOW()));
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
