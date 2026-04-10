'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'

type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

export async function updateAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard')
  return {}
}

export async function cancelAppointment(appointmentId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  // Get calendar event ID before cancelling
  const { data: appt } = await supabase
    .from('appointments')
    .select('google_calendar_event_id')
    .eq('id', appointmentId)
    .single()

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  // Cancel Google Calendar event if linked (non-fatal)
  if (appt?.google_calendar_event_id) {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl && serviceKey) {
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'appointment_cancellation',
            calendarEventId: appt.google_calendar_event_id,
          }),
        })
      }
    } catch {
      // Non-fatal — appointment is cancelled in DB regardless
    }
  }

  revalidatePath('/dashboard/appointments')
  revalidatePath('/dashboard')
  return {}
}

export async function sendManualReminder(
  appointmentId: string,
  reminderType: '24h' | '1week',
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: appt } = await supabase
    .from('appointments')
    .select('*, patients(name, phone_number), doctors(name)')
    .eq('id', appointmentId)
    .single()

  if (!appt) return { error: 'Appointment not found' }

  const patient = appt.patients as { name?: string; phone_number?: string } | null
  const doctor = appt.doctors as { name?: string } | null
  const phone = patient?.phone_number?.replace('+', '')

  if (!phone) return { error: 'Patient has no phone number' }

  // Import WhatsApp helpers via Edge Function to avoid exposing API token
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) return { error: 'Service not configured' }

  const res = await fetch(`${supabaseUrl}/functions/v1/appointment-reminder`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      manual: true,
      appointmentId,
      reminderType,
      phone,
      patientName: patient?.name ?? 'Patient',
      appointmentDate: appt.appointment_date,
      appointmentTime: appt.appointment_time?.slice(0, 5) ?? '09:00',
      center: appt.center ?? 'Galadimawa',
      doctorName: doctor?.name ?? 'Dr. Kunle Adesina',
    }),
  })

  if (!res.ok) return { error: 'Failed to send reminder' }

  // Mark the reminder as sent
  const updateField = reminderType === '24h' ? 'reminder_24h_sent' : 'reminder_1week_sent'
  await supabase.from('appointments').update({ [updateField]: true }).eq('id', appointmentId)

  revalidatePath('/dashboard/appointments')
  return {}
}
