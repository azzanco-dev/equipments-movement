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
          {/* wave 22B: loads current_permissions() after sign-in; read only by
              the roles settings page, routing still uses profiles.role. */}
          <PermissionsProvider>
            <div id="app-shell">{children}</div>
          </PermissionsProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
