'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function acknowledgeAlert(alertId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Find admin_users record matching this auth user
  const { data: adminUser } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', user.email)
    .single()

  const { error } = await supabase
    .from('emergency_alerts')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: adminUser?.id ?? null,
    })
    .eq('id', alertId)
    .is('acknowledged_at', null) // Idempotent — only set once

  if (error) {
    console.error('[emergencies] acknowledge failed:', error.message)
    return
  }

  revalidatePath('/dashboard/emergencies')
  revalidatePath('/dashboard')
}

export async function resolveAlert(alertId: string, responseNotes: string): Promise<void> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error } = await supabase
    .from('emergency_alerts')
    .update({
      resolved_at: new Date().toISOString(),
      response_notes: responseNotes.trim() || null,
      // Also acknowledge if not yet acknowledged
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', alertId)
    .is('resolved_at', null)

  if (error) {
    console.error('[emergencies] resolve failed:', error.message)
    return
  }

  revalidatePath('/dashboard/emergencies')
  revalidatePath('/dashboard')
}
