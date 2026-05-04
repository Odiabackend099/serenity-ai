# Serenity AI MVP Handoff

## Project Summary

Serenity AI is the MVP Phase 1 AI assistant and admin dashboard for Serenity Royale Hospital. The public-facing assistant talks to patients on WhatsApp through Twilio, collects NDPR consent, answers general hospital questions, handles emergency/crisis language, books outpatient appointments, saves them in Supabase, syncs eligible appointments to Google Calendar, and notifies staff.

The staff-facing side is a Next.js admin dashboard deployed to Vercel. It is meant to show Dr. Kunle Adesina and Serenity staff that the AI is operational: WhatsApp messages are live, appointments land in the dashboard, pending bookings can be confirmed, Google Calendar sync is visible, and staff/patient notifications are logged.

Do not add Meta WhatsApp API back into the project. WhatsApp and SMS must remain strictly Twilio-only.

## Current Production State

- Production dashboard: `https://admin-dashboard-wine-rho.vercel.app`
- Current production deployment alias also points to the latest Vercel deployment.
- Supabase project ref: `iwkkhuozhfzmpvroprpv`
- Twilio WhatsApp sender is currently the Twilio WhatsApp Sandbox number.
- Twilio webhook is live at:
  `https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook`
- Dr K temporary staff WhatsApp alert recipient is:
  `+44 7888 377849`
- Active admin account email:
  `info@serenityroyalehospital.com`

Do not store or print API keys/tokens in docs or chat. Secrets are already configured in Supabase/Vercel/local env where needed. If a new session needs them, ask the user to provide them securely.

## What Has Been Implemented

### Twilio-Only WhatsApp

- Removed runtime dependency on Meta Cloud API.
- Inbound WhatsApp webhook accepts Twilio `application/x-www-form-urlencoded` POSTs.
- Twilio signature validation uses `X-Twilio-Signature`.
- Inbound messages are queued into `message_queue`.
- The AI worker processes queued messages and replies through Twilio.
- Live two-way WhatsApp has been verified:
  - inbound WhatsApp reaches Twilio and Supabase
  - AI response is sent back through Twilio
  - Twilio logs show delivered/read statuses

### Deterministic Appointment Booking

Booking does not depend on the AI model. It is backend-owned and deterministic.

Flow order inside `packages/functions/ai-assistant/index.ts`:

1. Consent handling
2. Emergency/crisis handling
3. Active booking session handling
4. New booking intent handling
5. General AI response

Booking steps:

- Full name
- Sex/gender
- Location
- Service type
- Doctor preference
- Preferred date
- Preferred time
- Center: Karu or Galadimawa
- Optional email
- Final confirmation

On final confirmation:

- Creates appointment in Supabase.
- Attempts doctor matching.
- Checks DB conflict.
- Checks Google Calendar FreeBusy.
- Creates Google Calendar event if safe.
- Marks appointment `confirmed` only when DB conflict check, calendar availability, and calendar event creation pass.
- Otherwise saves as `pending`.
- Sends patient WhatsApp confirmation/request received message.
- Sends staff WhatsApp alert.
- Sends staff email if email provider is configured.
- Logs notification success/failure in `notifications`.

### Google Calendar

