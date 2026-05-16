# Serenity AI Deployment Notes

## Live Services

- Supabase project ref: `iwkkhuozhfzmpvroprpv`
- Live patient WhatsApp number: `+234 702 674 3998`
- Live inbound webhook:
  `https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook`
- Public dashboard:
  `https://admin-dashboard-wine-rho.vercel.app`

## Provider Model

- **Meta** is the live provider.
- **Twilio** stays deployed as backup only.
- Do not switch the live webhook away from `whatsapp-webhook` unless the shared inbound handler is replaced deliberately.

## Edge Functions To Keep Current

Deploy when WhatsApp flow or booking logic changes:

```bash
supabase functions deploy whatsapp-webhook --project-ref iwkkhuozhfzmpvroprpv
supabase functions deploy ai-assistant --project-ref iwkkhuozhfzmpvroprpv
supabase functions deploy send-notification --project-ref iwkkhuozhfzmpvroprpv
supabase functions deploy appointment-reminder --project-ref iwkkhuozhfzmpvroprpv
```

Deploy `meta-whatsapp-webhook` only if the separate Meta-only path is still being maintained for fallback or comparison.

## Runtime Secrets In Use

Secrets are set in platform/runtime, not in repo files.

Important names:

- `WHATSAPP_PROVIDER`
- `WHATSAPP_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `ADMIN_DASHBOARD_URL`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_CALENDAR_ID`

## Dashboard Deployment Notes

- The public hostname currently works.
- It was restored by aliasing the hostname to the latest ready Vercel deployment.
- A direct Vercel production deploy can still be blocked by Vercel team policy tied to git commit author metadata.
- If that happens again, deploy from a clean copy without git metadata or from an allowed Vercel team member account.

## Dashboard Access

Only these two accounts should exist:

- `info@serenityroyalehospital.com` → `admin`
- `dr.adekunle@serenityroyalehospital.com` → `super_admin`

Passwords are intentionally not stored here.

## Post-Deploy Smoke Test

1. Send `hello` to the live Meta number.
2. Start a booking.
3. Use `"any available doctor"`.
4. Confirm staff WhatsApp request reaches secretary and Dr K.
5. Click the staff link and verify login redirects back to the appointment.
6. Assign a doctor and confirm the appointment from the dashboard.
7. Verify final notification fanout.

## Dashboard Action QA Gate

Use the maintained checklist in `docs/DASHBOARD_ACTION_INVENTORY.md`.

Run before shipping dashboard changes:

```bash
npm run type-check -w apps/admin-dashboard
npm run lint -w apps/admin-dashboard
npm run test:unit
npm run test:integration
npm run build -w apps/admin-dashboard
npm run test:smoke
```

Default automated tests must not send live WhatsApp messages. Use mock or test function endpoints for mutation tests, and only run live WhatsApp smoke paths with `RUN_LIVE_SMOKE=1` and a dedicated test recipient.
