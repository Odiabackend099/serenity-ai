'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

/**
 * Invisible client component that subscribes to Supabase Realtime
 * on the emergency_alerts table. When a new alert is inserted OR
 * an existing alert is updated (acknowledged, resolved), it calls
 * router.refresh() to re-run server component data fetching.
 *
 * Mount this inside any server component page that needs live updates.
 */
export default function EmergencyRealtimeRefresher() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('emergency-alerts-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_alerts' },
        () => {
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [router, supabase])

  return null
}
