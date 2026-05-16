# Dashboard Action Inventory

Purpose: prevent dead dashboard controls from shipping. Every visible control must be working, explicitly disabled with a staff-readable explanation, or hidden by role.

## Regression Gate

Run before release:

```bash
npm run type-check -w apps/admin-dashboard
npm run lint -w apps/admin-dashboard
npm run test:unit
npm run test:integration
npm run build -w apps/admin-dashboard
npm run test:smoke
```

Live WhatsApp sends are not part of the default gate. Use a mock Edge Function base URL for mutation tests. Run live smoke only with `RUN_LIVE_SMOKE=1` and a dedicated test recipient.

## Action Checklist

| Area | Control | Expected behavior | Coverage |
| --- | --- | --- | --- |
| Sidebar | Open navigation menu | Opens mobile navigation | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Sidebar | Close navigation menu | Closes mobile navigation | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Sidebar | Collapse navigation | Collapses desktop navigation | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Sidebar | Main page links | Navigate to Today, Bookings, Urgent Messages, Patients, Patient Chats | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Sidebar | Management links | Super admin sees Reports, Hospital Setup, Activity History; other staff are redirected | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Bookings | View tabs | Upcoming, Waiting, Confirmed, WhatsApp bookings, Schedule check, Past, All filter the list | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Bookings | Download list | Opens `/api/export/appointments` | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Bookings | Confirm booking | Requires doctor, confirms appointment, sends updates, shows notice | `apps/admin-dashboard/lib/appointment-actions-flow.integration.test.ts` |
| Bookings | Resend updates | Reuses confirmation fanout and shows success or resend-needed notice | `apps/admin-dashboard/lib/appointment-actions-flow.integration.test.ts` |
| Bookings | Send 1-week reminder | Calls `appointment-reminder`, marks sent fields only after success | `apps/admin-dashboard/lib/appointment-reminder-flow.test.ts` |
| Bookings | Send 24-hour reminder | Calls `appointment-reminder`, marks sent fields only after success | `apps/admin-dashboard/lib/appointment-reminder-flow.test.ts` |
| Bookings | Send 2-hour reminder | Calls `appointment-reminder`, marks sent fields only after success | `apps/admin-dashboard/lib/appointment-reminder-flow.test.ts` |
| Bookings | Mark completed | Saves completed status and shows notice | Manual QA until seeded mutation smoke is enabled |
| Bookings | Mark did not attend | Saves did-not-attend status and shows notice | Manual QA until seeded mutation smoke is enabled |
| Bookings | Cancel booking | Saves cancelled status and sends cancellation update when linked | Manual QA until seeded mutation smoke is enabled |
| Urgent Messages | Mark seen | Saves acknowledged state and shows notice | Server action guard plus smoke page coverage |
| Urgent Messages | Mark resolved | Saves resolved state and response notes, then shows notice | Server action guard plus smoke page coverage |
| Patients | Search | Filters patients by text | Smoke page coverage |
| Patients | Pagination | Moves through patient pages | Smoke page coverage |
| Patient detail | Save Changes | Saves patient details and shows notice | Server action guard plus smoke page coverage |
| Patient detail | Send manual WhatsApp message | Sends via `send-notification`, logs conversation, shows notice | Server action guard plus smoke page coverage |
| Patient detail | Request Deletion | Creates deletion request and shows notice | Server action guard plus smoke page coverage |
| Patient detail | Conversation pagination | Moves through conversation history | Smoke page coverage |
| Patient Chats | Search | Filters conversations | Smoke page coverage |
| Patient Chats | Pagination | Moves through conversation pages | Smoke page coverage |
| Hospital Setup | Doctor add/update/deactivate/reactivate | Super-admin only, saves and shows notice | Server action guard plus smoke page coverage |
| Hospital Setup | On-call add/remove | Super-admin only, validates dates and shows notice | Server action guard plus smoke page coverage |
| Hospital Setup | Staff add/deactivate | Super-admin only, blocks self-deactivation and shows notice | Server action guard plus smoke page coverage |
| Hospital Setup | Copy link | Copies the Dr. Adekunle AI WhatsApp link or shows copy failure | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Hospital Setup | Download QR | Downloads printable QR PNG | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Hospital Setup | Print QR | Opens printable QR view | `tests/smoke/dashboard-auth.smoke.spec.ts` |
| Activity History | Filters | Filter audit history by resource/action | Smoke page coverage |
| Activity History | Pagination | Moves through audit pages | Smoke page coverage |
| Activity History | Downloads | Export endpoints stay protected by auth | Smoke/export smoke coverage |

## Reminder Contract

- Manual reminder types are `1week`, `24h`, and `2h`.
- Dashboard buttons call `appointment-reminder` through the shared Edge Function caller.
- The dashboard updates reminder sent fields only after the Edge Function returns success.
- Provider or function failures show staff-readable notices and do not mark the reminder as sent.
- The default test suite validates the payload and state-update contract without sending live WhatsApp messages.
