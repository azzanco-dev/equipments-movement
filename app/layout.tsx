import type { Metadata } from 'next'
import '@/index.css'
import { Providers } from '@/Providers'

export const metadata: Metadata = {
  title: 'حركة المعدات | Equipments movement',
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
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
