# Serenity Royale Hospital AI

## WhatsApp Patient Engagement and Appointment Operations MVP

Prepared for: Dr. Kunle Adesina
Prepared by: ODIADEV AI LTD
Date: May 2026
Document type: MVP product and deployment proposal

---

## 1. Executive Summary

Serenity Royale Hospital AI is a Phase 1 MVP built to help Serenity Royale Hospital manage patient communication and appointment requests through WhatsApp.

The system gives patients a familiar and low-friction way to contact the hospital. A patient can send a WhatsApp message, give consent for basic data handling, ask general questions, and book an appointment through a guided flow. Appointment requests are saved in a central database and surfaced in an admin dashboard for Serenity staff.

This proposal describes the capabilities currently available in the codebase and deployment setup. It does not present future ideas as completed work. Features that require further production verification or later expansion are listed separately.

The MVP is intended for controlled rollout, staff review, and live operational testing before broader patient promotion.

---

## 2. Current Operational Problem

Serenity Royale Hospital receives patient interest through informal and manual channels. This creates practical gaps:

- Patients may hesitate to call or visit in person when seeking sensitive help.
- WhatsApp conversations can become scattered across personal phones.
- Appointment requests may not be recorded in a structured system.
- Staff may not have one place to review pending patient requests.
- Appointment confirmations and follow-ups can depend on manual effort.
- Management has limited visibility into what the AI or front desk is handling.

For a mental health and rehabilitation hospital, speed, privacy, clarity, and follow-up are important. The MVP addresses the first layer of this problem: WhatsApp-based intake, appointment requests, staff visibility, and notification tracking.

---

## 3. What The MVP Does Today

### 3.1 WhatsApp Patient Interaction

The system uses Twilio WhatsApp for patient messaging.

Current capability:

- Receives inbound WhatsApp messages through a Twilio webhook.
- Queues inbound messages for processing.
- Sends patient replies back through Twilio WhatsApp.
- Supports a two-way WhatsApp conversation model.
- Uses Twilio-only messaging in the runtime flow.

Important note:

The MVP currently depends on Twilio configuration and message delivery limits. A production WhatsApp sender should be registered before broad public launch. The Twilio Sandbox is suitable for demo and controlled testing.

### 3.2 Consent Capture

The assistant asks first-time patients for consent before continuing.

Current capability:

- Sends a consent message to the patient.
- Records patient consent in the database.
- Allows the patient to continue after replying with consent.
- Gives a safe decline path by directing the patient to call the hospital.

### 3.3 Guided Appointment Booking

The appointment booking flow is deterministic. It does not rely on the AI model to collect the appointment details.

Current booking fields:

- Full name
- Sex/gender
- Location
- Service type
- Doctor preference
- Preferred date
- Preferred time
- Center: Karu or Galadimawa
- Optional email address
- Final confirmation

Current capability:

- Starts booking when the patient asks to book an appointment.
- Guides the patient step by step.
- Validates booking inputs.
- Saves the appointment request in Supabase.
- Marks uncertain bookings as pending.
- Confirms bookings only when the system has enough confidence that the slot is safe.
- Sends a WhatsApp response to the patient after submission.

### 3.4 Appointment Status Handling

The MVP supports appointment status tracking.

Supported statuses:

- Pending
- Confirmed
- Completed
- Cancelled
- No-show

Current rule:

- If doctor matching or calendar certainty is missing, the appointment remains pending for staff review.
- If the slot passes the checks available to the system, it can be marked confirmed.

This is intentional. It prevents the AI from over-promising appointment availability.

### 3.5 Staff Notifications

When an appointment request is submitted, the system can notify staff.

Current capability:

- Sends a staff WhatsApp alert through Twilio.
- Sends a staff email through the configured email provider.
- Logs notification attempts and outcomes.
- Includes appointment details such as patient name, phone, service, center, date, time, doctor preference, and status.

### 3.6 Patient Confirmation

The system can send confirmation or request-received messages to patients.

Current capability:

- Sends patient WhatsApp confirmation or request-received message.
- Sends patient email confirmation when the patient provides a valid email address and email is configured.
- Logs email and WhatsApp notification outcomes.

### 3.7 Google Calendar Sync

The system includes Google Calendar integration for appointment sync and availability checking.

Current capability:

- Uses Google Calendar service account authentication.
- Checks calendar conflicts through Google Calendar FreeBusy.
- Creates Google Calendar events when an appointment can be safely confirmed.
- Stores calendar sync status and errors in the appointment record.
- Keeps Supabase as the source of truth.

Important note:

Calendar sync is not presented as a guarantee for every appointment. If doctor matching, service account setup, calendar access, or availability certainty is missing, the appointment remains pending and staff should review it.

### 3.8 General AI Conversation

The assistant uses Groq for general non-booking conversations.

