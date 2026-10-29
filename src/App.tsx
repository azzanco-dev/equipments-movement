'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import { FullPageSpinner } from '@/components/Spinner'
import { Layout } from '@/components/Layout'
import { TabTitleProvider, useTabTitleRecord } from '@/components/TabTitle'
import { tabTitle } from '@/lib/pageTitle'
import { AuthScreen } from '@/screens/AuthScreen'
import {
  LayoutDashboard,
  FileText,
  Truck,
  FolderKanban,
  Building2,
  Users,
  Briefcase,
  Contact,
  Settings,
  FileUp,
  History,
  BarChart3,
  Search,
  ShoppingCart,
} from 'lucide-react'
import { FirstLoginPasswordDialog } from '@/components/FirstLoginPasswordDialog'
import { RouteFallback } from '@/components/RouteFallback'
import { MovementDetailSkeleton } from '@/components/movement/MovementDetailSkeleton'
import {
  navKeyOfPage,
  planShell,
  routePageOf,
  visibleNavItems,
  type NavChildKey,
  type NavItemKey,
  type RoutePage,
  type ShellPlan,
} from '@/lib/navPermissions'
import { movementSkeletonShape } from '@/lib/actionPermissions'
import type { TranslationKey } from '@/i18n/translations'

// What `<main>` shows while a screen's code downloads. These render inside the
// shell, so none of them is the full-screen loader: that one belongs to the
// auth bootstrap only. The list screens and the movement detail get a
// placeholder shaped like their own first frame, so the hand-over to the
// screen's skeleton does not read as a page disappearing and coming back.
const screenLoading = () => <RouteFallback />
const listLoading = () => <RouteFallback variant="list" />
const movementDetailLoading = () => <MovementDetailFallback />

/**
 * The movement detail page's own skeleton, with the same permission-based
 * shape the page picks before its movement row arrives
 * (`movementSkeletonShape`; the neutral site shape until the permissions are
 * ready), so the chunk fallback and the page's first frame are the same
 * picture.
 */
function MovementDetailFallback() {
  const shape = movementSkeletonShape(usePermissions())
  return (
    <MovementDetailSkeleton
      context={shape.context}
      isAdmin={shape.adminMenu}
      canUpload={shape.canUpload}
    />
  )
}

/**
 * Which home a signed-in user lands on, remembered from their last visit on
 * this device. It is only a hint for which public code chunk to warm up while
 * the profile is still loading; it never decides what is rendered — routing
 * below reads the shell from the loaded profile and permissions only.
 */
const LANDING_HINT_KEY = 'em.landing-hint'
type LandingHint = 'admin-home' | 'home'

function landingHintForShell({
  kind,
  landing,
  externalLanding,
}: ShellPlan): LandingHint | null {
  // The admin shell without home.admin lands on a section, not the home.
  if (kind === 'admin')
    return landing === 'dashboard' && !externalLanding ? 'admin-home' : null
  if (kind === 'foreman' || kind === 'workshop') return 'home'
  return null
}

function readLandingHint(): LandingHint | null {
  try {
    const value = window.localStorage.getItem(LANDING_HINT_KEY)
    return value === 'admin-home' || value === 'home' ? value : null
  } catch {
    return null
  }
}

/**
 * Starts downloading the screen the current URL is about to need, so the chunk
 * is on its way while the profile request is still in flight instead of
 * starting only after it. The `import()` calls resolve to the same chunks the
 * `dynamic()` screens above use; a failed warm-up is ignored because the
 * screen's own import reports a real failure.
 */
function preloadScreenForPath(segments: string[]) {
  const ignore = () => undefined
  if (segments[0] === 'movements' && segments[1]) {
    if (segments[1] === 'new')
      void import('@/screens/MovementCreate').catch(ignore)
    else void import('@/screens/MovementDetail').catch(ignore)
    return
  }
  if (segments.length > 0 && segments[0] !== 'dashboard') return
  const hint = readLandingHint()
  if (hint === 'admin-home')
    void import('@/screens/admin-home/AdminHomeScreen').catch(ignore)
  else if (hint === 'home') void import('@/screens/HomeScreen').catch(ignore)
}

