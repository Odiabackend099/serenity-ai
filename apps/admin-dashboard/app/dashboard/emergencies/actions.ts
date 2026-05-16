'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { DashboardActionError, requireDashboardUser, type DashboardRole } from '@/lib/dashboard-action-auth'

const EMERGENCY_ACTION_ROLES: DashboardRole[] = ['super_admin', 'admin', 'doctor', 'nurse', 'staff']

function emergencyNoticeUrl(notice: string): string {
  return `/dashboard/emergencies?notice=${encodeURIComponent(notice)}`
}

async function requireEmergencyActionUser() {
  try {
    return await requireDashboardUser(EMERGENCY_ACTION_ROLES)
  } catch (err) {
    if (err instanceof DashboardActionError) {
      console.error(`[emergencies] action blocked (${err.code}):`, err.message)
      redirect(emergencyNoticeUrl(err.code === 'not_authenticated' ? 'not-signed-in' : 'not-authorized'))
    }
    throw err
  }
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  const { supabase, staffUser } = await requireEmergencyActionUser()

  const { error } = await supabase
    .from('emergency_alerts')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: staffUser.id,
    })
    .eq('id', alertId)
    .is('acknowledged_at', null) // Idempotent — only set once

  if (error) {
    console.error('[emergencies] acknowledge failed:', error.message)
    redirect(emergencyNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/emergencies')
  revalidatePath('/dashboard')
  redirect(emergencyNoticeUrl('alert-seen'))
}

export async function resolveAlert(alertId: string, responseNotes: string): Promise<void> {
  const { supabase, staffUser } = await requireEmergencyActionUser()

  const { error } = await supabase
    .from('emergency_alerts')
    .update({
      resolved_at: new Date().toISOString(),
      response_notes: responseNotes.trim() || null,
      // Also acknowledge if not yet acknowledged
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: staffUser.id,
    })
    .eq('id', alertId)
    .is('resolved_at', null)

  if (error) {
    console.error('[emergencies] resolve failed:', error.message)
    redirect(emergencyNoticeUrl('could-not-save'))
  }

  revalidatePath('/dashboard/emergencies')
  revalidatePath('/dashboard')
  redirect(emergencyNoticeUrl('alert-resolved'))
}
