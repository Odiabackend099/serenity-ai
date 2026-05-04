'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// ── Doctors ──────────────────────────────────────────────────────────────────

export async function addDoctor(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const name = (formData.get('name') as string)?.trim()
  const speciality = (formData.get('speciality') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const location = (formData.get('location') as string) || null
  const bio = (formData.get('bio') as string)?.trim() || null

  if (!name) return

  const { error } = await supabase.from('doctors').insert({
    name,
    speciality,
    phone,
    email,
    location,
    bio,
    is_active: true,
  })

  if (error) {
    console.error('[settings] add doctor failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}

export async function updateDoctor(
  doctorId: string,
  formData: FormData,
): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const name = (formData.get('name') as string)?.trim()
  const speciality = (formData.get('speciality') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const location = (formData.get('location') as string) || null
  const bio = (formData.get('bio') as string)?.trim() || null

  if (!name) return

  const { error } = await supabase
    .from('doctors')
    .update({ name, speciality, phone, email, location, bio })
    .eq('id', doctorId)

  if (error) {
    console.error('[settings] update doctor failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}

export async function deactivateDoctor(doctorId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('doctors')
    .update({ is_active: false })
    .eq('id', doctorId)

  if (error) {
    console.error('[settings] deactivate doctor failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}

export async function reactivateDoctor(doctorId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('doctors')
    .update({ is_active: true })
    .eq('id', doctorId)

  if (error) {
    console.error('[settings] reactivate doctor failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}

// ── On-Call Schedule ─────────────────────────────────────────────────────────

export async function addOnCallSchedule(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const doctor_id = formData.get('doctor_id') as string
  const start_date = formData.get('start_date') as string
  const end_date = formData.get('end_date') as string
  const is_primary = formData.get('is_primary') === 'true'

  if (!doctor_id || !start_date || !end_date) {
    return
  }

  if (end_date < start_date) {
    return
  }

  const { error } = await supabase.from('on_call_schedule').insert({
    doctor_id,
    start_date,
    end_date,
    is_primary,
  })

  if (error) {
    console.error('[settings] add on-call failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}

export async function removeOnCallSchedule(scheduleId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('on_call_schedule')
    .delete()
    .eq('id', scheduleId)

  if (error) {
    console.error('[settings] remove on-call failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}

// ── Admin Users ───────────────────────────────────────────────────────────────

export async function inviteAdminUser(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const name = (formData.get('name') as string)?.trim()
  const role = (formData.get('role') as string) || 'staff'

  if (!email || !name) return

  // Check if already exists
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id, is_active')
    .eq('email', email)
    .single()

  if (existing) {
    if (existing.is_active) return
    // Reactivate
    const { error } = await supabase
      .from('admin_users')
      .update({ name, role, is_active: true })
      .eq('id', existing.id)
    if (error) {
      console.error('[settings] reactivate admin failed:', error.message)
      return
    }
    revalidatePath('/dashboard/settings')
    return
  }

  const { error } = await supabase.from('admin_users').insert({ email, name, role, is_active: true })
  if (error) {
    console.error('[settings] invite admin failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}

export async function deactivateAdminUser(userId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  // Safety: don't deactivate the current user
  const { data: { user } } = await supabase.auth.getUser()
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('email')
    .eq('id', userId)
    .single()

  if (adminUser?.email === user?.email) {
    return
  }

  const { error } = await supabase
    .from('admin_users')
    .update({ is_active: false })
    .eq('id', userId)

  if (error) {
    console.error('[settings] deactivate admin failed:', error.message)
    return
  }

  revalidatePath('/dashboard/settings')
}
