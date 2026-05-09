'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'

type SidebarProps = {
  emergencyCount: number
}

type NavItem = {
  label: string
  href: string
  icon: IconName
  badge?: number
}

type IconName = 'home' | 'calendar' | 'alert' | 'patients' | 'messages' | 'reports' | 'admin' | 'log' | 'menu' | 'close' | 'collapse' | 'logout'

const COLLAPSED_KEY = 'serenity-dashboard-sidebar-collapsed'

export default function Sidebar({ emergencyCount }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [loadedPreference, setLoadedPreference] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const effectiveCollapsed = loadedPreference ? collapsed : false

  useEffect(() => {
    const nextCollapsed = localStorage.getItem(COLLAPSED_KEY) === 'true'
    const frame = window.requestAnimationFrame(() => {
      setCollapsed(nextCollapsed)
      setLoadedPreference(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!loadedPreference) return
    localStorage.setItem(COLLAPSED_KEY, String(collapsed))
  }, [collapsed, loadedPreference])

  const nav = useMemo(
    () => ({
      primary: [
        { label: 'Home', href: '/dashboard', icon: 'home' },
        { label: 'Appointments', href: '/dashboard/appointments', icon: 'calendar' },
        { label: 'Emergencies', href: '/dashboard/emergencies', icon: 'alert', badge: emergencyCount },
        { label: 'Patients', href: '/dashboard/patients', icon: 'patients' },
        { label: 'Messages', href: '/dashboard/conversations', icon: 'messages' },
      ] satisfies NavItem[],
      admin: [
        { label: 'Reports', href: '/dashboard/analytics', icon: 'reports' },
        { label: 'Admin', href: '/dashboard/settings', icon: 'admin' },
        { label: 'Activity history', href: '/dashboard/audit', icon: 'log' },
      ] satisfies NavItem[],
    }),
    [emergencyCount]
  )

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-serenity-900/10 bg-serenity-950 px-4 text-white shadow-sm md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/brand/serenity-royale-logo.png" alt="Serenity Royale Hospital" width={32} height={32} className="rounded-md border border-gold-400/30 bg-serenity-900" priority />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">Serenity Royale</p>
            <p className="truncate text-xs text-gold-300">AI Dashboard</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white"
          aria-label="Open navigation menu"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
      </header>

      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-serenity-950/60 md:hidden"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r border-white/10 bg-serenity-950 text-serenity-100 shadow-2xl transition-all duration-200 md:sticky md:z-30 md:translate-x-0 md:shadow-none',
          effectiveCollapsed ? 'md:w-20' : 'md:w-72',
          mobileOpen ? 'w-80 translate-x-0' : 'hidden w-80 -translate-x-full md:flex md:w-auto',
        ].join(' ')}
      >
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-4">
          <Link href="/dashboard" className={`flex min-w-0 items-center gap-3 ${effectiveCollapsed ? 'md:justify-center' : ''}`} aria-label="Open dashboard home">
            <Image src="/brand/serenity-royale-logo.png" alt="Serenity Royale Hospital" width={44} height={44} className="rounded-md border border-gold-400/40 bg-serenity-900" priority />
            <div className={`min-w-0 ${effectiveCollapsed ? 'md:hidden' : ''}`}>
              <p className="truncate text-base font-bold text-white">Serenity Royale</p>
              <p className="truncate text-sm font-semibold text-gold-300">Admin Dashboard</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white md:hidden"
            aria-label="Close navigation menu"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <div className="space-y-1">
            {nav.primary.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} collapsed={effectiveCollapsed} onNavigate={() => setMobileOpen(false)} />
            ))}
          </div>

          <div className="mt-7 border-t border-white/10 pt-5">
            <p className={`mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-serenity-400 ${effectiveCollapsed ? 'md:hidden' : ''}`}>Management</p>
            <div className="space-y-1">
              {nav.admin.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} collapsed={effectiveCollapsed} onNavigate={() => setMobileOpen(false)} />
              ))}
            </div>
          </div>
        </nav>

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="mb-3 hidden min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm font-semibold text-serenity-100 hover:bg-white/10 md:flex"
            aria-label={effectiveCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={effectiveCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            <Icon name="collapse" className={`h-4 w-4 transition-transform ${effectiveCollapsed ? 'rotate-180' : ''}`} />
            {!effectiveCollapsed && <span>Collapse</span>}
          </button>

          <div className={`mb-3 flex items-center gap-3 rounded-md border border-white/10 bg-serenity-900/80 p-3 ${effectiveCollapsed ? 'md:justify-center md:p-2' : ''}`}>
            <Image src="/brand/serenity-royale-logo.png" alt="" width={32} height={32} className="rounded border border-gold-400/30 bg-serenity-950" />
            <div className={`min-w-0 ${effectiveCollapsed ? 'md:hidden' : ''}`}>
              <p className="truncate text-sm font-semibold text-white">Serenity Royale Hospital</p>
              <p className="truncate text-xs text-serenity-300">Abuja, Nigeria</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-serenity-200 hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-70 ${effectiveCollapsed ? 'md:justify-center md:px-2' : ''}`}
            aria-label="Sign out"
            title="Sign out"
          >
            <Icon name="logout" className="h-5 w-5 shrink-0" />
            <span className={effectiveCollapsed ? 'md:hidden' : ''}>{signingOut ? 'Signing out...' : 'Sign out'}</span>
          </button>
        </div>
      </aside>
    </>
  )
}

function NavLink({ item, pathname, collapsed, onNavigate }: { item: NavItem; pathname: string; collapsed: boolean; onNavigate: () => void }) {
  const active = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href)
  const className = active
    ? 'bg-gold-400 text-serenity-950 shadow-sm'
    : 'text-serenity-200 hover:bg-white/10 hover:text-white'

  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      onClick={onNavigate}
      className={`group flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition ${className} ${collapsed ? 'md:justify-center md:px-2' : ''}`}
    >
      <span className="relative shrink-0">
        <Icon name={item.icon} className="h-5 w-5" />
        {!!item.badge && item.badge > 0 && collapsed && (
          <span className="absolute -right-2 -top-2 hidden min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white md:block">
            {item.badge > 9 ? '9+' : item.badge}
          </span>
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate ${collapsed ? 'md:hidden' : ''}`}>{item.label}</span>
      {!!item.badge && item.badge > 0 && (
        <span className={`rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white ${collapsed ? 'md:hidden' : ''}`}>
          {item.badge}
        </span>
      )}
    </Link>
  )
}

function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />,
    calendar: <path d="M7 3v4M17 3v4M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />,
    alert: <path d="M12 8v5M12 17h.01M10.3 4.4 2.8 17.6A2 2 0 0 0 4.5 21h15a2 2 0 0 0 1.7-3.4L13.7 4.4a2 2 0 0 0-3.4 0Z" />,
    patients: <path d="M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0M19 8a3 3 0 0 1 0 6M22 21a6 6 0 0 0-3-5.2" />,
    messages: <path d="M21 12a8 8 0 0 1-8 8H6l-3 2v-6a8 8 0 1 1 18-4Z" />,
    reports: <path d="M4 19V5M9 19v-8M14 19V8M19 19V3M3 19h18" />,
    admin: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1A1.7 1.7 0 0 0 4.3 7.1l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.66.16 1.6.7 1.6 1.55v2.9A1.7 1.7 0 0 0 19.4 15Z" />,
    log: <path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v4h4M8 11h8M8 15h8M8 19h5" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    collapse: <path d="M15 6 9 12l6 6" />,
    logout: <path d="M10 17l5-5-5-5M15 12H3M21 3v18" />,
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
