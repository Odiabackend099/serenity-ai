# Meta WhatsApp Cloud API Status

## Current Live Meta Setup

- App: `Serenity Royale Hospital AI`
- App ID: `979681811210479`
- Business portfolio ID: `1126808936310013`
- Live WhatsApp Business Account ID: `2443577022785691`
- Live phone number ID: `1132560046604157`
- Live display number: `+234 702 674 3998`

The live inbound callback is:

```text
https://iwkkhuozhfzmpvroprpv.supabase.co/functions/v1/whatsapp-webhook
```

## What Is Working

- Meta inbound messages are reaching the webhook again.
- Meta outbound replies are sending from the live number.
- The shared inbound path supports Meta and Twilio.
- Staff booking alerts are sending through Meta.
- The dashboard link in staff alerts now uses login with a return target.
- Meta outbound status callbacks are recorded against `notifications.external_message_id` so accepted sends can later become delivered, read, or failed.

## Current Behavior

- Patient messages arrive on the live Meta number.
- `message_queue` receives the inbound message.
- `ai-assistant` processes the request.
- Outbound patient reply goes back through Meta.
- Appointment requests notify:
  - Secretary
  - Dr K
- `"Any available doctor"` remains unassigned until dashboard confirmation.
- Dashboard confirmation notifies:
  - patient
  - secretary
  - Dr K
  - assigned doctor
- The dashboard treats Meta `sent` as "waiting for delivery" until a delivery/read/failure webhook arrives.

## Provider Rule

- Live default: `WHATSAPP_PROVIDER=meta`
- Twilio remains backup only.

## Current Operational Notes

- The old dashboard hostname issue is fixed.
- The public hostname now points to a ready Vercel deployment.
- New staff notification links use:
  - `/auth/login?next=/dashboard/appointments?appointment=<id>`
- Approved Meta utility templates should be configured for staff booking and confirmation notifications:
  - `WHATSAPP_STAFF_BOOKING_ALERT_TEMPLATE`
  - `WHATSAPP_STAFF_CONFIRMATION_TEMPLATE`
  - `WHATSAPP_ASSIGNED_DOCTOR_CONFIRMATION_TEMPLATE`
- Existing secrets/tokens should be rotated after debugging sessions if they were exposed outside the platform.

## Remaining Validation

1. Secretary clicks a live appointment request link from WhatsApp.
2. Signs in.
3. Lands on the target appointment.
4. Assigns a doctor.
5. Confirms appointment.
6. Verify final WhatsApp/email confirmation fanout.
7. Verify staff WhatsApp rows move from `sent` to `delivered`, `read`, or `failed` in `notifications`.
