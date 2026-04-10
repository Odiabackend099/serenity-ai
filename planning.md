# Serenity AI - Planning Document (3-Step Coding Principle)

## What Problem It Solves
Serenity Royale Hospital (Abuja, Nigeria) needs a 24/7 AI receptionist to handle patient inquiries, book appointments, detect mental health emergencies, and reduce staff workload via WhatsApp.

## Inputs, Outputs, and Constraints

**Inputs**: WhatsApp messages (text, voice notes, images, videos, PDFs) from patients
**Outputs**: AI responses, appointment confirmations, emergency alerts, reminders, admin dashboard
**Constraints**: NDPR/NDPA compliance, Nigerian internet reliability, WhatsApp 24-hour messaging window, NVIDIA API rate limits (40 RPM free tier)

## Dependencies and Assumptions
- Supabase project created (PostgreSQL, Auth, Edge Functions, Storage)
- Vercel account for frontend deployment
- NVIDIA API key: `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`
- Deepgram API key: `c0f60c39e1994c1c708649f89d37f3873c88974e`
- Meta WhatsApp Business API access (hospital phones: +234 806 219 7384 and +234 811 689 1990)
- Google Calendar API service account
- Twilio account for SMS
- Gmail SMTP for email

---

## Implementation Phases

### Phase 1: Foundation
**Goal**: Monorepo setup, database schema, environment config

**Steps**:
1. Initialize Turborepo monorepo with apps/admin-dashboard and packages/supabase, packages/functions
2. Create Supabase project and run all database migrations (15 tables + indexes + RLS)
3. Seed doctors table with Dr. Kunle Adesina
4. Create .env.example with all required environment variables
5. Initialize Next.js 14 project with TypeScript + Tailwind

**Testing Criteria**:
- [ ] `npm install` succeeds in root
- [ ] Supabase migrations run without errors
- [ ] All 15 tables exist with correct columns
- [ ] RLS policies active on all tables
- [ ] Dr. Adesina exists in doctors table
- [ ] Next.js dev server starts

### Phase 2: WhatsApp + AI Core
**Goal**: Patients can message WhatsApp and get AI responses

**Steps**:
1. Build `whatsapp-webhook` Edge Function (HMAC verification, immediate 200 OK, queue to message_queue)
2. Build `_shared/whatsapp.ts` (send text/template messages via Meta Cloud API, rate limiting)
3. Build `_shared/nvidia-ai.ts` (NVIDIA API client with rate limiting, budget tracking, fallback responses)
4. Build `_shared/deepgram.ts` (STT with PII redaction enabled, TTS for voice responses)
5. Build `ai-assistant` Edge Function (dequeue from message_queue, build conversation history, call NVIDIA, send response)
6. Build media handling (download voice/image/video from WhatsApp, transcribe voice via Deepgram)
7. Build NDPR consent collection (first-time patient consent prompt before storing data)

**Testing Criteria**:
- [ ] WhatsApp webhook verifies HMAC signature correctly
- [ ] Webhook returns 200 OK within 200ms (before AI processing)
- [ ] Messages appear in message_queue table
- [ ] AI responds within 10 seconds via WhatsApp
- [ ] Voice notes transcribed with PII redacted
- [ ] Images/videos acknowledged
- [ ] Rate limiting prevents >35 NVIDIA calls/min
- [ ] First-time patients see consent prompt
- [ ] Consent recorded in consent_log table

### Phase 3: Emergency System
**Goal**: Crisis detection triggers immediate multi-channel alerts to hospital

**Steps**:
1. Build emergency keyword detection (regex + NVIDIA NLP confidence scoring)
2. Build `emergency-alert` Edge Function (deduplication, multi-channel notification)
3. Build escalation timeout system (5min -> SMS reminder, 10min -> backup doctor, 15min -> switchboard)
4. Build `_shared/email.ts` (nodemailer with Gmail SMTP)
5. Build SMS notification via Twilio

