import type { Metadata, Viewport } from 'next'
import PWARegister from '@/components/PWARegister'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  applicationName: 'Serenity AI',
  title: 'Serenity Royale Hospital AI Dashboard',
  description: 'Hospital management dashboard for Serenity Royale Hospital',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Serenity AI',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: true,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#020617',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="bg-slate-50">
      <body>
        <PWARegister />
        {children}
      </body>
    </html>
  )
}
