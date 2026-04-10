import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export default async function HomePage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect authenticated users to dashboard, others to login
  redirect(user ? '/dashboard' : '/auth/login')
}
