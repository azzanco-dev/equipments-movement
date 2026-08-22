'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/auth/AuthContext';
import { I18nProvider } from '@/i18n/I18nContext';
import { ThemeProvider } from '@/theme/ThemeContext';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>{children}</AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
