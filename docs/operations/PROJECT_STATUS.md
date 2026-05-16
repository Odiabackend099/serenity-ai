# Serenity AI Status

## Objective

Serenity AI should behave like a real hospital WhatsApp assistant:

- reply on the live Meta number
- check availability before promising a slot
- save appointments safely in Supabase
- notify staff with a direct dashboard link
- let staff assign doctors and confirm appointments from the dashboard

## Completed

- Live Meta number is connected and replying again.
- Unified webhook supports Meta live traffic and Twilio fallback.
- Deterministic availability layer is live:
  - no Sundays
  - no past slots
  - no outside-hours slots
  - 3 closest alternatives when unavailable
- Slot holds and atomic final booking checks are in place.
- `"Any available doctor"` now stays unassigned and creates a proper appointment request.
- Secretary and Dr K receive the appointment request with a dashboard link.
- Public dashboard link no longer 404s.
- Login now preserves the target appointment link after sign-in.
- Admin access was reduced to exactly 2 live users:
  - secretary `admin`
  - doctor `super_admin`

## Next Validation

1. Secretary opens the WhatsApp dashboard link.
2. Secretary signs in and lands on the target appointment.
3. Secretary selects a doctor and confirms the appointment.
4. Verify confirmation notifications to:
   - patient
   - secretary
   - Dr K
   - assigned doctor

## Known Operational Notes

- Public dashboard hostname is currently pinned to the latest ready Vercel deployment.
- Direct Vercel production deployment still needs cleanup because Vercel blocks some promotions based on commit-author policy.
- Passwords and tokens must stay out of repo docs.
