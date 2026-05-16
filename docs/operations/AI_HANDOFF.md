# Serenity AI Handoff

## Current Live State

- Project: `iwkkhuozhfzmpvroprpv`
- Primary WhatsApp provider: **Meta Cloud API**
- Backup provider: **Twilio** only
- Live patient number: `+234 702 674 3998`
- Canonical inbound webhook:
  `https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook`
- Public dashboard URL:
  `https://admin-dashboard-wine-rho.vercel.app`

Important: the public dashboard hostname currently points to the latest **ready** Vercel deployment. Direct Vercel production promotion is still blocked by a Vercel team/commit-author policy, so do not remove that alias until a stable production deployment is confirmed.

## What Is Done

- Live Meta inbound and outbound messaging is working again.
- `whatsapp-webhook` now supports both:
  - Meta JSON webhook requests
  - Twilio form-encoded webhook requests
- `WHATSAPP_PROVIDER=meta` is the live outbound path. Twilio remains available as backup.

### Deterministic Booking And Availability

- Appointment booking is deterministic and does not depend on Groq.
- Availability is checked before the patient is asked for final confirmation.
- Rules enforced:
  - timezone: `Africa/Lagos`
  - Monday to Saturday only
  - no Sundays
  - outpatient hours: `8:00am` to `4:00pm`
  - 60-minute default duration
  - past slots rejected
  - `4:00pm` starts rejected
- Availability order:
  1. Supabase overlap check
  2. Google Calendar FreeBusy check
  3. closest valid alternatives if busy
- Slot holds and atomic final booking RPC are in place to reduce double-booking risk.

### Booking UX And Patient Copy

- Patient-facing copy no longer leaks internal wording such as `database`, `calendar error`, or raw API failures.
- Returning-patient replies were cleaned up:
  - no `I am a large language model`
  - no placeholder `TestUser` greeting
  - no stale historical appointment confirmation on a plain greeting
- Date parsing now accepts common real-world inputs such as:
  - `18th may 2026`
  - `2026 05 18`
  - `10 am pls`

### Any Available Doctor Flow

- `"Any available doctor"` now creates an **appointment request**, not an assigned appointment.
- For this path:
  - `appointments.doctor_id = null`
  - status stays `pending`
  - patient sees `Doctor: To be assigned`
  - secretary and Dr K receive the request
  - selected doctor is notified only after dashboard assignment/confirmation

### Dashboard And Staff Link Flow

- The broken dashboard hostname was restored.
- Staff links now use login with return target:
  - `/auth/login?next=/dashboard/appointments?appointment=<id>`
- After sign-in, the dashboard returns staff to the exact appointment link target instead of dropping them on the generic dashboard.

### Admin Access

Only **2** dashboard access accounts remain live:

1. `info@serenityroyalehospital.com`
   - name: `Abdullahi Rahinatu`
   - role: `admin`

2. `dr.adekunle@serenityroyalehospital.com`
   - name: `Dr. Adekunle Adesina`
   - role: `super_admin`

Removed/disabled:

- `admin@serenityroyalehospital.com`
- `serenity@demo.com`

Passwords were set live to the user-provided value but are intentionally **not stored in repo docs**.

## Current Notification Behavior

Staff WhatsApp rows now separate provider acceptance from phone delivery:

- `sent` means Meta accepted the message and the dashboard shows "Waiting for delivery"
- `delivered` means WhatsApp reported delivery to the phone
- `read` means WhatsApp reported the message was read
- `failed` means WhatsApp reported a delivery failure and the dashboard should show "Needs resend"

### On appointment request

- Patient receives request-received response on WhatsApp
- Secretary receives WhatsApp request with direct dashboard link
- Dr K receives WhatsApp request with direct dashboard link
- Staff email can also be sent when configured

### After dashboard confirmation

The intended confirmation fanout is:

- patient WhatsApp
- patient email if present
- secretary WhatsApp
- Dr K WhatsApp
- assigned doctor WhatsApp

Approved Meta utility templates should be used for proactive staff notifications when available. Configure `WHATSAPP_STAFF_BOOKING_ALERT_TEMPLATE`, `WHATSAPP_STAFF_CONFIRMATION_TEMPLATE`, and `WHATSAPP_ASSIGNED_DOCTOR_CONFIRMATION_TEMPLATE` in Supabase secrets after Meta approval.

## Important Files

- [packages/functions/ai-assistant/index.ts](/Users/mac/.codex/worktrees/2e58/Serenity%20AI/packages/functions/ai-assistant/index.ts)
- [packages/functions/_shared/appointment-availability.ts](/Users/mac/.codex/worktrees/2e58/Serenity%20AI/packages/functions/_shared/appointment-availability.ts)
- [packages/functions/_shared/mvp-logic.ts](/Users/mac/.codex/worktrees/2e58/Serenity%20AI/packages/functions/_shared/mvp-logic.ts)
- [apps/admin-dashboard/app/auth/login/page.tsx](/Users/mac/.codex/worktrees/2e58/Serenity%20AI/apps/admin-dashboard/app/auth/login/page.tsx)
- [apps/admin-dashboard/app/dashboard/appointments/page.tsx](/Users/mac/.codex/worktrees/2e58/Serenity%20AI/apps/admin-dashboard/app/dashboard/appointments/page.tsx)
- [apps/admin-dashboard/app/dashboard/appointments/actions.ts](/Users/mac/.codex/worktrees/2e58/Serenity%20AI/apps/admin-dashboard/app/dashboard/appointments/actions.ts)

## Remaining Open Items

1. Run one full live dashboard click-through:
   - secretary opens WhatsApp link
   - signs in
   - assigns doctor
   - confirms appointment
   - verify final fanout to patient, secretary, Dr K, and assigned doctor
   - verify Meta status webhooks update `notifications.delivered_at`, `notifications.read_at`, or `notifications.error_message`
2. Stabilize Vercel production deployment so the hostname no longer depends on a ready deployment alias.
3. Rotate exposed debug tokens after this session.