- Uses service-account auth via `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Uses `GOOGLE_CALENDAR_ID`.
- Google Calendar is a sync/availability layer, not the source of truth.
- Supabase appointments remain source of truth.
- Calendar FreeBusy is checked before auto-confirming.
- Calendar event is inserted only after slot passes checks.

### Groq AI Provider

- General conversational AI was switched from NVIDIA to Groq.
- Booking remains deterministic and does not call Groq.
- General questions use a provider wrapper while preserving `callDrAde()` behavior.

### Email

- Email helper supports HTTP email providers:
  - Resend
  - Brevo
  - SMTP2GO
- Resend is the intended MVP provider.
- Direct SMTP is not used in Edge Functions.

### Dashboard UI

The dashboard was upgraded from scaffold-style admin pages into an operations console.

Key files:

- `apps/admin-dashboard/app/dashboard/page.tsx`
- `apps/admin-dashboard/app/dashboard/appointments/page.tsx`
- `apps/admin-dashboard/app/dashboard/appointments/actions.ts`
- `apps/admin-dashboard/app/dashboard/settings/page.tsx`
- `packages/functions/send-notification/index.ts`

Dashboard now includes:

- AI command center overview.
- WhatsApp AI status.
- Queue health.
- Calendar sync health.
- Staff alert health.
- Pending AI appointments.
- Recent AI activity.
- MVP readiness checklist.
- Appointment filters:
  - Upcoming
  - Pending
  - Confirmed
  - WhatsApp AI
  - Calendar review
  - Past
  - All
- Appointment proof badges:
  - Source: WhatsApp AI
  - Calendar status
  - Patient WhatsApp
  - Staff WhatsApp
  - Email
- Explicit staff actions:
  - Confirm
  - Cancel
  - Mark completed
  - Mark no-show
  - Send reminder

Dashboard confirmation now performs real backend work:

- Updates appointment to `confirmed`.
- Attempts calendar event creation if missing.
- Sends patient WhatsApp confirmation.
- Sends patient email if available.
- Logs notification results.

### Hybrid Conversation Routing

Hybrid routing has been implemented and deployed in `packages/functions/ai-assistant/index.ts`.

After consent, crisis, active booking, new booking, and feedback handling, the AI worker now checks deterministic templates before calling Groq. Templates currently handle:

- Privacy/NDPR/data requests
- Costs/fees/billing
- Hours, locations, contact details
- Service menu
- Medical safety boundaries for diagnosis/prescription/dosage questions
- Appointment cancellation/reschedule handoff

If none of those template intents match, the message goes to Groq as a conversational low-risk response.

## Hybrid AI Conversation Style Requirement

The desired assistant style is hybrid:

### Template-Led Flows

Use deterministic templates for high-risk or high-precision workflows:

- First-contact consent
- Crisis/emergency detection
- Appointment booking
- Appointment confirmation
- Appointment cancellation
- Staff alert notifications
- Data/privacy/NDPR responses
- Escalation instructions
- Any clinical-safety disclaimer

Reason: these workflows must be consistent, auditable, safe, and demo-proof.

### Conversational AI

Use Groq conversational responses for lower-risk free-form interactions:

- General hospital questions
- Open-ended service explanations after exact service menu facts are handled
- Supportive, non-urgent advice
- Supportive wellness guidance
- Non-urgent advice
- Follow-up clarification

Rules:

- Conversational AI must not fabricate diagnosis, medication advice, exact pricing, or guaranteed availability.
- It should route booking intent into the deterministic booking flow.
- It should route crisis/emergency language into the emergency template/escalation flow.
- It should stay concise and warm, but professional.
- It should identify itself as Dr Ade, Serenity Royale Hospital’s AI health assistant.

## Current Hybrid Routing Policy

Preserve intent routing like this:

1. If message is consent-related, use consent template.
2. If crisis/emergency/self-harm/overdose/panic keywords are detected, use crisis template and alert workflow.
3. If patient has active booking session, use deterministic booking step handler.
4. If message contains booking intent, start deterministic booking session.
5. If message matches privacy, costs, hours/locations/contact, services, medical safety, or appointment-change intent, use deterministic template.
6. Otherwise use Groq conversational response.

Examples:

- “I want to book an appointment” -> deterministic booking template.
- “I want to kill myself” -> crisis template + emergency alert.
- “What services do you offer?” -> deterministic service menu.
- “Do you treat drug addiction?” -> deterministic service menu, then offer booking.
- “Can I take diazepam?” -> safe medical disclaimer + encourage clinician consultation, no dosage advice.

## Verification Already Completed

- `npm run type-check` passed.
- `npm run build` passed.
- Deno check passed for `send-notification`.
- Deno check passed for `ai-assistant` and `ai-provider`.
- Vercel production deployment completed.
- Supabase `send-notification` function deployed.
- Supabase `ai-assistant` function deployed with hybrid routing.
- Production login route returns `200`.
- Protected dashboard route redirects unauthenticated users to login.
- Unauthenticated Edge Function calls return `401`.
- Live Twilio WhatsApp two-way test passed.
- Staff WhatsApp test to `+44 7888 377849` was delivered.

## Known Remaining Issues / Next Tasks

1. Upgrade Next.js
   - Current Next.js is `14.2.18`.
   - Vercel/npm audit reports vulnerabilities.
   - Upgrade to a patched Next 14 version, then rerun build/type-check.

2. Add better lint config
   - `next lint` previously prompted for setup because lint config was missing.
   - Add a proper Next ESLint config and fix resulting issues.

3. Final live appointment demo
   - Start a fresh WhatsApp booking.
   - Complete all booking fields.
   - Confirm appointment.
   - Verify it appears in dashboard.
   - Verify calendar status.
   - Verify patient WhatsApp confirmation.
   - Verify Dr K staff WhatsApp alert.
   - Verify staff/patient email if sender/domain is ready.

4. Resend sender/domain verification
   - If email fails, verify the sender domain/address in Resend.
   - Current code supports Resend, but provider-side sender approval must be valid.

5. Production WhatsApp sender
   - Sandbox works for MVP demo.
   - For real production, register/approve a Twilio WhatsApp sender.
   - Sandbox requires each recipient to join with the sandbox phrase.

6. Secure secret hygiene
   - Do not commit secrets.
   - Redact keys from any markdown or planning files before sharing externally.
   - Rotate any secrets that were pasted into chat if the project is going to production.

## Important Implementation Notes

- Do not revert existing user changes.
- There are many modified files in the worktree from prior implementation.
- Prefer small targeted patches.
- Use Supabase Management API only when DB password is unavailable.
- Use Supabase Edge Function secrets for runtime provider keys.
- Use Vercel env only for dashboard/server-side Next needs.
- Keep all WhatsApp/SMS through Twilio.
- Keep Google Calendar secondary to Supabase.
- Keep booking deterministic.

## Suggested Prompt For A New AI Session

You are continuing work on Serenity AI, an MVP Phase 1 WhatsApp AI assistant and admin dashboard for Serenity Royale Hospital. Read `AI_HANDOFF.md` first, then inspect the repo before making changes.

Primary goals:

1. Preserve strict Twilio-only WhatsApp/SMS.
2. Preserve deterministic appointment booking.
3. Use a hybrid conversation style:
   - templates for consent, crisis, appointment booking, notifications, privacy, and safety-critical flows
   - Groq conversational AI for general service questions and low-risk advice
4. Keep Supabase as source of truth.
5. Keep Google Calendar as availability/sync layer.
6. Keep dashboard focused on operational proof for Dr Kunle’s demo.

Before implementing anything:

- Run `rg` to understand current code paths.
- Check dashboard, Edge Functions, and database type files.
- Do not expose or print secrets.
- Do not reintroduce Meta API.

Immediate next tasks:

- Upgrade Next.js to patched 14.x and fix build issues.
- Add/finish lint config.
- Run full type-check/build.
- Run a fresh live appointment booking test.
- Verify dashboard proof badges after the live booking.
- If email fails, check Resend sender/domain verification.

Acceptance criteria:

- WhatsApp two-way works.
- Appointment booking works end-to-end without AI model dependency.
- Appointment appears in dashboard.
- Staff can confirm pending appointment from dashboard.
- Confirmation attempts calendar sync and patient notifications.
- Dashboard clearly shows calendar/WhatsApp/email proof.
- No Meta API runtime dependency.
- No secrets committed.
