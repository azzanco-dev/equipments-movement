'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { FullPageSpinner } from '@/components/Spinner'
import { Layout } from '@/components/Layout'
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
} from 'lucide-react'
import { FirstLoginPasswordDialog } from '@/components/FirstLoginPasswordDialog'
import { RouteFallback } from '@/components/RouteFallback'
import { MovementDetailSkeleton } from '@/components/movement/MovementDetailSkeleton'

// What `<main>` shows while a screen's code downloads. These render inside the
// shell, so none of them is the full-screen loader: that one belongs to the
// auth bootstrap only. The list screens and the movement detail get a
// placeholder shaped like their own first frame, so the hand-over to the
// screen's skeleton does not read as a page disappearing and coming back.
const screenLoading = () => <RouteFallback />
const listLoading = () => <RouteFallback variant="list" />
const movementDetailLoading = () => <MovementDetailFallback />

/**
 * The movement detail page's own skeleton, with the same role-based shape the
 * page picks before its movement row arrives, so the chunk fallback and the
 * page's first frame are the same picture.
 */
function MovementDetailFallback() {
  const { profile } = useAuth()
  const role = profile?.role
  const workshopRole =
    role === 'workshop' ||
    role === 'assistant_workshop_manager' ||
    role === 'workshop_manager'
  return (
    <MovementDetailSkeleton
      context={workshopRole ? 'workshop' : 'site'}
      isAdmin={role === 'admin'}
      canUpload={role !== 'monitor'}
    />
  )
}

/**
 * Which home a signed-in user lands on, remembered from their last visit on
 * this device. It is only a hint for which public code chunk to warm up while
 * the profile is still loading; it never decides what is rendered — routing
 * below reads the role from the loaded profile and nothing else.
 */
const LANDING_HINT_KEY = 'em.landing-hint'
type LandingHint = 'admin-home' | 'home'

