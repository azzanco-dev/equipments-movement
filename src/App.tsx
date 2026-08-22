import { useState } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { I18nProvider, useI18n } from '@/i18n/I18nContext';
import { ThemeProvider } from '@/theme/ThemeContext';
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
import { MovementDetail } from '@/screens/MovementDetail';
import type { Equipment } from '@/lib/types';
import { LayoutDashboard, FileText, Truck, FolderKanban, Building2, Users, Briefcase } from 'lucide-react';

function AppContent() {
  const { profile, loading } = useAuth();
  const { t } = useI18n();
  const [adminPage, setAdminPage] = useState('dashboard');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);

  if (loading) return <FullPageSpinner />;
  if (!profile) return <AuthScreen />;

  if (profile.role === 'supervisor') {
    return (
      <Layout activePage="dashboard" onNavigate={() => {}} navItems={[]}>
        {selectedMovementId ? (
          <MovementDetail
            movementId={selectedMovementId}
            onBack={() => setSelectedMovementId(null)}
            onNavigateMovement={setSelectedMovementId}
          />
        ) : (
          <SupervisorDashboard onSelectMovement={setSelectedMovementId} />
        )}
      </Layout>
    );
  }

  // Admin
  const navItems = [
    { key: 'dashboard', label: t('dashboard'), icon: <LayoutDashboard size={18} /> },
    { key: 'logs', label: t('logs'), icon: <FileText size={18} /> },
    { key: 'equipment', label: t('equipment'), icon: <Truck size={18} /> },
    { key: 'projects', label: t('projects'), icon: <FolderKanban size={18} /> },
    { key: 'companies', label: t('companies'), icon: <Briefcase size={18} /> },
    { key: 'lessors', label: t('lessors'), icon: <Building2 size={18} /> },
    { key: 'users', label: t('users'), icon: <Users size={18} /> },
  ];

  function handleNavigate(page: string) {
    setSelectedEquipmentId(null);
    setSelectedMovementId(null);
    setAdminPage(page);
  }

  return (
    <Layout activePage={adminPage} onNavigate={handleNavigate} navItems={navItems}>
      {selectedMovementId ? (
        <MovementDetail
          movementId={selectedMovementId}
          onBack={() => setSelectedMovementId(null)}
          onNavigateMovement={setSelectedMovementId}
        />
      ) : (
        <>
          {adminPage === 'dashboard' && <AdminDashboard onSelectMovement={setSelectedMovementId} />}
          {adminPage === 'logs' && <AdminDashboard onSelectMovement={setSelectedMovementId} />}
          {adminPage === 'equipment' && (
            selectedEquipmentId ? (
              <EquipmentDetail
                equipmentId={selectedEquipmentId}
                onBack={() => setSelectedEquipmentId(null)}
                onEdit={(eq: Equipment) => {
                  setSelectedEquipmentId(null);
                  // Defer to next tick so detail unmounts first
                  setTimeout(() => {
                    const event = new CustomEvent('edit-equipment', { detail: eq });
                    window.dispatchEvent(event);
                  }, 0);
                }}
                onSelectMovement={setSelectedMovementId}
              />
            ) : (
              <AdminEquipment onSelectEquipment={setSelectedEquipmentId} />
            )
          )}
          {adminPage === 'projects' && <AdminProjects />}
          {adminPage === 'companies' && <AdminCompanies />}
          {adminPage === 'lessors' && <AdminLessors />}
          {adminPage === 'users' && <AdminUsers />}
        </>
      )}
    </Layout>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
