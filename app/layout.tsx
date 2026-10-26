import type { Metadata } from 'next'
import '@/index.css'
import { Providers } from '@/Providers'

// No `title` here: the metadata title is re-applied on every navigation and
// would overwrite the per-page tab title App sets (owner 2026-10-25). The
// <title> below is only the first one, before the app runs.
export const metadata: Metadata = {
  description: 'Equipment entry and exit management',
  icons: {
    icon: '/azzanco-logo.png',
    shortcut: '/azzanco-logo.png',
    apple: '/azzanco-logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <title>حركة المعدات</title>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