function landingHintForRole(role: string | undefined): LandingHint | null {
  if (role === 'admin' || role === 'monitor') return 'admin-home'
  if (
    role === 'supervisor' ||
    role === 'workshop' ||
    role === 'assistant_workshop_manager' ||
    role === 'workshop_manager'
  )
    return 'home'
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

const ADMIN_PAGES = new Set([
  'dashboard',
  'logs',
  'inquiry',
  'equipment',
  'projects',
  'companies',
  'lessors',
  'drivers',
  'users',
  'movement-import',
  'activity',
  'settings',
  'reports',
  'reports/entries',
  'reports/entries/all',
  'reports/equipment',
  'reports/workshop',
])

function AppContent() {
  const { profile, session, loading, profileLoadError, retryProfile, signOut } =
    useAuth()
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const segments = pathname.split('/').filter(Boolean)
  const movementId = segments[0] === 'movements' ? segments[1] : null
  const isMovementCreate = segments[0] === 'movements' && segments[1] === 'new'
  const movementType = searchParams.get('type') === 'exit' ? 'exit' : 'entry'
  const equipmentId = segments[0] === 'equipment' ? segments[1] : null
  const driverId = segments[0] === 'drivers' ? segments[1] : null
  const userId = segments[0] === 'users' ? segments[1] : null
  const page =
    segments[0] === 'reports'
      ? 'reports'
      : ADMIN_PAGES.has(segments[0] ?? '')
        ? segments[0]
        : 'dashboard'

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

  const landingHint = landingHintForRole(profile?.role)
  useEffect(() => {
    if (!landingHint) return
    try {
      window.localStorage.setItem(LANDING_HINT_KEY, landingHint)
    } catch {
      // Storage can be unavailable (private mode); the hint is optional.
    }
  }, [landingHint])

  // Full-screen loader for the auth bootstrap only.
  if (loading) return <FullPageSpinner />
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
  // (no sidebar or header). It is reached from /logs, so only the roles that
  // have the log (admin, monitor) get it; it reads a payload the export left
  // in this tab and fetches nothing.
  if (
    segments[0] === 'print' &&
    segments[1] === 'export' &&
    (profile.role === 'admin' || profile.role === 'monitor')
  )
    return <PrintExport payloadKey={searchParams.get('key')} />

  const openMovement = (id: string) => router.push(`/movements/${id}`)
  const backToDashboard = () => router.push('/dashboard')

  if (profile.role === 'monitor') {
    const monitorPage =
      page === 'logs' ? 'logs' : page === 'inquiry' ? 'inquiry' : 'dashboard'
    const monitorNavItems = [
      {
        key: 'dashboard',
        label: t('dashboard'),
        icon: <LayoutDashboard size={18} />,
      },
      { key: 'logs', label: t('logs'), icon: <FileText size={18} /> },
      {
        key: 'inquiry',
        label: t('inquiryPageTitle'),
        icon: <Search size={18} />,
      },
    ]
    return (
      <>
        <Layout
          activePage={monitorPage}
          onNavigate={(target) => router.push(`/${target}`)}
          navItems={monitorNavItems}
        >
          {movementId && movementId !== 'new' ? (
            <MovementDetail
              movementId={movementId}
              onBack={() => router.back()}
              onNavigateMovement={openMovement}
            />
          ) : monitorPage === 'logs' ? (
            <LogsScreen onSelectMovement={openMovement} />
          ) : monitorPage === 'inquiry' ? (
            <EquipmentInquiryScreen onSelectMovement={openMovement} />
          ) : (
            <AdminHomeScreen />
          )}
        </Layout>
        {passwordDialog}
      </>
    )
  }

  if (
    profile.role === 'supervisor' ||
    profile.role === 'workshop' ||
    profile.role === 'assistant_workshop_manager' ||
    profile.role === 'workshop_manager'
  ) {
    return (
      <>
        <Layout
          activePage="dashboard"
          onNavigate={backToDashboard}
          navItems={[]}
        >
          {isMovementCreate ? (
            <MovementCreate
              movementType={movementType}
              onClose={backToDashboard}
              onViewMovement={openMovement}
              onGoHome={backToDashboard}
            />
          ) : movementId ? (
            <MovementDetail
              movementId={movementId}
              onBack={backToDashboard}
              onNavigateMovement={openMovement}
            />
          ) : segments[0] === 'inquiry' ? (
            <EquipmentInquiryScreen onSelectMovement={openMovement} />
          ) : (
            <HomeScreen
              onSelectMovement={openMovement}
              onCreateMovement={(type) =>
                router.push(`/movements/new?type=${type}`)
              }
            />
          )}
        </Layout>
        {passwordDialog}
      </>
    )
  }

  // Fail closed: only an explicit admin role reaches the admin interface.
  if (profile.role !== 'admin')
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4">
        <div className="card w-full max-w-md space-y-4 text-center">
          <p>{t('accountRoleUnavailable')}</p>
          <button
            className="btn-primary mx-auto"
            onClick={() => void signOut()}
          >
            {t('signOut')}
          </button>
        </div>
      </div>
    )

  const navItems = [
    {
      key: 'dashboard',
      label: t('dashboard'),
      icon: <LayoutDashboard size={18} />,
    },
    { key: 'logs', label: t('logs'), icon: <FileText size={18} /> },
    {
      key: 'inquiry',
      label: t('inquiryPageTitle'),
      icon: <Search size={18} />,
    },
    { key: 'equipment', label: t('equipment'), icon: <Truck size={18} /> },
    { key: 'projects', label: t('projects'), icon: <FolderKanban size={18} /> },
    { key: 'companies', label: t('companies'), icon: <Briefcase size={18} /> },
    { key: 'lessors', label: t('lessors'), icon: <Building2 size={18} /> },
    { key: 'drivers', label: t('drivers'), icon: <Contact size={18} /> },
    { key: 'users', label: t('users'), icon: <Users size={18} /> },
    { key: 'activity', label: t('activityLog'), icon: <History size={18} /> },
    {
      key: 'reports',
      label: t('reports'),
      icon: <BarChart3 size={18} />,
      children: [
        { key: 'reports/entries', label: t('entryReports') },
        { key: 'reports/equipment', label: t('equipmentReports') },
        { key: 'reports/workshop', label: t('workshopReports') },
      ],
    },
    {
      key: 'movement-import',
      label: t('movementImport'),
      icon: <FileUp size={18} />,
    },
    { key: 'settings', label: t('settings'), icon: <Settings size={18} /> },
  ]

  const navigate = (target: string) => router.push(`/${target}`)

  return (
    <>
      <Layout activePage={page} onNavigate={navigate} navItems={navItems}>
        {isMovementCreate ? (
          <MovementCreate
            movementType={movementType}
            onClose={() => router.push('/logs')}
            onViewMovement={openMovement}
            onGoHome={backToDashboard}
          />
        ) : movementId ? (
          <MovementDetail
            movementId={movementId}
            onBack={() => router.back()}
            onNavigateMovement={openMovement}
          />
        ) : equipmentId ? (
          <EquipmentDetail
            equipmentId={equipmentId}
            onBack={() => router.push('/equipment')}
            onEdit={(equipment) =>
              router.push(`/equipment?edit=${encodeURIComponent(equipment.id)}`)
            }
            onSelectMovement={openMovement}
            onViewAllMovements={(code) =>
              router.push(`/logs?q=${encodeURIComponent(code)}`)
            }
          />
        ) : driverId ? (
          <DriverDetail
            driverId={driverId}
            onBack={() => router.push('/drivers')}
          />
        ) : userId ? (
          <UserDetail userId={userId} onBack={() => router.push('/users')} />
        ) : (
          <>
            {page === 'dashboard' && (
              <AdminHomeScreen
                onSelectEquipment={(id) => router.push(`/equipment/${id}`)}
                onCreateMovement={(type) =>
                  router.push(`/movements/new?type=${type}`)
                }
              />
            )}
            {page === 'logs' && <LogsScreen onSelectMovement={openMovement} />}
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
            {page === 'reports' &&
              (segments[1] === 'workshop' ? (
                <WorkshopReports onSelectMovement={openMovement} />
              ) : segments[1] === 'equipment' ? (
                <EquipmentReports />
              ) : segments[1] === 'entries' && segments[2] === 'all' ? (
                <EntryReportsAll onSelectMovement={openMovement} />
              ) : (
                <EntryReports onSelectMovement={openMovement} />
              ))}
            {page === 'settings' && <AdminSettings />}
          </>
        )}
      </Layout>
      {passwordDialog}
    </>
  )
}

export default function App() {
  return <AppContent />
}
