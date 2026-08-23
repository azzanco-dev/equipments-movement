import { type ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nContext';
import { Sun, Moon, Languages, LogOut, Menu, X } from 'lucide-react';
import { useTheme } from '@/theme/ThemeContext';
import { useAuth } from '@/auth/AuthContext';
import { useState } from 'react';
import { Modal } from '@/components/Modal';

interface LayoutProps {
  children: ReactNode;
  activePage: string;
  onNavigate: (page: string) => void;
  navItems: { key: string; label: string; icon: ReactNode }[];
}

export function Layout({ children, activePage, onNavigate, navItems }: LayoutProps) {
  const { t, toggleLanguage, lang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const roleLabel = profile?.role === 'admin'
    ? t('admin')
    : profile?.role === 'workshop'
      ? t('workshopOfficer')
      : profile?.role === 'workshop_manager'
        ? t('workshopManager')
      : t('supervisor');

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden btn-ghost p-2"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => onNavigate('dashboard')}
            >
              <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-lg">
                <span className="font-bold text-lg">E</span>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-sm font-bold leading-tight">{t('appName')}</h1>
                <p className="text-xs text-muted leading-tight">{t('appSubtitle')}</p>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button onClick={toggleLanguage} className="btn-ghost p-2" title={t('toggleLanguage')}>
              <Languages size={18} />
              <span className="hidden sm:inline text-xs font-medium">{lang === 'ar' ? 'EN' : 'ع'}</span>
            </button>
            <button onClick={toggleTheme} className="btn-ghost p-2" title={t('toggleTheme')}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="mx-1 h-6 w-px" style={{ background: 'var(--border)' }} />
            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium">{profile?.full_name}</p>
              <p className="text-xs text-muted">{roleLabel}</p>
            </div>
            <button onClick={() => setLogoutOpen(true)} className="btn-ghost p-2" title={t('signOut')}>
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        {/* Sidebar — desktop */}
        <aside
          className="hidden lg:flex w-60 shrink-0 flex-col border-e p-4 sticky top-16 h-[calc(100vh-4rem)]"
          style={{ borderColor: 'var(--border)' }}
        >
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  activePage === item.key
                    ? 'nav-active'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-fg'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Sidebar — mobile drawer */}
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-30 animate-fade-in" style={{ background: 'var(--overlay)' }}>
            <div
              className="absolute inset-y-0 start-0 w-64 border-e p-4 pt-20 overflow-y-auto"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      onNavigate(item.key);
                      setMobileOpen(false);
                    }}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      activePage === item.key
                        ? 'nav-active'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
      <Modal open={logoutOpen} onClose={() => !loggingOut && setLogoutOpen(false)} title={t('confirmSignOut')} size="sm">
        <div className="space-y-5">
          <p className="text-sm text-muted">{t('confirmSignOutMessage')}</p>
          <div className="flex gap-3">
            <button className="btn-outline flex-1" disabled={loggingOut} onClick={() => setLogoutOpen(false)}>{t('cancel')}</button>
            <button className="btn-primary flex-1" disabled={loggingOut} onClick={async () => { setLoggingOut(true); await signOut(); }}>{loggingOut ? t('loading') : t('signOut')}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
