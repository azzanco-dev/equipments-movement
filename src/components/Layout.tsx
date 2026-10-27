import { type HTMLAttributes, type ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Sun,
  Moon,
  Languages,
  LogOut,
  Menu,
  X,
  CircleUserRound,
  ChevronDown,
} from 'lucide-react'
import { useTheme } from '@/theme/ThemeContext'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { canSeeIntegrationsStatus } from '@/lib/actionPermissions'
import { localizedName } from '@/lib/localizedName'
import { useEffect, useState } from 'react'
import {
  AppLink,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@/components/ui'
import { usePathname } from 'next/navigation'
import {
  WhatsAppStatusIndicator,
  useWhatsAppStatusPolling,
} from '@/components/WhatsAppGatewayStatus'

/** A menu entry: a real link to its page (owner 2026-10-25, right click ›
 *  new tab and Ctrl click), or a button for a parent that only expands. The
 *  entry's own handler runs on a plain click only. */
function NavControl({
  href,
  onActivate,
  ...props
}: HTMLAttributes<HTMLElement> & { href?: string; onActivate: () => void }) {
  if (!href)
    return (
      <button
        type="button"
        onClick={onActivate}
        {...(props as HTMLAttributes<HTMLButtonElement>)}
      />
    )
  return (
    <AppLink
      href={href}
      onNavigate={onActivate}
      {...(props as HTMLAttributes<HTMLAnchorElement>)}
    />
  )
}

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
  const [expandedNavItems, setExpandedNavItems] = useState<
    Record<string, boolean>
  >({})

  useEffect(() => {
    setPendingPage(null)
    setMobileOpen(false)
    setExpandedNavItems({})
  }, [pathname])

  useEffect(() => {
    // The user menu is a Radix `DropdownMenu`, which already closes on
    // Escape and outside interaction on its own.
    if (!mobileOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [mobileOpen])

  // wave 23 (step 3): the label under the name is the assigned role's name.
  // Roles stage 4a: the roles system is permanently ON, so there is no
  // legacy-role label any more; nothing shows while the assignment loads or
  // after a failed read.
  const permissionState = usePermissions()
  const { assignedRole } = permissionState
  const roleLabel = assignedRole
    ? localizedName(lang, assignedRole.name_ar, assignedRole.name_en)
    : null

  // wave 12: the WhatsApp gateway status is polled for the admin only.
  // wave 24: for a holder of `settings.integrations` (the status route's
  // permission); nobody while the permissions load or failed.
  const showWhatsAppStatus =
    canSeeIntegrationsStatus(permissionState) && navItems.length > 0
  useWhatsAppStatusPolling(showWhatsAppStatus)

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
              <IconButton
                className="lg:hidden"
                label={t('navigationMenu')}
                variant="ghost"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(!mobileOpen)}
                icon={mobileOpen ? <X size={20} /> : <Menu size={20} />}
              />
            )}
            {/* Owner 2026-10-25: the logo and the menu entries are real
                links, so right click › new tab and Ctrl click work. */}
            <AppLink
              href="/dashboard"
              className="flex items-center gap-2 cursor-pointer"
              onNavigate={() => {
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
            </AppLink>
          </div>

          <div className="hidden items-center gap-1.5 sm:flex">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguage}
              title={t('toggleLanguage')}
              icon={<Languages size={16} />}
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </Button>
            <IconButton
              label={t('toggleTheme')}
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            />
            <div
              className="mx-1 h-6 w-px"
              style={{ background: 'var(--border)' }}
            />
            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium">{profile?.full_name}</p>
              <p className="text-xs text-muted">{roleLabel}</p>
            </div>
            <IconButton
              label={t('signOut')}
              variant="ghost"
              size="sm"
              onClick={() => setLogoutOpen(true)}
              icon={<LogOut size={16} />}
            />
          </div>

          <div className="sm:hidden">
            <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label={t('userMenu')}
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 rounded-full"
                  icon={<CircleUserRound size={25} />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold text-fg">
                    {profile?.full_name ?? '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{roleLabel}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={
                    theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />
                  }
                  onSelect={toggleTheme}
                >
                  {theme === 'dark' ? t('lightMode') : t('darkMode')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<Languages size={16} />}
                  onSelect={toggleLanguage}
                >
                  {t('language')}: {lang === 'ar' ? 'English' : 'العربية'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  tone="danger"
                  icon={<LogOut size={16} />}
                  onSelect={() => setLogoutOpen(true)}
                >
                  {t('signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                  {(() => {
                    const hasActiveChild = Boolean(
                      item.children?.some((child) =>
                        pathname.startsWith(`/${child.key}`),
                      ),
                    )
                    const expanded =
                      expandedNavItems[item.key] ?? hasActiveChild
                    return (
                      <>
                        <NavControl
                          key={item.key}
                          href={item.children ? undefined : `/${item.key}`}
                          aria-current={
                            activePage === item.key ? 'page' : undefined
                          }
                          aria-expanded={item.children ? expanded : undefined}
                          onActivate={() => {
                            if (item.children) {
                              setExpandedNavItems((current) => ({
                                ...current,
                                [item.key]: !expanded,
                              }))
                              return
                            }
                            if (isCurrentPage(item.key)) return
                            setPendingPage(item.key)
                            onNavigate(item.key)
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] active:opacity-80 ${
                            activePage === item.key
                              ? 'nav-active'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-fg'
                          }`}
                        >
                          {item.icon}
                          {item.label}
                          {item.children && (
                            <ChevronDown
                              size={16}
                              className={`ms-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                            />
                          )}
                        </NavControl>
                        {item.children && expanded && (
                          <div className="ms-9 mt-1 space-y-0.5 border-s border-[var(--border)] ps-2">
                            {item.children.map((child) => (
                              <NavControl
                                key={child.key}
                                href={`/${child.key}`}
                                className={`block w-full rounded px-2 py-1.5 text-start text-xs ${pathname.startsWith(`/${child.key}`) ? 'font-semibold text-fg' : 'text-muted hover:text-fg'}`}
                                onActivate={() => onNavigate(child.key)}
                              >
                                {child.label}
                              </NavControl>
                            ))}
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              ))}
            </nav>
            {showWhatsAppStatus && (
              <div className="mt-auto border-t border-[var(--border)] pt-3">
                <WhatsAppStatusIndicator />
              </div>
            )}
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
              className="absolute inset-y-0 start-0 flex w-64 flex-col border-e p-4 pt-20 overflow-y-auto"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <div key={item.key}>
                    {(() => {
                      const hasActiveChild = Boolean(
                        item.children?.some((child) =>
                          pathname.startsWith(`/${child.key}`),
                        ),
                      )
                      const expanded =
                        expandedNavItems[item.key] ?? hasActiveChild
                      return (
                        <>
                          <NavControl
                            key={item.key}
                            href={item.children ? undefined : `/${item.key}`}
                            aria-expanded={item.children ? expanded : undefined}
                            onActivate={() => {
                              if (item.children) {
                                setExpandedNavItems((current) => ({
                                  ...current,
                                  [item.key]: !expanded,
                                }))
                                return
                              }
                              if (isCurrentPage(item.key)) return
                              setPendingPage(item.key)
                              onNavigate(item.key)
                              setMobileOpen(false)
                            }}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] active:opacity-80 ${
                              activePage === item.key
                                ? 'nav-active'
                                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                            }`}
                          >
                            {item.icon}
                            {item.label}
                            {item.children && (
                              <ChevronDown
                                size={16}
                                className={`ms-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                              />
                            )}
                          </NavControl>
                          {item.children && expanded && (
                            <div className="ms-9 mt-1 space-y-0.5 border-s border-[var(--border)] ps-2">
                              {item.children.map((child) => (
                                <NavControl
                                  key={child.key}
                                  href={`/${child.key}`}
                                  className={`block w-full rounded px-2 py-1.5 text-start text-xs ${pathname.startsWith(`/${child.key}`) ? 'font-semibold text-fg' : 'text-muted'}`}
                                  onActivate={() => {
                                    setMobileOpen(false)
                                    onNavigate(child.key)
                                  }}
                                >
                                  {child.label}
                                </NavControl>
                              ))}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                ))}
              </nav>
              {showWhatsAppStatus && (
                <div className="mt-auto border-t border-[var(--border)] pt-3">
                  <WhatsAppStatusIndicator />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title={t('confirmSignOut')}
        description={t('dialogDescLogoutConfirm')}
        confirmLabel={t('signOut')}
        loading={loggingOut}
        onConfirm={async () => {
          setLoggingOut(true)
          await signOut()
        }}
      />
    </div>
  )
}