const HomeScreen = dynamic(
  () => import('@/screens/HomeScreen').then((module) => module.HomeScreen),
  { loading: screenLoading },
)
const AdminHomeScreen = dynamic(
  () =>
    import('@/screens/admin-home/AdminHomeScreen').then(
      (module) => module.AdminHomeScreen,
    ),
  { loading: screenLoading },
)
const LogsScreen = dynamic(
  () =>
    import('@/screens/admin-home/LogsScreen').then(
      (module) => module.LogsScreen,
    ),
  { loading: listLoading },
)
const EquipmentInquiryScreen = dynamic(
  () =>
    import('@/screens/inquiry/EquipmentInquiryScreen').then(
      (module) => module.EquipmentInquiryScreen,
    ),
  { loading: screenLoading },
)
const AdminEquipment = dynamic(
  () =>
    import('@/screens/AdminEquipment').then((module) => module.AdminEquipment),
  { loading: listLoading },
)
const EquipmentDetail = dynamic(
  () =>
    import('@/screens/EquipmentDetail').then(
      (module) => module.EquipmentDetail,
    ),
  { loading: screenLoading },
)
const AdminProjects = dynamic(
  () =>
    import('@/screens/AdminProjects').then((module) => module.AdminProjects),
  { loading: listLoading },
)
const AdminCompanies = dynamic(
  () =>
    import('@/screens/AdminCompanies').then((module) => module.AdminCompanies),
  { loading: listLoading },
)
const AdminLessors = dynamic(
  () => import('@/screens/AdminLessors').then((module) => module.AdminLessors),
  { loading: listLoading },
)
const AdminUsers = dynamic(
  () => import('@/screens/AdminUsers').then((module) => module.AdminUsers),
  { loading: listLoading },
)
// Purchasing (migration 0136, screens 2026-10-19): the supplier PO list and
// page, behind the `purchasing.view` gates of src/lib/navPermissions.ts.
const SupplierPosListScreen = dynamic(
  () =>
    import('@/screens/purchasing/SupplierPosListScreen').then(
      (module) => module.SupplierPosListScreen,
    ),
  { loading: listLoading },
)
// «المعدات في المشاريع» (owner 2026-10-24, migration 0147).
const SiteUnitsScreen = dynamic(
  () =>
    import('@/screens/purchasing/SiteUnitsScreen').then(
      (module) => module.SiteUnitsScreen,
    ),
  { loading: listLoading },
)
const SupplierPoDetail = dynamic(
  () =>
    import('@/screens/purchasing/SupplierPoDetail').then(
      (module) => module.SupplierPoDetail,
    ),
  { loading: screenLoading },
)
const UserDetail = dynamic(
  () => import('@/screens/UserDetail').then((module) => module.UserDetail),
  { loading: screenLoading },
)
const AdminDrivers = dynamic(
  () => import('@/screens/AdminDrivers').then((module) => module.AdminDrivers),
  { loading: listLoading },
)
const DriverDetail = dynamic(
  () => import('@/screens/DriverDetail').then((module) => module.DriverDetail),
  { loading: screenLoading },
)
const MovementDetail = dynamic(
  () =>
    import('@/screens/MovementDetail').then((module) => module.MovementDetail),
  { loading: movementDetailLoading },
)
const MovementCreate = dynamic(
  () =>
    import('@/screens/MovementCreate').then((module) => module.MovementCreate),
  { loading: screenLoading },
)
const AdminSettings = dynamic(
  () =>
    import('@/screens/AdminSettings').then((module) => module.AdminSettings),
  { loading: screenLoading },
)
// wave 22B: Settings › «الادوار والصلاحيات». Rendered only in the admin
// shell, behind the `settings.roles` page gate (wave 23); the page itself
// checks `settings.roles` again (rolesPageAccess).
const RolesSettings = dynamic(
  () =>
    import('@/components/roles/RolesSettings').then(
      (module) => module.RolesSettings,
    ),
  { loading: screenLoading },
)
const MovementImport = dynamic(
  () =>
    import('@/screens/MovementImport').then((module) => module.MovementImport),
  { loading: screenLoading },
)
const MovementActivity = dynamic(
  () =>
    import('@/screens/MovementActivity').then(
      (module) => module.MovementActivity,
    ),
  { loading: listLoading },
)
const EntryReports = dynamic(
  () => import('@/screens/EntryReports').then((module) => module.EntryReports),
  { loading: screenLoading },
)
const EntryReportsAll = dynamic(
  () =>
    import('@/screens/EntryReportsAll').then(
      (module) => module.EntryReportsAll,
    ),
  { loading: screenLoading },
)
const EquipmentReports = dynamic(
  () =>
    import('@/screens/EquipmentReports').then(
      (module) => module.EquipmentReports,
    ),
  { loading: screenLoading },
)
// wave-15-export: the print page of the PDF export, without the app chrome.
const PrintExport = dynamic(
  () => import('@/screens/PrintExport').then((module) => module.PrintExport),
  { loading: screenLoading },
)
const WorkshopReports = dynamic(
  () =>
    import('@/screens/WorkshopReports').then(
      (module) => module.WorkshopReports,
    ),
  { loading: screenLoading },
)

