/**
 * Email notification helper using Gmail SMTP via nodemailer-like fetch approach.
 * For Deno/Edge Functions: uses the SMTP API directly via fetch (no nodemailer).
 * We use Resend or SMTP2GO as the actual transport to avoid direct SMTP in Edge Functions.
 *
 * Primary: SMTP via external relay (configured in env)
 * Template-based for all hospital notifications.
 */

const HOSPITAL_NAME = 'Serenity Royale Hospital'
const HOSPITAL_EMAIL = Deno.env.get('SMTP_USER') ?? 'info@serenityroyalehospital.com'
const HOSPITAL_PHONE = '+234 806 219 7384'

interface EmailPayload {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

/**
 * Send an email via SMTP relay API.
 * Uses SMTP2GO HTTP API (simpler than direct SMTP in Deno Edge Functions).
 */
async function sendEmail(payload: EmailPayload): Promise<void> {
  const smtp2goKey = Deno.env.get('SMTP_API_KEY')
  const smtpHost = Deno.env.get('SMTP_HOST')

  if (smtp2goKey) {
    // SMTP2GO HTTP API
    const res = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: smtp2goKey,
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        sender: `${HOSPITAL_NAME} <${HOSPITAL_EMAIL}>`,
        subject: payload.subject,
        html_body: payload.html,
        text_body: payload.text ?? payload.subject,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`SMTP2GO API error: ${err}`)
    }
    return
  }

  if (smtpHost) {
    // Fallback: Gmail SMTP via Supabase's built-in email (if configured)
    // This path would be used if SMTP credentials are set but no SMTP2GO key
    console.warn('[email] SMTP direct not supported in Edge Functions. Set SMTP_API_KEY for SMTP2GO.')
    return
  }

  console.error('[email] No email transport configured. Set SMTP_API_KEY (SMTP2GO) or SMTP_HOST.')
}

/**
 * Notify hospital admin of a new emergency alert.
 */