**Testing Criteria**:
- [ ] "I want to hurt myself" triggers emergency alert
- [ ] Alert appears in emergency_alerts table with correct type and severity
- [ ] WhatsApp message sent to admin
- [ ] Email sent to hospital
- [ ] SMS sent to hospital phone
- [ ] Duplicate alerts within 10min are suppressed (only 1 sent)
- [ ] Unacknowledged alerts escalate after 5min
- [ ] Patient receives calm, supportive response with emergency number

### Phase 4: Appointments
**Goal**: Patients book appointments via conversational AI flow

**Steps**:
1. Build booking_sessions table and state machine (7 steps: name, sex, location, service, doctor, date, time)
2. Build appointment booking conversational flow in AI assistant
3. Build doctor_availability management (check slots before booking)
4. Build `_shared/calendar.ts` (Google Calendar API with quota tracking)
5. Build appointment confirmation notifications (WhatsApp template + email)
6. Build `appointment-reminder` Edge Function + pg_cron (1-week + 24-hour reminders via templates)
7. Build daily appointment list email to MD

**Testing Criteria**:
- [ ] "I want to book an appointment" starts booking flow
- [ ] All 7 fields collected step-by-step with validation
- [ ] Invalid inputs re-prompt with error message
- [ ] Booking session resumes after 10-min pause
- [ ] Booking session expires after 30-min timeout
- [ ] Appointment created in database with correct fields
- [ ] Google Calendar event created
- [ ] Patient receives confirmation via WhatsApp template
- [ ] Hospital admin receives email notification
- [ ] 1-week reminder sent for appointments >=1 month away
- [ ] 24-hour reminder sent for all appointments
- [ ] MD receives daily appointment list email
- [ ] Double-booking prevented by doctor_availability check

### Phase 5: Admin Dashboard
**Goal**: Hospital staff can view all activity, manage appointments, respond to emergencies

