'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { FullPageSpinner } from '@/components/Spinner';
import { Layout } from '@/components/Layout';
import { AuthScreen } from '@/screens/AuthScreen';
import { SupervisorDashboard } from '@/screens/SupervisorDashboard';
import { AdminDashboard } from '@/screens/AdminDashboard';
import { AdminEquipment } from '@/screens/AdminEquipment';
import { EquipmentDetail } from '@/screens/EquipmentDetail';
import { AdminProjects } from '@/screens/AdminProjects';
import { AdminCompanies } from '@/screens/AdminCompanies';
import { AdminLessors } from '@/screens/AdminLessors';
import { AdminUsers } from '@/screens/AdminUsers';
import { AdminDrivers } from '@/screens/AdminDrivers';
import { DriverDetail } from '@/screens/DriverDetail';
import { MovementDetail } from '@/screens/MovementDetail';
import type { Equipment } from '@/lib/types';
import { LayoutDashboard, FileText, Truck, FolderKanban, Building2, Users, Briefcase, Contact } from 'lucide-react';

const ADMIN_PAGES = new Set(['dashboard', 'logs', 'equipment', 'projects', 'companies', 'lessors', 'drivers', 'users']);

function AppContent() {
  const { profile, loading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const movementId = segments[0] === 'movements' ? segments[1] : null;
  const equipmentId = segments[0] === 'equipment' ? segments[1] : null;
  const driverId = segments[0] === 'drivers' ? segments[1] : null;
  const page = ADMIN_PAGES.has(segments[0] ?? '') ? segments[0] : 'dashboard';

  if (loading) return <FullPageSpinner />;
  if (!profile) return <AuthScreen />;

  const openMovement = (id: string) => router.push(`/movements/${id}`);
  const backToDashboard = () => router.push('/dashboard');

  if (profile.role === 'supervisor') {
    return (
      <Layout activePage="dashboard" onNavigate={backToDashboard} navItems={[]}>
        {movementId ? (
          <MovementDetail movementId={movementId} onBack={backToDashboard} onNavigateMovement={openMovement} />
        ) : (
          <SupervisorDashboard onSelectMovement={openMovement} />
        )}
      </Layout>
    );
  }

  const navItems = [
    { key: 'dashboard', label: t('dashboard'), icon: <LayoutDashboard size={18} /> },
    { key: 'logs', label: t('logs'), icon: <FileText size={18} /> },
    { key: 'equipment', label: t('equipment'), icon: <Truck size={18} /> },
    { key: 'projects', label: t('projects'), icon: <FolderKanban size={18} /> },
    { key: 'companies', label: t('companies'), icon: <Briefcase size={18} /> },
    { key: 'lessors', label: t('lessors'), icon: <Building2 size={18} /> },
    { key: 'drivers', label: t('drivers'), icon: <Contact size={18} /> },
    { key: 'users', label: t('users'), icon: <Users size={18} /> },
  ];

  const navigate = (target: string) => router.push(`/${target}`);

  return (
    <Layout activePage={page} onNavigate={navigate} navItems={navItems}>
      {movementId ? (
        <MovementDetail movementId={movementId} onBack={() => router.back()} onNavigateMovement={openMovement} />
      ) : equipmentId ? (
        <EquipmentDetail
          equipmentId={equipmentId}
          onBack={() => router.push('/equipment')}
          onEdit={(equipment: Equipment) => {
            router.push('/equipment');
            setTimeout(() => window.dispatchEvent(new CustomEvent('edit-equipment', { detail: equipment })), 0);
          }}
          onSelectMovement={openMovement}
        />
      ) : driverId ? (
        <DriverDetail driverId={driverId} onBack={() => router.push('/drivers')} />
      ) : (
        <>
          {(page === 'dashboard' || page === 'logs') && <AdminDashboard onSelectMovement={openMovement} />}
          {page === 'equipment' && <AdminEquipment onSelectEquipment={(id) => router.push(`/equipment/${id}`)} />}
          {page === 'projects' && <AdminProjects />}
          {page === 'companies' && <AdminCompanies />}
          {page === 'lessors' && <AdminLessors />}
          {page === 'drivers' && <AdminDrivers onSelectDriver={(id) => router.push(`/drivers/${id}`)} />}
          {page === 'users' && <AdminUsers />}
        </>
      )}
    </Layout>
  );
}

export default function App() {
  return <AppContent />;
}