Current capability:

- Answers general hospital questions.
- Responds to service, cost, location, privacy, and safety-boundary questions using a hybrid approach.
- Uses deterministic templates for sensitive topics.
- Uses conversational AI for lower-risk general questions.

Important note:

The AI does not diagnose patients, prescribe medication, guarantee availability, or replace a clinician.

### 3.9 Emergency and Crisis Handling

The system includes emergency keyword detection and emergency alert workflows.

Current capability:

- Detects crisis or emergency language.
- Sends a supportive safety response to the patient.
- Creates an emergency alert record.
- Notifies configured hospital contacts.
- Allows staff to acknowledge and resolve alerts from the dashboard.
- Includes escalation logic for unacknowledged alerts.

Important note:

This does not replace emergency medical services or clinical triage. It is an alerting and routing aid.

### 3.10 Appointment Reminders and Feedback

The codebase includes appointment reminder and feedback functions.

Current capability:

- Supports 1-week appointment reminders.
- Supports 24-hour appointment reminders.
- Supports manual reminder trigger from the dashboard.
- Supports feedback request after completed appointments.
- Stores patient feedback when received.

Important note:

Reminder reliability depends on cron scheduling, Twilio delivery, and production environment configuration. This should be verified during controlled rollout before making a public guarantee.

---

## 4. Admin Dashboard

The admin dashboard gives Serenity staff a web interface for managing patient operations.

Current dashboard capability:

- Login-protected staff dashboard.
- Dashboard overview with AI operations status.
- Pending WhatsApp appointment requests.
- Appointment list and filters.
- Appointment source visibility.
- Calendar sync status visibility.
- WhatsApp and email notification status visibility.
- Staff actions for appointments:
  - Confirm
  - Cancel
  - Mark completed
  - Mark no-show
  - Send reminder
- Patient list and patient detail pages.
- Conversation history view.
- Emergency alert page with acknowledge and resolve actions.
- Audit log page.
- CSV export routes for patient and appointment records.
- Settings page for doctors, on-call schedule, stack readiness, and system information.

The dashboard is designed as an operations console, not a marketing page.

---

## 5. Current System Components

| Component | Current technology | Current function |
|---|---|---|
| Patient messaging | Twilio WhatsApp | Receives and sends WhatsApp messages |
| Inbound webhook | Supabase Edge Function | Receives Twilio webhook posts and queues messages |
| AI assistant | Supabase Edge Function | Processes messages, handles consent, booking, templates, and general AI |
| Database | Supabase PostgreSQL | Stores patients, appointments, conversations, notifications, booking sessions, alerts, and audit data |
| Admin dashboard | Next.js on Vercel | Staff interface for operations |
| General AI | Groq | Handles lower-risk general conversation |
| Email | Resend-compatible HTTP email helper | Sends staff and patient email notifications |
| Calendar | Google Calendar API | Checks conflicts and creates events when safe |
| Voice transcription | Deepgram helper exists | Supports transcription workflow where configured |

---

## 6. Implementation Status

| Area | Status | Honest description |
|---|---|---|
| WhatsApp two-way messaging | Built and tested in demo flow | Works through Twilio when webhook and secrets are configured |
| Consent capture | Built | Records consent before continuing |
| Appointment booking | Built | Deterministic flow saves appointment requests |
| Staff WhatsApp alert | Built | Sends configured staff alerts through Twilio |
| Staff email | Built | Sends through configured email provider |
| Patient email | Built | Sends if patient gives email and email provider is configured |
| Dashboard appointments | Built | Staff can review and act on appointments |
| Dashboard emergency actions | Built | Staff can acknowledge and resolve alerts |
| Google Calendar sync | Built | Works when service account and calendar are correctly configured |
| General AI conversation | Built | Uses Groq for non-booking general support |
| Reminders and feedback | Built in code | Requires production cron verification before public promise |
| Advanced analytics | Basic dashboard analytics exist | Not a mature analytics/reporting product yet |
| Post-discharge automation | Not part of Phase 1 MVP | Can be Phase 2 |
| EHR/billing integration | Not included | Can be Phase 2 |

---

## 7. What Is Not Included In Phase 1

To avoid false promises, the following are not included as completed Phase 1 commitments:

- Full electronic health record integration.
- Billing system integration.
- Insurance processing.
- Diagnosis or medication advice.
- Fully automated clinical triage.
- Fully automated rescheduling without staff review.
- Guaranteed 24/7 human monitoring.
- Mature business intelligence analytics.
- Public-scale performance guarantee.
- Production WhatsApp Business sender approval, unless completed separately.
- Hospital-wide post-discharge care automation.
- Automatic guarantee that every appointment is calendar-confirmed.
- Replacement of front-desk staff or clinicians.

---

## 8. Benefits To Serenity Royale Hospital