**Steps**:
1. Setup Next.js 14 with Supabase Auth + Tailwind + RBAC middleware
2. Build login page with MFA for admin accounts
3. Build dashboard overview (metrics: total patients, today's appointments, active conversations, unresolved emergencies)
4. Build conversations page (list + detail with real-time Supabase Realtime updates)
5. Build appointments page (calendar view + create/edit/cancel + doctor availability management)
6. Build emergencies page (alert list + acknowledge button + escalation history + response notes)
7. Build patients page (profiles + conversation history + consent status)
8. Build on-call schedule management page
9. Build settings page (hospital info, doctors, API config)

**Testing Criteria**:
- [ ] Admin can login with email/password + MFA
- [ ] Dashboard shows correct metrics from live data
- [ ] New WhatsApp messages appear in real-time on conversations page
- [ ] Admin can view full conversation thread per patient
- [ ] Appointments calendar shows correct data by date/doctor/location
- [ ] Emergency alerts show with acknowledge button
- [ ] Clicking acknowledge records timestamp and admin ID
- [ ] Patient profiles show complete history
- [ ] On-call schedule can be edited
- [ ] Settings changes persist

### Phase 7: Gap Fixes — Backend Critical
**Goal**: Close all critical and significant backend gaps identified in UX audit

**Problems being solved**:
- pg_cron jobs never activate → reminders, queue processor, MD daily list never run
- `finalizeBooking()` creates appointment but never sends WhatsApp confirmation template
- Feedback replies ("4", "Great!") go to Dr Ade as normal chat — never stored in `appointment_feedback`
- Crisis message mid-booking leaves booking session open — should abort it
- Emergency escalation (5→10→15 min cascade) mentioned in code but never implemented

**Steps**:
1. Migration 005: Enable `pg_cron` + `pg_net` extensions, create 3 scheduled jobs (queue processor every 1min, reminders at 9am WAT, MD list at 6pm WAT)
2. ai-assistant: Call `sendAppointmentConfirmation()` template + email inside `finalizeBooking()` after DB insert
3. ai-assistant: Before calling Dr Ade, detect if patient replied to feedback request (recent completed appointment, no feedback yet, message is a valid rating) → save to `appointment_feedback`, thank patient, skip AI
4. ai-assistant: If emergency detected AND active booking session → mark session `abandoned`, do not advance
5. New Edge Function `escalation-check`: pg_cron every 5 min, escalates unacknowledged alerts: level 1→2 at 5min (SMS), 2→3 at 10min (backup doctor WhatsApp), 3+ at 15min (switchboard call log)

**Technical Requirements**:
- `pg_net` extension for calling Edge Functions from pg_cron
- `cron.schedule()` syntax for Supabase pg_cron
- `parseFeedbackRating()` from `_shared/deepgram.ts` (already exists)
- `sendAppointmentConfirmation()` from `_shared/whatsapp.ts` (already exists)
- `sendAppointmentConfirmationEmail()` from `_shared/email.ts` (already exists)
- `on_call_schedule` table for escalation-check to find backup doctor

**Testing Criteria**:
- [ ] `SELECT * FROM cron.job` shows 3 scheduled jobs
- [ ] Send "I want to book" → complete all steps → confirm → WhatsApp confirmation template received
- [ ] Reply "4" after appointment → `appointment_feedback` row created, thank-you message received
- [ ] Reply "Excellent service" after appointment → same as above (text feedback stored)
- [ ] Send crisis message during booking → booking_session status becomes 'abandoned'
- [ ] Create alert, wait 5 min without acknowledging → escalation_level becomes 2, SMS sent

### Phase 8: Emergency Management UI + Escalation
**Goal**: Admin can acknowledge and resolve alerts directly from the dashboard; escalation cascade runs automatically

**Problems being solved**:
- Emergencies page is read-only — admin has no way to acknowledge or resolve from dashboard
- No response notes can be entered from UI
- Escalation cascade not implemented

**Steps**:
1. Create `app/dashboard/emergencies/actions.ts` — Next.js server actions: `acknowledgeAlert(id)`, `resolveAlert(id, notes)`
2. Update `app/dashboard/emergencies/page.tsx` — "Acknowledge" button on unacknowledged alerts, "Resolve" button with notes textarea
3. New Edge Function `packages/functions/escalation-check/index.ts` — query unacknowledged alerts by age, escalate through levels

**Technical Requirements**:
- `'use server'` Next.js server actions with Supabase service role client
- `revalidatePath('/dashboard/emergencies')` after action to refresh UI
- `escalation_level` and `escalated_to` columns already in schema
- `on_call_schedule` join to find backup doctor name/phone for level 2 escalation
- pg_cron job for escalation-check (added in migration 005)

**Testing Criteria**:
- [ ] "Acknowledge" button appears on unacknowledged alerts
- [ ] Clicking Acknowledge → `acknowledged_at` set, button disappears, "Acknowledged" badge shows
- [ ] "Resolve" button with text area appears on acknowledged alerts
- [ ] Submitting resolve → alert moves from Unresolved to Resolved section with notes displayed
- [ ] After 5 min unacknowledged → escalation_level = 2 in DB, backup doctor notified
- [ ] After 10 min → level 3, switchboard notified

### Phase 9: Dashboard UX Completions
**Goal**: Conversations searchable/paginated; patients have clickable detail pages with full history

**Problems being solved**:
- Conversations page shows latest 50 with no way to find a specific patient's messages
- Patient rows in patients list are not clickable — no detail view exists
- No way to see a patient's full conversation history, appointments, or emergency alerts in one place

**Steps**:
1. Update `conversations/page.tsx` — add `searchParams` (q, page, sentiment, type), search form, sentiment/type filter dropdowns, pagination (25 per page)
2. Create `app/dashboard/patients/[id]/page.tsx` — patient detail: info card, consent history, all conversations (paginated), all appointments, any emergency alerts
3. Make patient rows in `patients/page.tsx` clickable (wrap in `<a href="/dashboard/patients/{id}">`)
4. Add `[id]` to Sidebar dynamic highlighting (already handled by `usePathname` starts-with check)

**Technical Requirements**:
- `searchParams` prop on server components (Next.js 14)
- Supabase queries with `.or()`, `.eq()`, `.range()` for filtering and pagination
- Dynamic route `[id]` folder under `patients/`
- Joins: patient → conversations, appointments, emergency_alerts for detail page

**Testing Criteria**:
- [ ] Search "John" in conversations → only John's messages shown
- [ ] Filter by sentiment "crisis" → only crisis conversations shown
- [ ] Paginate → correct records per page
- [ ] Click patient row → redirects to `/dashboard/patients/{uuid}`
- [ ] Patient detail shows: info, consent date, last N conversations with messages, all appointments, any alerts
- [ ] Back navigation returns to patients list

### Phase 6: Compliance & Polish
**Goal**: NDPR compliance verified, analytics, feedback collection

**Steps**:
1. Build analytics page (charts: daily conversations, appointment trends, emergency frequency, feedback ratings)
2. Build feedback collection flow (24h post-appointment WhatsApp template survey)
3. Build audit log dashboard (searchable, filterable, exportable)
4. Build patient data export/deletion workflow (right to access + right to erasure)
5. NDPR compliance audit checklist verification
6. Write incident response plan documentation

**Testing Criteria**:
- [ ] Analytics charts render with real data
- [ ] Feedback survey sent 24h after appointment
- [ ] Patient rating (1-5) stored in appointment_feedback
- [ ] Audit log shows all data access/modifications
- [ ] Audit log exportable as CSV
- [ ] Patient can request data export (JSON)
- [ ] Patient can request account deletion (soft-delete -> hard-delete after 30 days)
- [ ] Privacy policy document accessible
- [ ] All sensitive fields encrypted at rest (pgcrypto)
- [ ] All API calls use TLS 1.3

---

## Phase 10: Admin Dashboard — Full Capability (Gap Fixes)

### What Problems This Solves
After UX audit, 12 capabilities were missing from the admin dashboard:
- Static red dot on sidebar (doesn't reflect live count)
- No real-time updates when emergencies come in
- Appointments are read-only (can't update status, cancel, or view past)
- Doctors can only be managed via Supabase — no UI
- On-call schedule cannot be edited from dashboard
- Admin users cannot be managed from dashboard
- Patient records cannot be edited
- No way to send a manual WhatsApp message to a patient from dashboard
- No CSV export for patients or appointments
- Audit log exists in DB but no viewer in dashboard
- No manual reminder trigger
- All settings are read-only

### Implementation Phases

#### Phase 10A: Dynamic Sidebar + Real-time Emergency Alert
**What:** Sidebar shows live unresolved alert count; emergencies page refreshes automatically when new alerts arrive

**Steps:**
1. `dashboard/layout.tsx` — fetch `emergency_alerts` count where `resolved_at IS NULL`, pass as `emergencyCount` prop to Sidebar
2. `Sidebar.tsx` — accept `emergencyCount: number` prop, replace static red dot with numeric badge (hidden when count = 0)
3. Create `components/dashboard/EmergencyRealtimeRefresher.tsx` — 'use client' component that subscribes to `emergency_alerts` INSERT via Supabase Realtime and calls `router.refresh()` on change
4. Add `EmergencyRealtimeRefresher` to `emergencies/page.tsx`

**Technical requirements:**
- `createBrowserClient` for realtime subscription (client-side)
- `useRouter().refresh()` to re-run server component data fetch
- Layout is server component — can run Supabase query before render
- Sidebar receives count as prop (already 'use client')

**Testing criteria:**
- [ ] Sidebar shows "3" badge when 3 unresolved alerts exist
- [ ] Badge hidden (no dot) when count = 0
- [ ] New WhatsApp emergency triggers page refresh within 5 seconds
- [ ] Resolving all alerts removes badge from sidebar

---

#### Phase 10B: Appointment Management
**What:** Admin can update appointment status, cancel, view past appointments, and trigger manual reminders

**Steps:**
1. Create `appointments/actions.ts` — server actions: `updateStatus(id, status)`, `cancelAppointment(id)`, `sendManualReminder(id, type)`
2. Update `appointments/page.tsx`:
   - Add `?view=upcoming|past|all` searchParam tab switcher
   - Per row: status dropdown (inline `<select>`) + Cancel button
   - Per row: "Send Reminder" button (only for upcoming confirmed appointments)
   - Past appointments tab shows `appointment_date < today`

**Technical requirements:**
- `updateStatus`: UPDATE appointments SET status = ? WHERE id = ?
- `cancelAppointment`: UPDATE status = 'cancelled' + cancel Google Calendar event if `google_calendar_event_id` set
- `sendManualReminder`: call WhatsApp `sendAppointmentReminder24h()` directly, mark `reminder_24h_sent = true`
- `revalidatePath('/dashboard/appointments')` after each action
- Status options: pending | confirmed | completed | no_show | cancelled
- Cancel is destructive — confirm before showing (use details/summary disclosure)

**Testing criteria:**
- [ ] Status dropdown changes appointment status in DB and UI refreshes
- [ ] Cancel button sets status to 'cancelled' and appointment disappears from upcoming view
- [ ] Past tab shows appointments before today
- [ ] Send Reminder triggers WhatsApp template and marks reminder_24h_sent = true
- [ ] Cancel with Google Calendar ID removes the calendar event

---

#### Phase 10C: Settings Management (Doctors, On-Call, Admin Users)
**What:** Fully manage doctors, on-call schedule, and admin users from dashboard — no Supabase access needed

**Steps:**
1. Create `settings/actions.ts` — server actions:
   - `addDoctor(formData)`: INSERT into doctors
   - `updateDoctor(id, formData)`: UPDATE doctors
   - `deactivateDoctor(id)`: UPDATE is_active = false
   - `addOnCallSchedule(formData)`: INSERT into on_call_schedule
   - `removeOnCallSchedule(id)`: DELETE from on_call_schedule
   - `addAdminUser(formData)`: INSERT into admin_users + create Supabase auth user via admin API
   - `deactivateAdminUser(id)`: UPDATE admin_users SET is_active = false
2. Update `settings/page.tsx`:
   - Doctors section: add "Add Doctor" form (name, speciality, phone, email, location, bio), edit inline, deactivate button
   - On-Call section: add "Add Schedule" form (doctor select, start_date, end_date, is_primary toggle), remove button
   - Admin Users section: add "Invite Admin" form (email, name, role select), deactivate button

**Technical requirements:**
- All forms use `<form action={serverAction}>` pattern
- Doctors: name (required), speciality, phone, email, location (Karu/Galadimawa/Both), bio, is_active
- On-call: doctor_id FK (select from active doctors), start_date, end_date, is_primary
- Admin users: email, name, role (admin/doctor/nurse/staff/dpo) — password set by user via Supabase email invite
- `revalidatePath('/dashboard/settings')` after each action

**Testing criteria:**
- [ ] Add doctor form appears, submits, new doctor shows in list
- [ ] Deactivate button marks doctor inactive, badge changes, doctor no longer bookable via AI
- [ ] Add on-call schedule appears in schedule list
- [ ] Remove on-call removes entry
- [ ] Invite admin user creates admin_users record
- [ ] Deactivated admin user shows as inactive

---

#### Phase 10D: Patient Editing + Manual WhatsApp Reply
**What:** Admin can edit patient profile fields and send a manual WhatsApp message from the patient detail page

**Steps:**
1. Create `patients/[id]/actions.ts` — server actions:
   - `updatePatient(id, formData)`: UPDATE patients SET name, email, location, age, gender
   - `sendManualMessage(patientId, phoneNumber, message)`: calls `sendTextMessage()` from whatsapp.ts via Edge Function, saves to conversations table
2. Update `patients/[id]/page.tsx`:
   - Edit button in header card that reveals inline edit form (name, email, location, age, gender)
   - "Send Message" box at top of conversations column: textarea + send button
   - Sent messages appear in conversation history (ai_response field, marked as manual)

**Technical requirements:**
- `updatePatient`: PATCH patients table — only editable fields (name, email, location, age, gender)
- `sendManualMessage`: calls Supabase Edge Function `send-notification` with custom message, OR calls WhatsApp API directly from server action
- Saved as conversation record: `message_type = 'manual_admin'`, `ai_response = message`, `patient_message = null`
- Edit form is inline — no separate page, show/hide via CSS (server renders both, client toggles)
- `revalidatePath('/dashboard/patients/[id]')` after updates

**Testing criteria:**
- [ ] Edit button reveals form pre-filled with current values
- [ ] Saving name change reflects immediately in header
- [ ] Send message box sends WhatsApp message to patient
- [ ] Sent message appears in conversation history with "Admin" label
- [ ] Empty message blocked by HTML required validation

---

#### Phase 10E: Export + Audit Log
**What:** Admin can download CSV of patients or appointments; audit log viewer shows all data changes

**Steps:**
1. Create `app/api/export/patients/route.ts` — GET handler, streams CSV of all patients
2. Create `app/api/export/appointments/route.ts` — GET handler, streams CSV of upcoming appointments
3. Add export buttons to patients page and appointments page
4. Create `app/dashboard/audit/page.tsx` — paginated audit log viewer with filters (table, action, date range)
5. Add "Audit Log" to Sidebar navigation (below Settings, above Sign Out)

**Technical requirements:**
- CSV routes: use service role client, stream response as `text/csv` with `Content-Disposition: attachment`
- Patient CSV columns: name, phone_number, email, age, gender, location, consent_ndpr, consent_date, created_at
- Appointment CSV columns: patient_name, patient_phone, appointment_date, appointment_time, center, service_type, doctor_name, status
- Audit log query: `audit_log` table with filters on `resource_type`, `action`, date range — 50 per page
- Audit log displays: timestamp, admin user, action (CREATE/UPDATE/DELETE), table, old/new values (JSON diff)

**Testing criteria:**
- [ ] "Export CSV" button on patients page downloads patients.csv
- [ ] "Export CSV" button on appointments page downloads appointments.csv
- [ ] CSV contains all correct columns and data
- [ ] Audit log page loads and shows records
- [ ] Filtering by table (patients/appointments/etc.) works
- [ ] Pagination works on audit log

---

### Summary of All Gap Fixes (Phase 10A–10E)

| Gap | Phase | Approach |
|-----|-------|---------|
| Static sidebar emergency dot | 10A | Layout fetches count, passes to Sidebar as prop |
| No real-time updates | 10A | Supabase Realtime client component calls router.refresh() |
| Appointment status read-only | 10B | Server actions + inline select/buttons |
| No past appointments view | 10B | ?view=past searchParam tab |
| No manual reminder trigger | 10B | Server action calls WhatsApp template directly |
| Doctors not manageable | 10C | Full CRUD forms in Settings |
| On-call not manageable | 10C | Add/remove form in Settings |
| Admin users not manageable | 10C | Invite/deactivate form in Settings |
| Patient records not editable | 10D | Inline edit form on patient detail page |
| No manual WhatsApp reply | 10D | Send message box on patient detail page |
| No CSV export | 10E | API routes streaming CSV |
| No audit log viewer | 10E | New /dashboard/audit page |
