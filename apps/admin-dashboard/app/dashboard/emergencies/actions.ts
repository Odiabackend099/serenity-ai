'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function acknowledgeAlert(alertId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

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

  if (error) return { error: error.message }

  revalidatePath('/dashboard/emergencies')
  revalidatePath('/dashboard')
  return {}
}

export async function resolveAlert(alertId: string, responseNotes: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

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

  if (error) return { error: error.message }

  revalidatePath('/dashboard/emergencies')
  revalidatePath('/dashboard')
  return {}
}
