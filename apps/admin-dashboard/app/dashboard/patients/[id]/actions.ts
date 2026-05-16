'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { callInternalEdgeFunction } from '@/lib/edge-functions'
import { DashboardActionError, requireDashboardUser, type DashboardRole } from '@/lib/dashboard-action-auth'

const PATIENT_EDIT_ROLES: DashboardRole[] = ['super_admin', 'admin', 'doctor', 'nurse', 'staff']
const PATIENT_DELETION_ROLES: DashboardRole[] = ['super_admin', 'admin', 'dpo']

function patientNoticeUrl(patientId: string, notice: string): string {
  return `/dashboard/patients/${encodeURIComponent(patientId)}?notice=${encodeURIComponent(notice)}`
}

async function requirePatientActionUser(patientId: string, allowedRoles: DashboardRole[]) {
  try {
    return await requireDashboardUser(allowedRoles)
  } catch (err) {
    if (err instanceof DashboardActionError) {
      console.error(`[patients] action blocked (${err.code}):`, err.message)
      redirect(patientNoticeUrl(patientId, err.code === 'not_authenticated' ? 'not-signed-in' : 'not-authorized'))
    }
    throw err
  }
}

export async function updatePatient(
  patientId: string,
  formData: FormData,
): Promise<void> {
  const { supabase } = await requirePatientActionUser(patientId, PATIENT_EDIT_ROLES)

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
    redirect(patientNoticeUrl(patientId, 'could-not-save'))
  }

  revalidatePath(`/dashboard/patients/${patientId}`)
  revalidatePath('/dashboard/patients')
  redirect(patientNoticeUrl(patientId, 'patient-updated'))
}

export async function sendManualMessage(
  patientId: string,
  formData: FormData,
): Promise<void> {
  const { supabase } = await requirePatientActionUser(patientId, PATIENT_EDIT_ROLES)

  const message = (formData.get('message') as string)?.trim()
  if (!message) redirect(patientNoticeUrl(patientId, 'message-empty'))

  // Get patient phone number
  const { data: patient } = await supabase
    .from('patients')
    .select('phone_number')
    .eq('id', patientId)
    .single()

  if (!patient?.phone_number) redirect(patientNoticeUrl(patientId, 'missing-phone'))

  const phone = patient.phone_number.replace(/[^\d]/g, '')

  const res = await callInternalEdgeFunction('send-notification', {
    type: 'manual_message',
    phone,
    message,
  })

  if (!res) redirect(patientNoticeUrl(patientId, 'message-unavailable'))

  if (!res.ok) {
    console.error(`[patients] manual message failed${res.errorText ? `: ${res.errorText}` : ''}`)
    redirect(patientNoticeUrl(patientId, 'message-failed'))
  }

  // Log the outbound message as a conversation record
  const { error: logError } = await supabase.from('conversations').insert({
    patient_id: patientId,
    message_type: 'text',
    patient_message: null,
    ai_response: `[Admin manual message] ${message}`,
    sentiment: null,
    has_emergency_keywords: false,
  })

  if (logError) {
    console.error('[patients] manual message conversation log failed:', logError.message)
  }

  revalidatePath(`/dashboard/patients/${patientId}`)
  redirect(patientNoticeUrl(patientId, 'message-sent'))
}

export async function requestPatientDeletion(
  patientId: string,
  reason: string,
): Promise<void> {
  const { supabase } = await requirePatientActionUser(patientId, PATIENT_DELETION_ROLES)

  const { error } = await supabase.from('deletion_requests').insert({
    patient_id: patientId,
    request_type: 'full_deletion',
    reason: reason || 'Admin-initiated deletion',
    status: 'pending',
  })

  if (error) {
    console.error('[patients] deletion request failed:', error.message)
    redirect(patientNoticeUrl(patientId, 'could-not-save'))
  }

  revalidatePath(`/dashboard/patients/${patientId}`)
  redirect(patientNoticeUrl(patientId, 'deletion-requested'))
}
