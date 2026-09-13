import { type ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Sun,
  Moon,
  Languages,
  LogOut,
  Menu,
  X,
  CircleUserRound,
} from 'lucide-react'
import { useTheme } from '@/theme/ThemeContext'
import { useAuth } from '@/auth/AuthContext'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/Modal'
import { usePathname } from 'next/navigation'

interface LayoutProps {
  children: ReactNode
  activePage: string
  onNavigate: (page: string) => void
  navItems: {
    key: string
    label: string
    icon: ReactNode
    children?: { key: string; label: string }[]
  }[]
}

export function Layout({
  children,
  activePage,
  onNavigate,
  navItems,
}: LayoutProps) {
  const { t, toggleLanguage, lang } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const { profile, signOut } = useAuth()
  const pathname = usePathname()
  const isCurrentPage = (page: string) =>
    pathname === `/${page}` || (page === 'dashboard' && pathname === '/')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [pendingPage, setPendingPage] = useState<string | null>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node))
        setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    setPendingPage(null)
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen && !userMenuOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false)
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [mobileOpen, userMenuOpen])

  const roleLabel =
    profile?.role === 'admin'
      ? t('admin')
      : profile?.role === 'workshop'
        ? t('workshopOfficer')
        : profile?.role === 'assistant_workshop_manager'
          ? t('assistantWorkshopManager')
          : profile?.role === 'workshop_manager'
            ? t('workshopManager')
            : profile?.role === 'monitor'
              ? t('monitoring')
              : t('supervisor')

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--surface)', color: 'var(--fg)' }}
    >
      {/* Top bar */}
      {pendingPage && (
        <div
          className="fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden"
          role="status"
          aria-label={t('loading')}
        >
          <div className="h-full w-1/3 animate-nav-progress bg-[var(--primary)]" />
        </div>
      )}
      <header
        className="sticky top-0 z-40 border-b"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {navItems.length > 0 && (
              <button
                className="lg:hidden btn-ghost p-2"
                aria-label={t('navigationMenu')}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            )}
            <button
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => {
                if (isCurrentPage('dashboard')) return
                setPendingPage('dashboard')
                onNavigate('dashboard')
              }}
            >
              <img
                src="/azzanco-logo.png"
                alt=""
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-lg object-contain"
              />
              <div className="hidden sm:block">
                <h1 className="text-sm font-bold leading-tight">
                  {t('appName')}
                </h1>
                <p className="text-xs text-muted leading-tight">
                  {t('appSubtitle')}
                </p>
              </div>
            </button>
          </div>

          <div className="hidden items-center gap-1.5 sm:flex">
            <button
              onClick={toggleLanguage}
              className="btn-ghost p-2"
              title={t('toggleLanguage')}
            >
              <Languages size={18} />
              <span className="hidden sm:inline text-xs font-medium">
                {lang === 'ar' ? 'EN' : 'ع'}
              </span>
            </button>
            <button
              onClick={toggleTheme}
              className="btn-ghost p-2"
              title={t('toggleTheme')}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div
              className="mx-1 h-6 w-px"
              style={{ background: 'var(--border)' }}
            />
            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium">{profile?.full_name}</p>
              <p className="text-xs text-muted">{roleLabel}</p>
            </div>
            <button
              onClick={() => setLogoutOpen(true)}
              className="btn-ghost p-2"
              title={t('signOut')}
            >
              <LogOut size={18} />
            </button>
          </div>

          <div ref={userMenuRef} className="relative sm:hidden">
            <button
              type="button"
              className="btn-ghost h-9 w-9 rounded-full p-0"
              onClick={() => setUserMenuOpen((value) => !value)}
              aria-label={t('userMenu')}
              aria-expanded={userMenuOpen}
            >
              <CircleUserRound size={25} />
            </button>
            {userMenuOpen && (
              <div
                className="absolute end-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border shadow-xl"
                style={{
                  background: 'var(--bg)',
                  borderColor: 'var(--border)',
                }}
              >
                <div
                  className="border-b px-4 py-3"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <p className="text-sm font-semibold">
                    {profile?.full_name ?? '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{roleLabel}</p>
                </div>
                <div className="p-1.5">
                  <button
                    className="btn-ghost w-full justify-start"
                    onClick={() => {
                      toggleTheme()
                      setUserMenuOpen(false)
                    }}
                  >
                    {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                    {theme === 'dark' ? t('lightMode') : t('darkMode')}
                  </button>
                  <button
                    className="btn-ghost w-full justify-start"
                    onClick={() => {
                      toggleLanguage()
                      setUserMenuOpen(false)
                    }}
                  >
                    <Languages size={17} />
                    {t('language')}: {lang === 'ar' ? 'English' : 'العربية'}
                  </button>
                  <button
                    className="btn-ghost w-full justify-start text-red-600 dark:text-red-400"
                    onClick={() => {
                      setUserMenuOpen(false)
                      setLogoutOpen(true)
                    }}
                  >
                    <LogOut size={17} />
                    {t('signOut')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        {/* Sidebar — desktop */}
        {navItems.length > 0 && (
          <aside
            className="hidden lg:flex w-60 shrink-0 flex-col border-e p-4 sticky top-16 h-[calc(100dvh-4rem)] overflow-y-auto"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
          >
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <div key={item.key}>
                  <button
                    key={item.key}
                    aria-current={activePage === item.key ? 'page' : undefined}
                    onClick={() => {
                      if (isCurrentPage(item.key)) return
                      setPendingPage(item.key)
                      onNavigate(item.key)
                    }}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] active:opacity-80 ${
                      activePage === item.key
                        ? 'nav-active'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-fg'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                  {item.children &&
                    (activePage === item.key ||
                      item.children.some((child) =>
                        pathname.startsWith(`/${child.key}`),
                      )) && (
                      <div className="ms-9 mt-1 space-y-0.5 border-s border-[var(--border)] ps-2">
                        {item.children.map((child) => (
                          <button
                            key={child.key}
                            className={`block w-full rounded px-2 py-1.5 text-start text-xs ${pathname.startsWith(`/${child.key}`) ? 'font-semibold text-fg' : 'text-muted hover:text-fg'}`}
                            onClick={() => onNavigate(child.key)}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              ))}
            </nav>
          </aside>
        )}

        {/* Sidebar — mobile drawer */}
        {mobileOpen && (
          <div
            className="lg:hidden fixed inset-0 z-30 animate-fade-in"
            style={{ background: 'var(--overlay)' }}
            onClick={() => setMobileOpen(false)}
          >
            <div
              className="absolute inset-y-0 start-0 w-64 border-e p-4 pt-20 overflow-y-auto"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <div key={item.key}>
                    <button
                      key={item.key}
                      onClick={() => {
                        setMobileOpen(false)
                        if (isCurrentPage(item.key)) return
                        setPendingPage(item.key)
                        onNavigate(item.key)
                        setMobileOpen(false)
                      }}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] active:opacity-80 ${
                        activePage === item.key
                          ? 'nav-active'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                    {item.children && (
                      <div className="ms-9 mt-1 space-y-0.5 border-s border-[var(--border)] ps-2">
                        {item.children.map((child) => (
                          <button
                            key={child.key}
                            className={`block w-full rounded px-2 py-1.5 text-start text-xs ${pathname.startsWith(`/${child.key}`) ? 'font-semibold text-fg' : 'text-muted'}`}
                            onClick={() => {
                              setMobileOpen(false)
                              onNavigate(child.key)
                            }}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <Modal
        open={logoutOpen}
        onClose={() => !loggingOut && setLogoutOpen(false)}
        title={t('confirmSignOut')}
        size="sm"
      >
        <div className="space-y-5">
          <p className="text-sm text-muted">{t('confirmSignOutMessage')}</p>
          <div className="flex gap-3">
            <button
              className="btn-outline flex-1"
              disabled={loggingOut}
              onClick={() => setLogoutOpen(false)}
            >
              {t('cancel')}
            </button>
            <button
              className="btn-primary flex-1"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true)
                await signOut()
              }}
            >
              {loggingOut ? t('loading') : t('signOut')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