The MVP gives Serenity Royale Hospital a practical first step toward AI-assisted patient operations.

Expected benefits:

- Patients can start the booking process through WhatsApp.
- Sensitive inquiries can be handled in a calmer, lower-friction channel.
- Staff can see appointment requests in one dashboard.
- Staff can be notified when new appointment requests arrive.
- Patient confirmations can be sent by WhatsApp and email.
- Calendar status is visible instead of hidden.
- Emergency language can be flagged for human attention.
- The hospital gets a structured record of patient interactions and requests.

These benefits should be measured during controlled rollout before making stronger ROI claims.

---

## 9. Deployment Approach

The recommended rollout is controlled and staged.

### Stage 1: Final Configuration

- Confirm Twilio WhatsApp sender setup.
- Confirm Supabase environment secrets.
- Confirm Groq API configuration.
- Confirm Resend sender/domain.
- Confirm Google Calendar service account access.
- Confirm staff WhatsApp recipient and staff email recipients.
- Confirm hospital service menu and doctor list.

### Stage 2: Staff Testing

- Test new patient consent.
- Test appointment booking.
- Test staff WhatsApp notification.
- Test staff email notification.
- Test patient email confirmation.
- Test dashboard appointment visibility.
- Test staff confirmation from dashboard.
- Test calendar sync status.
- Test emergency alert and dashboard acknowledgement.

### Stage 3: Controlled Pilot

- Use with a limited number of real patient interactions.
- Review all appointment requests daily.
- Track failed notifications.
- Track calendar sync errors.
- Collect staff feedback.
- Adjust prompts, service menu, and operational workflow.

### Stage 4: Wider Patient Promotion

Only after the controlled pilot is stable should the hospital promote the WhatsApp AI assistant publicly on the website, social pages, flyers, and ads.

---

## 10. Pricing

The proposed pricing is:

| Item | Amount |
|---|---:|
| One-time setup and deployment fee | ₦700,000 |
| Monthly maintenance and support | ₦60,000/month |

### What The Setup Fee Covers

- Final deployment configuration.
- Hospital-specific service menu setup.
- Staff dashboard access setup.
- Twilio WhatsApp workflow configuration.
- Supabase function and database setup support.
- Google Calendar connection support.
- Email notification setup support.
- Staff orientation for the dashboard and appointment workflow.
- Controlled go-live testing.

### What Monthly Maintenance Covers

- Basic system monitoring.
- Bug fixes for the implemented MVP features.
- Minor workflow adjustments.
- Dashboard and function maintenance.
- Notification and calendar troubleshooting support.
- Security and dependency review as part of ongoing maintenance.

### Third-Party Costs Not Included

The monthly maintenance fee does not include third-party usage fees, such as:

- Twilio WhatsApp/SMS charges.
- Groq AI usage.
- Supabase paid plan or overage.
- Vercel paid plan or overage.
- Resend email usage above free/covered limits.
- Google Cloud usage, if any.
- WhatsApp Business verification, template approval, or sender registration fees.
- Domain, hosting, or DNS costs outside the agreed system.

---

## 11. Commercial Terms

### Payment

- 50% of the setup fee is due before final deployment work begins.
- 50% of the setup fee is due before production handover.
- Monthly maintenance is billed at the beginning of each month.

### Ownership

- Patient data belongs to Serenity Royale Hospital.
- ODIADEV AI LTD provides the software system and managed technical service.
- Source code ownership and licensing should be documented in the final service agreement.

### Data Handling

- Patient data must be handled according to applicable Nigerian data protection requirements.
- Staff access should be limited to authorised hospital users.
- Data exports should be handled carefully and only for authorised purposes.

### Support Boundary

ODIADEV AI LTD supports the technical system. Clinical decisions, patient care decisions, emergency response, and appointment approval remain the responsibility of Serenity Royale Hospital staff.

---

## 12. Recommended Approval Path

Before public launch, Serenity Royale Hospital should approve:

- Final WhatsApp greeting and consent wording.
- Service menu.
- Staff notification recipients.
- Calendar ownership and access.
- Appointment confirmation policy.
- Emergency alert handling process.
- Dashboard staff users.
- Data protection and access policy.

Once these are approved, the system can move into controlled pilot operation.

---

## 13. Conclusion

Serenity Royale Hospital AI is a real Phase 1 MVP with working WhatsApp patient intake, consent capture, appointment booking, staff notifications, calendar sync logic, email notifications, and an admin dashboard.

The right next step is not to claim that the system is a complete hospital automation platform. The right next step is to deploy it honestly as a controlled WhatsApp AI receptionist and appointment operations system, prove it with real usage, and then expand based on Serenity Royale Hospital's operational needs.

This gives the hospital immediate value while protecting patient trust, clinical safety, and business credibility.
