import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import Sidebar from '@/components/dashboard/Sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: staffUser } = await supabase
    .from('admin_users')
    .select('role')
    .eq('email', user.email ?? '')
    .eq('is_active', true)
    .maybeSingle()

  // Fetch live unresolved emergency count for sidebar badge
  const { count: emergencyCount } = await supabase
    .from('emergency_alerts')
    .select('*', { count: 'exact', head: true })
    .is('resolved_at', null)

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <Sidebar emergencyCount={emergencyCount ?? 0} staffRole={staffUser?.role ?? 'staff'} />
      <main className="min-w-0 flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  )
}
