'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { DashboardActionError, requireRole } from '@/lib/dashboard-action-auth'

const SETTINGS_ROLES = ['super_admin'] as const

function settingsNoticeUrl(notice: string): string {
  return `/dashboard/settings?notice=${encodeURIComponent(notice)}`
}

async function requireSettingsUser() {
  try {
    return await requireRole(SETTINGS_ROLES)
  } catch (err) {
    if (err instanceof DashboardActionError) {
      console.error(`[settings] action blocked (${err.code}):`, err.message)
      redirect(settingsNoticeUrl(err.code === 'not_authenticated' ? 'not-signed-in' : 'not-authorized'))
    }
    throw err
  }
}

// ── Doctors ──────────────────────────────────────────────────────────────────

export async function addDoctor(formData: FormData): Promise<void> {
  const { supabase } = await requireSettingsUser()

  const name = (formData.get('name') as string)?.trim()
  const speciality = (formData.get('speciality') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const location = (formData.get('location') as string) || null
  const bio = (formData.get('bio') as string)?.trim() || null

  if (!name) redirect(settingsNoticeUrl('doctor-missing-name'))

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
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('doctor-added'))
}

export async function updateDoctor(
  doctorId: string,
  formData: FormData,
): Promise<void> {
  const { supabase } = await requireSettingsUser()

  const name = (formData.get('name') as string)?.trim()
  const speciality = (formData.get('speciality') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const location = (formData.get('location') as string) || null
  const bio = (formData.get('bio') as string)?.trim() || null

  if (!name) redirect(settingsNoticeUrl('doctor-missing-name'))

  const { error } = await supabase
    .from('doctors')
    .update({ name, speciality, phone, email, location, bio })
    .eq('id', doctorId)

  if (error) {
    console.error('[settings] update doctor failed:', error.message)
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('doctor-updated'))
}

export async function deactivateDoctor(doctorId: string): Promise<void> {
  const { supabase } = await requireSettingsUser()

  const { error } = await supabase
    .from('doctors')
    .update({ is_active: false })
    .eq('id', doctorId)

  if (error) {
    console.error('[settings] deactivate doctor failed:', error.message)
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('doctor-deactivated'))
}

export async function reactivateDoctor(doctorId: string): Promise<void> {
  const { supabase } = await requireSettingsUser()

  const { error } = await supabase
    .from('doctors')
    .update({ is_active: true })
    .eq('id', doctorId)

  if (error) {
    console.error('[settings] reactivate doctor failed:', error.message)
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('doctor-reactivated'))
}

// ── On-Call Schedule ─────────────────────────────────────────────────────────

export async function addOnCallSchedule(formData: FormData): Promise<void> {
  const { supabase } = await requireSettingsUser()

  const doctor_id = formData.get('doctor_id') as string
  const start_date = formData.get('start_date') as string
  const end_date = formData.get('end_date') as string
  const is_primary = formData.get('is_primary') === 'true'

  if (!doctor_id || !start_date || !end_date) {
    redirect(settingsNoticeUrl('schedule-missing-fields'))
  }

  if (end_date < start_date) {
    redirect(settingsNoticeUrl('schedule-date-error'))
  }

  const { error } = await supabase.from('on_call_schedule').insert({
    doctor_id,
    start_date,
    end_date,
    is_primary,
  })

  if (error) {
    console.error('[settings] add on-call failed:', error.message)
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('schedule-added'))
}

export async function removeOnCallSchedule(scheduleId: string): Promise<void> {
  const { supabase } = await requireSettingsUser()

  const { error } = await supabase
    .from('on_call_schedule')
    .delete()
    .eq('id', scheduleId)

  if (error) {
    console.error('[settings] remove on-call failed:', error.message)
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('schedule-removed'))
}

// ── Admin Users ───────────────────────────────────────────────────────────────

export async function inviteAdminUser(formData: FormData): Promise<void> {
  const { supabase } = await requireSettingsUser()

  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const name = (formData.get('name') as string)?.trim()
  const role = (formData.get('role') as string) || 'staff'

  if (!email || !name) redirect(settingsNoticeUrl('staff-missing-fields'))

  // Check if already exists
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id, is_active')
    .eq('email', email)
    .single()

  if (existing) {
    if (existing.is_active) redirect(settingsNoticeUrl('staff-already-active'))
    // Reactivate
    const { error } = await supabase
      .from('admin_users')
      .update({ name, role, is_active: true })
      .eq('id', existing.id)
    if (error) {
      console.error('[settings] reactivate admin failed:', error.message)
      redirect(settingsNoticeUrl('could-not-save'))
    }
    revalidatePath('/dashboard/settings')
    redirect(settingsNoticeUrl('staff-reactivated'))
  }

  const { error } = await supabase.from('admin_users').insert({ email, name, role, is_active: true })
  if (error) {
    console.error('[settings] invite admin failed:', error.message)
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('staff-added'))
}

export async function deactivateAdminUser(userId: string): Promise<void> {
  const { supabase, authUser } = await requireSettingsUser()

  // Safety: don't deactivate the current user
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('email')
    .eq('id', userId)
    .single()

  if (adminUser?.email === authUser.email) {
    redirect(settingsNoticeUrl('cannot-deactivate-self'))
  }

  const { error } = await supabase
    .from('admin_users')
    .update({ is_active: false })
    .eq('id', userId)

  if (error) {
    console.error('[settings] deactivate admin failed:', error.message)
    redirect(settingsNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/settings')
  redirect(settingsNoticeUrl('staff-deactivated'))
}