export async function sendEmergencyAlertEmail(params: {
  patientName: string
  patientPhone: string
  alertType: string
  severity: string
  keywords: string[]
  messageSnippet: string
  timestamp: string
}): Promise<void> {
  const adminEmail = Deno.env.get('HOSPITAL_EMAIL') ?? 'info@serenityroyalehospital.com'
  const drAdesinEmail = Deno.env.get('MD_EMAIL') ?? adminEmail

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">🚨 EMERGENCY ALERT — Immediate Attention Required</h1>
        <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${HOSPITAL_NAME}</p>
      </div>
      <div style="padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-top: none;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; font-weight: bold; color: #374151; width: 140px;">Patient</td><td style="padding: 8px 0; color: #111827;">${params.patientName || 'Unknown'}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; color: #374151;">Phone</td><td style="padding: 8px 0; color: #111827;">${params.patientPhone}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; color: #374151;">Alert Type</td><td style="padding: 8px 0; color: #dc2626; font-weight: bold; text-transform: capitalize;">${params.alertType.replace('_', ' ')}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; color: #374151;">Severity</td><td style="padding: 8px 0; color: #dc2626; font-weight: bold; text-transform: uppercase;">${params.severity}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; color: #374151;">Keywords</td><td style="padding: 8px 0; color: #374151;">${params.keywords.join(', ')}</td></tr>
          <tr><td style="padding: 8px 0; font-weight: bold; color: #374151;">Time</td><td style="padding: 8px 0; color: #374151;">${params.timestamp}</td></tr>
        </table>
        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 16px 0; border-radius: 0 4px 4px 0;">
          <p style="margin: 0; font-size: 13px; color: #7f1d1d; font-style: italic;">"${params.messageSnippet}"</p>
        </div>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-top: 16px;">
          <p style="margin: 0 0 8px; font-weight: bold; color: #111827;">Required Actions:</p>
          <ol style="margin: 0; padding-left: 20px; color: #374151; font-size: 14px;">
            <li>Call patient immediately: <strong>${params.patientPhone}</strong></li>
            <li>Log into admin dashboard to acknowledge this alert</li>
            <li>Follow emergency escalation protocol</li>
          </ol>
        </div>
        <p style="margin: 20px 0 0; font-size: 12px; color: #9ca3af;">
          This is an automated alert from Serenity AI. Log in at your admin dashboard to manage this alert.
        </p>
      </div>
    </div>
  `

  await sendEmail({
    to: [adminEmail, drAdesinEmail].filter((v, i, a) => a.indexOf(v) === i),
    subject: `🚨 EMERGENCY: ${params.alertType.replace('_', ' ').toUpperCase()} — ${params.patientName || params.patientPhone}`,
    html,
  })
}

/**
 * Send daily appointment list to the MD.
 */
export async function sendDailyAppointmentList(params: {
  date: string
  appointments: Array<{
    time: string
    patientName: string
    serviceType: string
    center: string
    doctorName: string
    status: string
  }>
}): Promise<void> {
  const mdEmail = Deno.env.get('MD_EMAIL') ?? Deno.env.get('HOSPITAL_EMAIL') ?? 'info@serenityroyalehospital.com'

  const appointmentRows = params.appointments.length > 0
    ? params.appointments.map((a) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${a.time}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${a.patientName}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; text-transform: capitalize;">${a.serviceType?.replace('_', ' ')}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${a.center}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${a.doctorName}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">
            <span style="background: ${a.status === 'confirmed' ? '#d1fae5' : '#fef3c7'}; color: ${a.status === 'confirmed' ? '#065f46' : '#92400e'}; padding: 2px 8px; border-radius: 9999px; font-size: 12px;">${a.status}</span>
          </td>
        </tr>
      `).join('')
    : '<tr><td colspan="6" style="padding: 24px; text-align: center; color: #9ca3af;">No appointments scheduled for today</td></tr>'

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
      <div style="background: #0f4c75; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 18px;">📅 Daily Appointment Schedule</h1>
        <p style="margin: 4px 0 0; opacity: 0.8; font-size: 14px;">${params.date} · ${HOSPITAL_NAME}</p>
      </div>
      <div style="padding: 0; background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <div style="padding: 16px 20px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 14px; color: #374151;">Total: <strong>${params.appointments.length} appointment${params.appointments.length !== 1 ? 's' : ''}</strong></p>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Time</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Patient</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Service</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Center</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Doctor</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Status</th>
            </tr>
          </thead>
          <tbody>${appointmentRows}</tbody>
        </table>
        <div style="padding: 16px 20px; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 12px; color: #9ca3af;">Generated by Serenity AI at ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} WAT</p>
        </div>
      </div>
    </div>
  `

  await sendEmail({
    to: mdEmail,
    subject: `📅 Appointments for ${params.date} — ${params.appointments.length} scheduled`,
    html,
  })
}

/**
 * Send appointment confirmation email to patient (if email provided).
 */
export async function sendAppointmentConfirmationEmail(params: {
  patientEmail: string
  patientName: string
  appointmentDate: string
  appointmentTime: string
  center: string
  centerAddress: string
  doctorName: string
  serviceType: string
}): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0f766e; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 18px;">✅ Appointment Confirmed</h1>
        <p style="margin: 4px 0 0; opacity: 0.8; font-size: 14px;">${HOSPITAL_NAME}</p>
      </div>
      <div style="padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px; color: #111827;">Dear ${params.patientName},</p>
        <p style="color: #374151;">Your appointment has been confirmed. Here are your details:</p>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; margin: 16px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; font-weight: bold; color: #374151; width: 140px;">Date</td><td style="padding: 6px 0; color: #111827;">${params.appointmentDate}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: bold; color: #374151;">Time</td><td style="padding: 6px 0; color: #111827;">${params.appointmentTime}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: bold; color: #374151;">Doctor</td><td style="padding: 6px 0; color: #111827;">${params.doctorName}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: bold; color: #374151;">Service</td><td style="padding: 6px 0; color: #111827; text-transform: capitalize;">${params.serviceType.replace('_', ' ')}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: bold; color: #374151;">Center</td><td style="padding: 6px 0; color: #111827;">${params.center}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: bold; color: #374151;">Address</td><td style="padding: 6px 0; color: #111827;">${params.centerAddress}</td></tr>
          </table>
        </div>
        <p style="color: #374151; font-size: 14px;">Please arrive 10–15 minutes early. If you need to reschedule, send us a WhatsApp message.</p>
        <p style="color: #374151; font-size: 14px;">📞 ${HOSPITAL_PHONE} · 📧 ${HOSPITAL_EMAIL}</p>
        <p style="margin-top: 24px; font-size: 12px; color: #9ca3af;">Serenity Royale Hospital — Every life is valuable.</p>
      </div>
    </div>
  `

  await sendEmail({
    to: params.patientEmail,
    subject: `Appointment Confirmed — ${params.appointmentDate} at ${params.appointmentTime}`,
    html,
  })
}
