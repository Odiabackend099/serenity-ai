'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function updatePatient(
  patientId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const name = (formData.get('name') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const age = formData.get('age') ? parseInt(formData.get('age') as string, 10) : null
  const gender = (formData.get('gender') as string) || null
  const location = (formData.get('location') as string)?.trim() || null

  const { error } = await supabase
    .from('patients')
    .update({ name, email, age: isNaN(age as number) ? null : age, gender, location })
    .eq('id', patientId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/patients/${patientId}`)
  revalidatePath('/dashboard/patients')
  return {}
}

export async function sendManualMessage(
  patientId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const message = (formData.get('message') as string)?.trim()
  if (!message) return { error: 'Message cannot be empty' }

  // Get patient phone number
  const { data: patient } = await supabase
    .from('patients')
    .select('phone_number')
    .eq('id', patientId)
    .single()

  if (!patient?.phone_number) return { error: 'Patient has no phone number' }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) return { error: 'Service not configured' }

  const phone = patient.phone_number.replace('+', '')

  const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'manual_message',
      phone,
      message,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { error: `Failed to send message${body ? `: ${body}` : ''}` }
  }

  // Log the outbound message as a conversation record
  await supabase.from('conversations').insert({
    patient_id: patientId,
    message_type: 'text',
    patient_message: null,
    ai_response: `[Admin manual message] ${message}`,
    sentiment: null,
    has_emergency_keywords: false,
  })

  revalidatePath(`/dashboard/patients/${patientId}`)
  return {}
}

export async function requestPatientDeletion(
  patientId: string,
  reason: string,
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.from('deletion_requests').insert({
    patient_id: patientId,
    request_type: 'full_deletion',
    reason: reason || 'Admin-initiated deletion',
    status: 'pending',
  })

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/patients/${patientId}`)
  return {}
}
