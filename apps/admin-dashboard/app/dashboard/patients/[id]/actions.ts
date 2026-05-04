'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function updatePatient(
  patientId: string,
  formData: FormData,
): Promise<void> {
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

  if (error) {
    console.error('[patients] update failed:', error.message)
    return
  }

  revalidatePath(`/dashboard/patients/${patientId}`)
  revalidatePath('/dashboard/patients')
}

export async function sendManualMessage(
  patientId: string,
  formData: FormData,
): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const message = (formData.get('message') as string)?.trim()
  if (!message) return

  // Get patient phone number
  const { data: patient } = await supabase
    .from('patients')
    .select('phone_number')
    .eq('id', patientId)
    .single()

  if (!patient?.phone_number) return

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) return

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
    console.error(`[patients] manual message failed${body ? `: ${body}` : ''}`)
    return
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
}

export async function requestPatientDeletion(
  patientId: string,
  reason: string,
): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.from('deletion_requests').insert({
    patient_id: patientId,
    request_type: 'full_deletion',
    reason: reason || 'Admin-initiated deletion',
    status: 'pending',
  })

  if (error) {
    console.error('[patients] deletion request failed:', error.message)
    return
  }

  revalidatePath(`/dashboard/patients/${patientId}`)
}
