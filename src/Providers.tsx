'use client'

import type { ReactNode } from 'react'
import { AuthProvider } from '@/auth/AuthContext'
import { PermissionsProvider } from '@/auth/PermissionsContext'
import { I18nProvider } from '@/i18n/I18nContext'
import { ThemeProvider } from '@/theme/ThemeContext'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          {/* wave 22B: loads current_permissions() after sign-in; the
              sidebar, routing and in-screen actions follow it (waves 23-24;
              profiles.role was dropped in roles stage 4c-2). */}
          <PermissionsProvider>
            <div id="app-shell">{children}</div>
          </PermissionsProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
