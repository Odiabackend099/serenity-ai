# Serenity AI — Deployment Guide

Complete step-by-step instructions to take the codebase from zero to production.
Estimated total time: **3–4 hours**.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js 18+ | https://nodejs.org |
| Supabase CLI | `npm i -g supabase` |
| Vercel CLI | `npm i -g vercel` |
| Git | pre-installed on most systems |

---

## Step 1 — Create Supabase Project

1. Go to https://supabase.com/dashboard → **New project**
2. Project name: `serenity-ai`
3. Database password: generate a strong one, save it
4. Region: choose **Frankfurt (EU)** or **US East** (closest available to Nigeria)
5. Click **Create new project** — wait ~2 minutes

6. From the project dashboard, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret key** → `SUPABASE_SERVICE_ROLE_KEY`
   (Settings → API)

---

## Step 2 — Run Database Migrations

```bash
cd /path/to/serenity-ai

# Link to your Supabase project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Run all migrations in order
supabase db push
```

Or apply them manually in the Supabase SQL Editor in order:
1. `packages/supabase/migrations/001_init_schema.sql`
2. `packages/supabase/migrations/002_rls_policies.sql`
3. `packages/supabase/migrations/003_indexes_triggers.sql`
4. `packages/supabase/migrations/004_seed_data.sql`
5. `packages/supabase/migrations/005_pgcron_jobs.sql`
6. `packages/supabase/migrations/006_missing_tables.sql`

---

## Step 3 — Enable pg_cron + pg_net Extensions

In Supabase Dashboard → **Database** → **Extensions**:
- Enable **pg_cron**
- Enable **pg_net**

(Migration 005 will also try to enable these, but confirm they are active.)

---

## Step 4 — Store Secrets in Supabase Vault

pg_cron jobs need secrets to call Edge Functions. Store them in Vault:

In Supabase Dashboard → **Settings** → **Vault** → **Add secret**:

| Secret name | Value |
|-------------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key |
| `SUPABASE_FUNCTIONS_URL` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1` |

---

## Step 5 — Configure Edge Function Environment Variables

In Supabase Dashboard → **Settings** → **Edge Functions** → **Edit secrets**:

```
# Supabase (auto-set, but verify)
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Twilio WhatsApp + SMS
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=+14155238886
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
TWILIO_WEBHOOK_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook

# Groq AI
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama-3.3-70b-versatile

# Deepgram (Speech-to-Text)
DEEPGRAM_API_KEY=c0f60c39e1994c1c708649f89d37f3873c88974e

# Google Calendar
GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"...","private_key":"..."}
GOOGLE_CALENDAR_ID=your_calendar_id@gmail.com

# Email (HTTP API provider — set one)
BREVO_API_KEY=your_brevo_api_key
RESEND_API_KEY=your_resend_api_key
SMTP_API_KEY=your_smtp2go_api_key
SMTP_USER=info@serenityroyalehospital.com
STAFF_BOOKING_EMAIL_TO=info@serenityroyalehospital.com
STAFF_BOOKING_WHATSAPP_TO=+2348062197384
BOOKING_NOTIFY_WHATSAPP_ENABLED=true
BOOKING_NOTIFY_EMAIL_ENABLED=true

# Hospital
HOSPITAL_PHONE_PRIMARY=+2348062197384
HOSPITAL_PHONE_SECONDARY=+2348116891990
HOSPITAL_EMAIL=info@serenityroyalehospital.com
```

---

## Step 6 — Deploy Edge Functions

```bash
cd /path/to/serenity-ai

# Deploy all functions at once
supabase functions deploy whatsapp-webhook
supabase functions deploy ai-assistant
supabase functions deploy emergency-alert
supabase functions deploy appointment-reminder
supabase functions deploy send-notification
supabase functions deploy escalation-check

# Verify deployment
supabase functions list
```

Each function URL will be:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/FUNCTION_NAME`

---

## Step 7 — Create Supabase Auth Admin User