// wave 23: the label and icon of each sidebar entry. WHICH entries show is
// decided by the user's permissions in src/lib/navPermissions.ts.
const NAV_PRESENTATION: Record<
  NavItemKey,
  { label: TranslationKey; icon: ReactNode }
> = {
  dashboard: { label: 'dashboard', icon: <LayoutDashboard size={18} /> },
  // Owner 2026-10-20: the sidebar calls the log «الدخوليات».
  logs: { label: 'navLogs', icon: <FileText size={18} /> },
  inquiry: { label: 'inquiryPageTitle', icon: <Search size={18} /> },
  equipment: { label: 'equipment', icon: <Truck size={18} /> },
  projects: { label: 'projects', icon: <FolderKanban size={18} /> },
  companies: { label: 'companies', icon: <Briefcase size={18} /> },
  lessors: { label: 'lessors', icon: <Building2 size={18} /> },
  purchasing: { label: 'purchasing', icon: <ShoppingCart size={18} /> },
  drivers: { label: 'drivers', icon: <Contact size={18} /> },
  users: { label: 'users', icon: <Users size={18} /> },
  activity: { label: 'activityLog', icon: <History size={18} /> },
  reports: { label: 'reports', icon: <BarChart3 size={18} /> },
  'movement-import': { label: 'movementImport', icon: <FileUp size={18} /> },
  settings: { label: 'settings', icon: <Settings size={18} /> },
}

const NAV_CHILD_LABELS: Record<NavChildKey, TranslationKey> = {
  'reports/entries': 'entryReports',
  'reports/equipment': 'equipmentReports',
  'reports/workshop': 'workshopReports',
  'purchasing/orders': 'supplierPos',
  'purchasing/units': 'siteUnits',
}

/**
 * wave 23 (routing by permissions, step 2): the account has a profile but its
 * permissions open no page at all. Fail closed, with a way out.
 */
function NoPermissionsPage({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <div className="card w-full max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold">{t('noPermissionsTitle')}</h1>
        <p className="text-muted">{t('noPermissionsBody')}</p>
        <button className="btn-primary mx-auto" onClick={onSignOut}>
          {t('signOut')}
        </button>
      </div>
    </div>
  )
}

