'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// ── Doctors ──────────────────────────────────────────────────────────────────

export async function addDoctor(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const name = (formData.get('name') as string)?.trim()
  const speciality = (formData.get('speciality') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const location = (formData.get('location') as string) || null
  const bio = (formData.get('bio') as string)?.trim() || null

  if (!name) return { error: 'Doctor name is required' }

  const { error } = await supabase.from('doctors').insert({
    name,
    speciality,
    phone,
    email,
    location,
    bio,
    is_active: true,
  })

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}

export async function updateDoctor(
  doctorId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const name = (formData.get('name') as string)?.trim()
  const speciality = (formData.get('speciality') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const location = (formData.get('location') as string) || null
  const bio = (formData.get('bio') as string)?.trim() || null

  if (!name) return { error: 'Doctor name is required' }

  const { error } = await supabase
    .from('doctors')
    .update({ name, speciality, phone, email, location, bio })
    .eq('id', doctorId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}

export async function deactivateDoctor(doctorId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('doctors')
    .update({ is_active: false })
    .eq('id', doctorId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}

export async function reactivateDoctor(doctorId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('doctors')
    .update({ is_active: true })
    .eq('id', doctorId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}

// ── On-Call Schedule ─────────────────────────────────────────────────────────

export async function addOnCallSchedule(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const doctor_id = formData.get('doctor_id') as string
  const start_date = formData.get('start_date') as string
  const end_date = formData.get('end_date') as string
  const is_primary = formData.get('is_primary') === 'true'

  if (!doctor_id || !start_date || !end_date) {
    return { error: 'Doctor, start date, and end date are required' }
  }

  if (end_date < start_date) {
    return { error: 'End date must be on or after start date' }
  }

  const { error } = await supabase.from('on_call_schedule').insert({
    doctor_id,
    start_date,
    end_date,
    is_primary,
  })

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}

export async function removeOnCallSchedule(scheduleId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('on_call_schedule')
    .delete()
    .eq('id', scheduleId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}

// ── Admin Users ───────────────────────────────────────────────────────────────

export async function inviteAdminUser(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const name = (formData.get('name') as string)?.trim()
  const role = (formData.get('role') as string) || 'staff'

  if (!email || !name) return { error: 'Email and name are required' }

  // Check if already exists
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id, is_active')
    .eq('email', email)
    .single()

  if (existing) {
    if (existing.is_active) return { error: 'This email is already registered as an admin user' }
    // Reactivate
    const { error } = await supabase
      .from('admin_users')
      .update({ name, role, is_active: true })
      .eq('id', existing.id)
    if (error) return { error: error.message }
    revalidatePath('/dashboard/settings')
    return {}
  }

  const { error } = await supabase.from('admin_users').insert({ email, name, role, is_active: true })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}

export async function deactivateAdminUser(userId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  // Safety: don't deactivate the current user
  const { data: { user } } = await supabase.auth.getUser()
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('email')
    .eq('id', userId)
    .single()

  if (adminUser?.email === user?.email) {
    return { error: 'You cannot deactivate your own account' }
  }

  const { error } = await supabase
    .from('admin_users')
    .update({ is_active: false })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings')
  return {}
}