1. Supabase Dashboard → **Authentication** → **Users** → **Add user**
2. Email: `admin@serenityroyalehospital.com`
3. Password: strong password (share with Dr. Adesina's team)
4. After creating, run this SQL to add to `admin_users` table:

```sql
INSERT INTO admin_users (email, name, role, is_active)
VALUES ('admin@serenityroyalehospital.com', 'Dr. Kunle Adesina', 'super_admin', true);
```

---

## Step 8 — Deploy Admin Dashboard to Vercel

### 8a. Create `.env.local` for local testing first

```bash
cp apps/admin-dashboard/.env.example apps/admin-dashboard/.env.local
# Fill in the values below
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 8b. Test locally

```bash
cd apps/admin-dashboard
npm install
npm run dev
# Open http://localhost:3000
```

### 8c. Deploy to Vercel

```bash
# From repo root
vercel --cwd apps/admin-dashboard

# Follow prompts:
# - Set project name: serenity-ai-dashboard
# - Link to your Vercel account
```

### 8d. Set Vercel environment variables

In Vercel Dashboard → Project → Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 8e. Redeploy

```bash
vercel --cwd apps/admin-dashboard --prod
```

Your dashboard URL: `https://serenity-ai-dashboard.vercel.app`

---

## Step 9 — Configure WhatsApp Webhook

### 9a. Get your webhook URL

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook
```

### 9b. Set up Twilio WhatsApp Sandbox or Sender

1. In Twilio Console, open **Messaging → Try it out → Send a WhatsApp message** for Sandbox, or configure your approved WhatsApp sender.
2. Set **When a message comes in** to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook`.
3. Set the method to **POST**.
4. Set `TWILIO_WEBHOOK_URL` to the exact public webhook URL above.
5. For Sandbox testing, each test phone must send the join phrase and receive the Twilio "You are all set" confirmation before messages can be delivered.

---

## Step 10 — Twilio WhatsApp Message Policy

The MVP sends Twilio WhatsApp `Body` text messages through the Messages API. Future production campaigns that start conversations outside the customer service window should use approved Twilio Content messages.

---

## Step 11 — Set Up Google Calendar

1. Go to https://console.cloud.google.com
2. Create a new project: `serenity-ai`
3. Enable **Google Calendar API**
4. **IAM & Admin** → **Service Accounts** → **Create Service Account**
   - Name: `serenity-calendar`
   - Download the JSON key file
5. Copy the entire JSON content → set as `GOOGLE_SERVICE_ACCOUNT_JSON`
6. In Google Calendar, create a new calendar: `Serenity Hospital Appointments`
7. Share this calendar with the service account email (`service-account@...gserviceaccount.com`) with **Make changes to events** permission
8. Copy the calendar ID (in calendar settings) → set as `GOOGLE_CALENDAR_ID`

---

## Step 12 — Set Up Email (HTTP API Provider)

Edge Functions should send email through an HTTP API, not raw Gmail SMTP.
Set exactly one of these providers:

### Brevo (recommended fallback if SMTP2GO signup is unavailable)

1. Sign up at https://www.brevo.com
2. Verify a sender email or sender domain
3. Go to SMTP & API → API Keys → generate an API key
4. Set `BREVO_API_KEY`

### Resend

1. Sign up at https://resend.com
2. Verify a sender domain
3. API Keys → create an API key
4. Set `RESEND_API_KEY`

### SMTP2GO

1. Sign up at https://www.smtp2go.com
2. Add sender domain and follow DNS verification steps
3. API Keys → generate API key
4. Set `SMTP_API_KEY`

---

## Step 13 — Set Up Twilio SMS (for emergency alerts)

1. Sign up at https://www.twilio.com
2. Get a phone number (US or Nigerian number)
3. Copy: Account SID, Auth Token, Phone Number
4. Set as `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`

---

## Step 14 — Verify pg_cron Jobs

After running migration 005, verify cron jobs are registered:

```sql
-- Run in Supabase SQL Editor
SELECT jobname, schedule, command FROM cron.job;
```

Expected jobs:
- `process-message-queue` — `* * * * *`
- `appointment-reminders-daily` — `0 8 * * *`
- `escalation-check` — `*/5 * * * *`
- `expire-booking-sessions` — `*/10 * * * *`
- `process-deletion-requests` — `0 23 * * *`

---

## Step 15 — End-to-End Testing Checklist

### Test 1: WhatsApp → AI response
1. Send "Hello" to the hospital WhatsApp number
2. Expected: NDPR consent message sent back
3. Reply "I agree"
4. Expected: Welcome message from Dr Ade

### Test 2: Appointment booking
1. Send "I want to book an appointment"
2. Walk through all 8 booking steps
3. Confirm booking
4. Expected: Appointment created in DB + Google Calendar + WhatsApp confirmation sent

### Test 3: Emergency detection
1. Send "I want to hurt myself"
2. Expected: Dr Ade responds with support + emergency number
3. In admin dashboard → Emergencies: new alert should appear within 60 seconds
4. Expected: Hospital phone received WhatsApp + SMS + email alerts

### Test 4: Voice note
1. Send a voice message to the WhatsApp number
2. Expected: Deepgram transcription saved in DB, Dr Ade responds

### Test 5: Admin dashboard
1. Navigate to https://serenity-ai-dashboard.vercel.app
2. Log in with the admin email from Step 7
3. Check all pages load with data

### Test 6: Manual reminder
1. In admin dashboard → Appointments → find a confirmed upcoming appointment
2. Click "Send 24h" or "Send 1wk"
3. Expected: Patient receives WhatsApp reminder

### Test 7: Manual WhatsApp message
1. Patient detail page → "Send manual WhatsApp message"
2. Type a message, click Send
3. Expected: Patient receives message, conversation logged

### Test 8: CSV export
1. Admin dashboard → Audit Log page
2. Click "↓ Patients CSV"
3. Expected: CSV file downloaded with patient data

---

## Monitoring & Operations

### Daily checks
- Emergency Alerts page: any unresolved alerts?
- API Quotas in Analytics: any provider near daily limit?
- pg_cron logs: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;`

### If WhatsApp messages stop delivering
1. Check Twilio message logs for error codes.
2. Confirm `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, and `TWILIO_WEBHOOK_URL` in Edge Function secrets.
3. Confirm the Sandbox recipient joined the Sandbox, or that the production sender is approved.

### If AI responses stop
1. Check Groq API key validity
2. Check `api_quotas` table for `groq` provider — budget exceeded?
3. Check `message_queue` for items stuck in `processing` state (reset to `queued`)

### If pg_cron jobs stop running
1. Verify `pg_cron` extension is enabled
2. Check: `SELECT * FROM cron.job_run_details WHERE status = 'failed' ORDER BY start_time DESC LIMIT 10;`
3. Verify Vault secrets are accessible: `SELECT name FROM vault.decrypted_secrets;`

---

## Rollback Procedures

### Revert a bad migration
```sql
-- Run the inverse SQL manually in Supabase SQL Editor
-- Always test on a staging project first before production
```

### Emergency: disable AI responses temporarily
```sql
-- Set all queued messages to dead_letter (stops processing)
UPDATE message_queue SET status = 'dead_letter' WHERE status = 'queued';

-- Re-enable by resetting to queued
UPDATE message_queue SET status = 'queued', retry_count = 0 WHERE status = 'dead_letter';
```

### Emergency: disable WhatsApp webhook
- In Twilio Console, clear or replace the **When a message comes in** webhook URL.
- This stops all incoming messages from being processed

---

## Environment Variables Summary

### Supabase Edge Functions (set in Supabase Dashboard)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role secret key |
| `AI_PROVIDER` | ✅ | `groq` |
| `GROQ_API_KEY` | ✅ | Groq API key |
| `GROQ_BASE_URL` | ✅ | `https://api.groq.com/openai/v1` |
| `GROQ_MODEL` | ✅ | `llama-3.3-70b-versatile` |
| `DEEPGRAM_API_KEY` | ✅ | Deepgram API key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ | Google service account JSON (full) |
| `GOOGLE_CALENDAR_ID` | ✅ | Google Calendar ID |
| `BREVO_API_KEY` / `RESEND_API_KEY` / `SMTP_API_KEY` | ✅ | Email provider API key; set one |
| `SMTP_USER` | ✅ | From email address |
| `TWILIO_ACCOUNT_SID` | ✅ | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | ✅ | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | ✅ | Twilio from number |
| `TWILIO_WHATSAPP_NUMBER` | ✅ | Twilio WhatsApp sender, including Sandbox number |
| `TWILIO_WEBHOOK_URL` | ✅ | Exact public webhook URL used for signature validation |
| `STAFF_BOOKING_WHATSAPP_TO` | ✅ | Dr K WhatsApp number for new booking alerts |
| `STAFF_BOOKING_EMAIL_TO` | ✅ | Comma-separated staff email recipients for booking alerts |
| `HOSPITAL_PHONE_PRIMARY` | ✅ | `+2348062197384` |
| `HOSPITAL_EMAIL` | ✅ | `info@serenityroyalehospital.com` |

### Vercel (Next.js Admin Dashboard)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (server-only) |

---

## Architecture Diagram

```
Patient (WhatsApp)
      │
      ▼
Twilio WhatsApp
      │ POST (HMAC verified)
      ▼
whatsapp-webhook (Edge Function)
  → Store in message_queue
  → Return 200 immediately
      │
      ▼ (every 1 min via pg_cron)
ai-assistant (Edge Function)
  → Consent gate
  → Voice: Deepgram STT
  → Feedback detection
  → Emergency detection
  → Booking state machine
  → Groq AI for general non-booking questions
  → Save conversation
  → Reply via WhatsApp
  → If emergency: trigger emergency-alert
      │
      ├─── emergency-alert (Edge Function)
      │      → Dedup (10-min window)
      │      → Create DB record
      │      → WhatsApp + Email + SMS (parallel)
      │      → escalation-check (every 5min via pg_cron)
      │
      └─── appointment-reminder (daily 9am WAT via pg_cron)
             → 1-week reminders
             → 24h reminders
             → Feedback requests
             → Daily list email to MD

Admin Dashboard (Next.js on Vercel)
  → Supabase Auth
  → Server Components (real data, no stale caches)
  → Server Actions (mutations)
  → Supabase Realtime → EmergencyRealtimeRefresher
```

---

## Cost Estimates (at steady state, ~50 patients/month)

| Service | Tier | Est. Monthly Cost |
|---------|------|-------------------|
| Supabase | Free (up to 500MB DB, 2GB storage) | $0 |
| Vercel | Hobby (free) | $0 |
| Groq | Pay-per-token / free dev tier depending on account | ~$0–15 |
| Deepgram | Pay-per-minute (~$0.0043/min) | ~$2–5 |
| WhatsApp | Free for first 1K conversations/month | $0 |
| Brevo / Resend / SMTP2GO | Free or low-cost email API tier | $0–15 |
| Twilio SMS | ~$0.0075/SMS | ~$1–3 |
| Google Calendar | Free (within quota) | $0 |
| **Total** | | **~$8–25/month** |

---

*Built by ODIADEV AI LTD for Serenity Royale Hospital, Abuja, Nigeria.*
*Last updated: April 2026*