function AppContent() {
  const { profile, session, loading, profileLoadError, retryProfile, signOut } =
    useAuth()
  const { t } = useI18n()
  // wave 23: the shell, its page guards and the sidebar follow the
  // permissions (re-evaluated when the roles page calls reload()). Roles
  // stage 4a: no role fallback; while they load the bootstrap spinner stays
  // up and a failed load shows the load-error page with a retry (planShell
  // in src/lib/navPermissions.ts).
  const permissionState = usePermissions()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const segments = pathname.split('/').filter(Boolean)
  const movementType = searchParams.get('type') === 'exit' ? 'exit' : 'entry'
  // The id of a detail page (/movements/:id, /equipment/:id, ...).
  const detailId = segments[1] ?? ''

  const {
    status: permissionStatus,
    permissions,
    reload: reloadPermissions,
  } = permissionState
  const shell = useMemo(
    () => planShell({ status: permissionStatus, permissions }),
    [permissionStatus, permissions],
  )
  const requested = routePageOf(segments)
  // A page this user may not open renders the shell's landing page: its home,
  // as an unknown URL always did, or the first open section of an admin shell
  // without home.admin.
  const page: RoutePage = shell.pages.has(requested) ? requested : shell.landing

  // The browser tab's title follows the page (owner 2026-10-25); a detail
  // page adds its record through useTabTitle. Signed out: the app's name.
  const tabTitleRecord = useTabTitleRecord()
  const documentTitle = profile
    ? tabTitle(page, t, tabTitleRecord, movementType)
    : t('tabAppName')
  useEffect(() => {
    if (documentTitle) document.title = documentTitle
  }, [documentTitle])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  // Warm the screen's chunk as soon as a session is known, while the profile
  // is still loading.
  const signedIn = Boolean(session)
  useEffect(() => {
    if (!signedIn) return
    preloadScreenForPath(pathname.split('/').filter(Boolean))
  }, [signedIn, pathname])

  const landingHint = profile ? landingHintForShell(shell) : null
  useEffect(() => {
    if (!landingHint) return
    try {
      window.localStorage.setItem(LANDING_HINT_KEY, landingHint)
    } catch {
      // Storage can be unavailable (private mode); the hint is optional.
    }
  }, [landingHint])

  // The admin shell without home.admin has no dashboard: a URL it does not
  // open (including /dashboard, where the header logo points) lands on its
  // first open section, and the URL is replaced so it matches the page.
  // A user whose permissions open nothing in this router but the
  // identity-extraction page lands there (`externalLanding`, 2026-10-28).
  const landingRedirect =
    profile && !shell.pages.has(requested)
      ? shell.externalLanding
        ? shell.externalLanding
        : shell.landing !== 'dashboard'
          ? `/${shell.landing}`
          : null
      : null
  useEffect(() => {
    if (landingRedirect) router.replace(landingRedirect)
  }, [landingRedirect, router])

  // Full-screen loader for the auth bootstrap, which includes the
  // permissions (roles stage 4a: every account waits for them, nothing is
  // decided from the role meanwhile).
  const waitingForPermissions =
    Boolean(profile) && !profileLoadError && shell.kind === 'pending'
  if (loading || waitingForPermissions) return <FullPageSpinner />
  if (session && profileLoadError)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4">
        <div className="card w-full max-w-md space-y-4 text-center">
          <p>{t('profileLoadError')}</p>
          <button className="btn-primary mx-auto" onClick={retryProfile}>
            {t('retry')}
          </button>
        </div>
      </div>
    )
  if (!profile) return <AuthScreen />

  const passwordDialog = <FirstLoginPasswordDialog />

  // wave-15-export: the PDF export's print page renders outside the layout
  // (no sidebar or header). It reads a payload the export left in this tab
  // and fetches nothing; wave 23 opens it for `movements.export`.
  if (requested === 'print/export' && shell.pages.has('print/export'))
    return <PrintExport payloadKey={searchParams.get('key')} />

  // Fail closed: the permissions failed to load (or, defensively, are still
  // loading). Nothing is guessed from the role; the user retries or signs
  // out.
  if (shell.kind === 'unavailable' || shell.kind === 'pending')
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4">
        <div className="card w-full max-w-md space-y-4 text-center">
          <p>{t('permissionsLoadError')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              className="btn-primary"
              onClick={() => void reloadPermissions()}
            >
              {t('retry')}
            </button>
            <button className="btn-outline" onClick={() => void signOut()}>
              {t('signOut')}
            </button>
          </div>
        </div>
      </div>
    )
  if (shell.kind === 'none')
    return <NoPermissionsPage onSignOut={() => void signOut()} />

  const openMovement = (id: string) => router.push(`/movements/${id}`)
  const backToDashboard = () => router.push('/dashboard')
  const navigate = (target: string) => router.push(`/${target}`)

  // Every shell has the sidebar (owner 2026-10-28: «نبغى نضيف السايد بار
  // للجميع، بس التابات الي فيه بحسب صلاحيات كل مستخدم»): the admin shell
  // (home.admin, or any admin-shell section without a home, with the
  // dashboard closed and the landing on the first section) and the foreman
  // and workshop homes alike. Each page renders only when its gate passes;
  // the shell decides which home renders at 'dashboard' — AdminHomeScreen
  // for home.admin, the field HomeScreen (its list from the home.*
  // permission scope) for home.foreman / home.workshop. Every other kind
  // returned above; the compiler checks it, so nothing falls through.
  const shellKind: 'admin' | 'foreman' | 'workshop' = shell.kind
  const fieldHome = shellKind === 'foreman' || shellKind === 'workshop'
  // The sidebar lists the sections the permissions pass; the routable set is
  // the shell's open pages, so the menu and the guards agree.
  const navItems = visibleNavItems(permissionState, shell.pages).map(
    (item) => ({
      key: item.key,
      label: t(NAV_PRESENTATION[item.key].label),
      icon: NAV_PRESENTATION[item.key].icon,
      children: item.children?.map((child) => ({
        key: child,
        label: t(NAV_CHILD_LABELS[child]),
      })),
    }),
  )
  const canOpenEquipment = shell.pages.has('equipment/:id')
  const canCreateMovement = shell.pages.has('movements/new')
  const canOpenLogs = shell.pages.has('logs')

  return (
    <>
      <Layout
        activePage={navKeyOfPage(page)}
        onNavigate={navigate}
        navItems={navItems}
      >
        {landingRedirect ? (
          <RouteFallback />
        ) : page === 'movements/new' ? (
          <MovementCreate
            movementType={movementType}
            // 2026-10-28: on the workshop home the shell decides the form:
            // the workshop form for a holder of movements.workshop.create,
            // even when he also holds movements.site.create. Never on the
            // admin or foreman shell.
            workshopForm={
              shellKind === 'workshop' &&
              permissions.has('movements.workshop.create')
            }
            // A field home goes back to its home, the admin shell to the log.
            onClose={fieldHome ? backToDashboard : () => router.push('/logs')}
            onViewMovement={openMovement}
            onGoHome={backToDashboard}
          />
        ) : page === 'movements/:id' ? (
          <MovementDetail
            movementId={detailId}
            onBack={fieldHome ? backToDashboard : () => router.back()}
            onNavigateMovement={openMovement}
          />
        ) : page === 'equipment/:id' ? (
          <EquipmentDetail
            equipmentId={detailId}
            onBack={() => router.push('/equipment')}
            onEdit={(equipment) =>
              router.push(`/equipment?edit=${encodeURIComponent(equipment.id)}`)
            }
            onSelectMovement={openMovement}
            onViewAllMovements={
              shell.pages.has('logs')
                ? (code) => router.push(`/logs?q=${encodeURIComponent(code)}`)
                : undefined
            }
            onOpenPo={
              shell.pages.has('purchasing/:id')
                ? (id) => router.push(`/purchasing/${id}`)
                : undefined
            }
          />
        ) : page === 'purchasing/:id' ? (
          <SupplierPoDetail
            poId={detailId}
            onBack={() => router.push('/purchasing/orders')}
            onOpenEquipment={
              canOpenEquipment
                ? (id) => router.push(`/equipment/${id}`)
                : undefined
            }
          />
        ) : page === 'drivers/:id' ? (
          <DriverDetail
            driverId={detailId}
            onBack={() => router.push('/drivers')}
          />
        ) : page === 'users/:id' ? (
          <UserDetail userId={detailId} onBack={() => router.push('/users')} />
        ) : (
          <>
            {page === 'dashboard' && fieldHome && (
              <HomeScreen
                movementsScope={shell.homeScope}
                onSelectMovement={openMovement}
                onCreateMovement={(type) =>
                  router.push(`/movements/new?type=${type}`)
                }
              />
            )}
            {page === 'dashboard' && !fieldHome && (
              <AdminHomeScreen
                onSelectMovement={openMovement}
                canOpenLogs={canOpenLogs}
                canOpenPage={(target) => shell.pages.has(target)}
                onSelectEquipment={
                  canOpenEquipment
                    ? (id) => router.push(`/equipment/${id}`)
                    : undefined
                }
                onCreateMovement={
                  canCreateMovement
                    ? (type) => router.push(`/movements/new?type=${type}`)
                    : undefined
                }
              />
            )}
            {page === 'logs' && (
              <LogsScreen
                onSelectMovement={openMovement}
                // 2026-10-28: a holder of movements.workshop.classify without
                // a home (a custom role in this shell) classifies here. The
                // home.admin holders keep the /logs of before.
                selfClassify={
                  permissions.has('movements.workshop.classify') &&
                  !permissions.has('home.admin')
                }
              />
            )}
            {page === 'inquiry' && (
              <EquipmentInquiryScreen onSelectMovement={openMovement} />
            )}
            {page === 'equipment' && (
              <AdminEquipment
                onSelectEquipment={(id) => router.push(`/equipment/${id}`)}
              />
            )}
            {page === 'projects' && <AdminProjects />}
            {page === 'companies' && <AdminCompanies />}
            {page === 'lessors' && <AdminLessors />}
            {page === 'purchasing/orders' && (
              <SupplierPosListScreen
                onSelectPo={(id) => router.push(`/purchasing/${id}`)}
              />
            )}
            {page === 'purchasing/units' && (
              <SiteUnitsScreen
                onSelectPo={(id) => router.push(`/purchasing/${id}`)}
                onSelectMovement={
                  shell.pages.has('movements/:id') ? openMovement : undefined
                }
              />
            )}
            {page === 'drivers' && (
              <AdminDrivers
                onSelectDriver={(id) => router.push(`/drivers/${id}`)}
              />
            )}
            {page === 'users' && (
              <AdminUsers onSelectUser={(id) => router.push(`/users/${id}`)} />
            )}
            {page === 'movement-import' && <MovementImport />}
            {page === 'activity' && <MovementActivity />}
            {page === 'reports/workshop' && (
              <WorkshopReports onSelectMovement={openMovement} />
            )}
            {page === 'reports/equipment' && <EquipmentReports />}
            {page === 'reports/entries/all' && (
              <EntryReportsAll onSelectMovement={openMovement} />
            )}
            {page === 'reports/entries' && (
              <EntryReports onSelectMovement={openMovement} />
            )}
            {page === 'settings/roles' && <RolesSettings />}
            {/* AdminSettings picks its sub-page from the pathname. */}
            {(page === 'settings' ||
              page === 'settings/equipment-types' ||
              page === 'settings/workshop-opening-balance' ||
              page === 'settings/afaqy') && <AdminSettings />}
          </>
        )}
      </Layout>
      {passwordDialog}
    </>
  )
}

export default function App() {
  return (
    <TabTitleProvider>
      <AppContent />
    </TabTitleProvider>
  )
}
