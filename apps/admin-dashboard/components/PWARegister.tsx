'use client'

import { useEffect } from 'react'

export default function PWARegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('Serenity dashboard service worker registration failed', error)
      })
    }

    if (document.readyState === 'complete') {
      register()
      return undefined
    }

    window.addEventListener('load', register, { once: true })
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
