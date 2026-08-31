'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { FullPageSpinner } from '@/components/Spinner'
import { Layout } from '@/components/Layout'
import { AuthScreen } from '@/screens/AuthScreen'
import type { Equipment } from '@/lib/types'
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
} from 'lucide-react'
import { FirstLoginPasswordDialog } from '@/components/FirstLoginPasswordDialog'

const screenLoading = () => <FullPageSpinner />

const SupervisorDashboard = dynamic(
  () =>
    import('@/screens/SupervisorDashboard').then(
      (module) => module.SupervisorDashboard,
    ),
  { loading: screenLoading },
)
const AdminDashboard = dynamic(
  () =>
    import('@/screens/AdminDashboard').then((module) => module.AdminDashboard),
  { loading: screenLoading },
)
const AdminEquipment = dynamic(
  () =>
    import('@/screens/AdminEquipment').then((module) => module.AdminEquipment),
  { loading: screenLoading },
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
  { loading: screenLoading },
)
const AdminCompanies = dynamic(
  () =>
    import('@/screens/AdminCompanies').then((module) => module.AdminCompanies),
  { loading: screenLoading },
)
const AdminLessors = dynamic(
  () => import('@/screens/AdminLessors').then((module) => module.AdminLessors),
  { loading: screenLoading },
)
const AdminUsers = dynamic(
  () => import('@/screens/AdminUsers').then((module) => module.AdminUsers),
  { loading: screenLoading },
)
const UserDetail = dynamic(
  () => import('@/screens/UserDetail').then((module) => module.UserDetail),
  { loading: screenLoading },
)
const AdminDrivers = dynamic(
  () => import('@/screens/AdminDrivers').then((module) => module.AdminDrivers),
  { loading: screenLoading },
)
const DriverDetail = dynamic(
  () => import('@/screens/DriverDetail').then((module) => module.DriverDetail),
  { loading: screenLoading },
)
const MovementDetail = dynamic(
  () =>
    import('@/screens/MovementDetail').then((module) => module.MovementDetail),
  { loading: screenLoading },
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
  { loading: screenLoading },
)

const ADMIN_PAGES = new Set([
  'dashboard',
  'logs',
  'equipment',
  'projects',
  'companies',
  'lessors',
  'drivers',
  'users',
  'movement-import',
  'activity',
  'settings',
])

function AppContent() {
  const { profile, loading } = useAuth()
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
  const page = ADMIN_PAGES.has(segments[0] ?? '') ? segments[0] : 'dashboard'

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])

  if (loading) return <FullPageSpinner />
  if (!profile) return <AuthScreen />

  const passwordDialog = <FirstLoginPasswordDialog />

  const openMovement = (id: string) => router.push(`/movements/${id}`)
  const backToDashboard = () => router.push('/dashboard')

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
            />
          ) : movementId ? (
            <MovementDetail
              movementId={movementId}
              onBack={backToDashboard}
              onNavigateMovement={openMovement}
            />
          ) : (
            <SupervisorDashboard
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

  const navItems = [
    {
      key: 'dashboard',
      label: t('dashboard'),
      icon: <LayoutDashboard size={18} />,
    },
    { key: 'logs', label: t('logs'), icon: <FileText size={18} /> },
    { key: 'equipment', label: t('equipment'), icon: <Truck size={18} /> },
    { key: 'projects', label: t('projects'), icon: <FolderKanban size={18} /> },
    { key: 'companies', label: t('companies'), icon: <Briefcase size={18} /> },
    { key: 'lessors', label: t('lessors'), icon: <Building2 size={18} /> },
    { key: 'drivers', label: t('drivers'), icon: <Contact size={18} /> },
    { key: 'users', label: t('users'), icon: <Users size={18} /> },
    { key: 'activity', label: t('activityLog'), icon: <History size={18} /> },
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
            onEdit={(equipment: Equipment) => {
              router.push('/equipment')
              setTimeout(
                () =>
                  window.dispatchEvent(
                    new CustomEvent('edit-equipment', { detail: equipment }),
                  ),
                0,
              )
            }}
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
            {(page === 'dashboard' || page === 'logs') && (
              <AdminDashboard
                onSelectMovement={openMovement}
                onCreateMovement={(type) =>
                  router.push(`/movements/new?type=${type}`)
                }
              />
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
