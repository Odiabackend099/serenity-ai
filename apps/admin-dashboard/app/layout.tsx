import type { Metadata } from 'next'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Serenity Royale Hospital AI Dashboard',
  description: 'Hospital management dashboard for Serenity Royale Hospital',
  icons: {
    icon: '/brand/serenity-royale-logo.png',
    apple: '/brand/serenity-royale-logo.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
