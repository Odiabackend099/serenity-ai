'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [supabase] = useState(() => createClient())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const redirectTarget = useMemo(() => {
    const next = searchParams.get('next')
    return next && next.startsWith('/') ? next : '/dashboard'
  }, [searchParams])

  useEffect(() => {
    let cancelled = false

    async function redirectAuthenticatedUser() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!cancelled && session) {
        router.replace(redirectTarget)
        router.refresh()
      }
    }

    void redirectAuthenticatedUser()

    return () => {
      cancelled = true
    }
  }, [redirectTarget, router, supabase])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push(redirectTarget)
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_#1f2a44_0%,_#070d24_45%,_#020617_100%)] px-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md border border-gold-100">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image
            src="/brand/serenity-royale-logo.png"
            alt="Serenity Royale Hospital logo"
            width={80}
            height={80}
            className="w-20 h-20 rounded-lg object-cover mx-auto mb-4 border border-gold-200 shadow-sm bg-serenity-950"
          />
          <h1 className="text-2xl font-bold text-gray-900">Serenity Royale Hospital</h1>
          <p className="text-gray-500 text-sm mt-1">Staff Dashboard</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-gold-500 outline-none transition"
              placeholder="admin@serenityroyalehospital.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold-400 focus:border-gold-500 outline-none transition"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-gold-500 hover:bg-gold-400 disabled:bg-gold-200 text-serenity-950 font-semibold rounded-lg transition"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Serenity Royale Hospital Staff Dashboard · Secure Access
        </p>
      </div>
    </div>
  )
}
