# Twilio WhatsApp Live Readiness

This project is currently ready for controlled MVP use through Twilio WhatsApp Sandbox. The Sandbox does not become the production sender automatically. Production requires a live WhatsApp Sender registered in Twilio and connected to a Meta Business Portfolio / WhatsApp Business Account.

## Current State

- Runtime messaging is Twilio-only.
- Inbound webhook: `https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook`
- Webhook method: `POST`
- Sandbox sender remains active until Twilio approves the live sender.
- Do not switch `TWILIO_WHATSAPP_NUMBER` until the live sender is approved and tested.

## Meta / Facebook Preparation

Use the Facebook account only as the human admin login. The business identity must be the hospital, not a personal or fake brand.

- Business name: `Serenity Royale Hospital`
- Website: `https://serenityroyalehospital.com`
- Country/location: `Nigeria / Abuja`
- Category: `Healthcare`, `Mental health`, or `Rehabilitation`
- Add at least two admins:
  - implementation/admin operator
  - hospital owner or authorized representative
- Avoid duplicate Meta Business Portfolios for the same hospital unless Twilio/Meta requires it.

## Twilio Live Sender Setup

After Twilio account reactivation:

1. Open Twilio Console.
2. Go to WhatsApp Senders / Self Sign-up.
3. Connect the Serenity Royale Hospital Meta Business Portfolio.
4. Create or connect the WhatsApp Business Account.
5. Register the hospital-approved WhatsApp phone number.
6. Complete OTP verification by SMS or voice call.
7. Configure the live sender inbound webhook:
   - URL: `https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook`
   - Method: `POST`
8. Confirm the sender is active and not blocked by Meta policy review.

If the hospital number is already registered in WhatsApp or WhatsApp Business App, it may need to be removed/migrated before it can be registered as a WhatsApp Business Platform sender.

## Environment Cutover

Only after the live sender is active:

```env
TWILIO_WHATSAPP_MODE=live
TWILIO_WHATSAPP_NUMBER=+<approved-live-whatsapp-number>
TWILIO_LIVE_WHATSAPP_NUMBER=+<approved-live-whatsapp-number>
TWILIO_WEBHOOK_URL=https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook
```

Keep the existing Supabase, Groq, Resend, Google Calendar, staff notification, and dashboard envs unchanged.

## Live Test Checklist

- Send a fresh WhatsApp message from a patient phone to the live hospital number.
- Confirm Twilio receives inbound message.
- Confirm Supabase `message_queue` receives one row.
- Confirm AI replies on WhatsApp.
- Complete one appointment booking.
- Confirm patient receives WhatsApp confirmation.
- Confirm secretary, Dr K, and selected doctor receive WhatsApp alerts.
- Confirm dashboard shows the appointment.
- Confirm dashboard confirmation sends patient/staff follow-up alerts.

## Message Policy

For MVP, keep live traffic to patient-initiated conversations, appointment confirmations, staff notifications, emergency escalation, and compliant reminders. Business-initiated messages outside the WhatsApp customer-service window should use approved templates.
