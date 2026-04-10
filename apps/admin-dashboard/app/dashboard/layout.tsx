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

  // Fetch live unresolved emergency count for sidebar badge
  const { count: emergencyCount } = await supabase
    .from('emergency_alerts')
    .select('*', { count: 'exact', head: true })
    .is('resolved_at', null)

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar emergencyCount={emergencyCount ?? 0} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
