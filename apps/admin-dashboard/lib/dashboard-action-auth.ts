import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'

export type DashboardRole = Database['public']['Tables']['admin_users']['Row']['role']

export type DashboardStaffUser = {
  id: string
  email: string
  role: DashboardRole
  doctor_id: string | null
}

export type DashboardActionErrorCode =
  | 'not_authenticated'
  | 'not_authorized'
  | 'staff_lookup_failed'

export class DashboardActionError extends Error {
  constructor(readonly code: DashboardActionErrorCode, message: string) {
    super(message)
    this.name = 'DashboardActionError'
  }
}

export function assertDashboardRole(
  role: DashboardRole | null | undefined,
  allowedRoles: readonly DashboardRole[],
): void {
  if (!role || !allowedRoles.includes(role)) {
    throw new DashboardActionError('not_authorized', 'This dashboard action is not available for your account.')
  }
}

export async function requireDashboardUser(allowedRoles?: readonly DashboardRole[]) {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user?.email) {
    throw new DashboardActionError('not_authenticated', 'Please sign in again before making dashboard changes.')
  }

  const { data: staffUser, error: staffError } = await supabase
    .from('admin_users')
    .select('id, email, role, doctor_id')
    .eq('email', user.email)
    .eq('is_active', true)
    .maybeSingle()

  if (staffError) {
    throw new DashboardActionError('staff_lookup_failed', staffError.message)
  }

  if (!staffUser) {
    throw new DashboardActionError('not_authorized', 'Your staff account is not active for dashboard changes.')
  }

  if (allowedRoles) {
    assertDashboardRole(staffUser.role, allowedRoles)
  }

  return {
    supabase,
    authUser: user,
    staffUser: staffUser as DashboardStaffUser,
  }
}

export async function requireRole(allowedRoles: readonly DashboardRole[]) {
  return requireDashboardUser(allowedRoles)
}
