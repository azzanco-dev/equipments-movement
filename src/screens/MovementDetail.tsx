import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { InlineSpinner } from '@/components/Spinner';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/Alert';
import {
  ArrowLeft,
  LogIn,
  LogOut,
  Truck,
  Building2,
  MapPin,
  FileText,
  User,
  Clock,
  Camera,
  StickyNote,
  Link2,
  ExternalLink,
} from 'lucide-react';
import type { EntryExitLog, Company, Project } from '@/lib/types';

interface MovementDetailProps {
  movementId: string;
  onBack: () => void;
  onNavigateMovement: (id: string) => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number, t: (k: string) => string): string {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${t('days')}`);
  if (hours > 0) parts.push(`${hours} ${t('hours')}`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} ${t('minutes')}`);
  return parts.join(' ');
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="text-muted mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="font-medium break-words">{value || '—'}</p>
      </div>
    </div>
  );
}

export function MovementDetail({ movementId, onBack, onNavigateMovement }: MovementDetailProps) {
  const { t } = useI18n();
  const [log, setLog] = useState<EntryExitLog | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [linkedLog, setLinkedLog] = useState<EntryExitLog | null>(null);
  const [linkedCompany, setLinkedCompany] = useState<Company | null>(null);
  const [linkedProject, setLinkedProject] = useState<Project | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('entry_exit_logs')
        .select('*, equipment:equipment(*), supervisor:profiles(*)')
        .eq('id', movementId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!data) {
        setError(t('movementNotFound'));
        setLoading(false);
        return;
      }

      const logData = data as EntryExitLog;
      setLog(logData);

      // Fetch company and project names
      if (logData.company_id) {
        const { data: comp } = await supabase
          .from('companies')
          .select('*')
          .eq('id', logData.company_id)
          .maybeSingle();
        setCompany(comp as Company | null);
      }
      if (logData.project_id) {
        const { data: proj } = await supabase
          .from('projects')
          .select('*')
          .eq('id', logData.project_id)
          .maybeSingle();
        setProject(proj as Project | null);
      }

      // Fetch photo signed URL
      if (logData.photo_url) {
        const { data: signed } = await supabase.storage
          .from('log-photos')
          .createSignedUrl(logData.photo_url, 3600);
        if (signed?.signedUrl) setPhotoUrl(signed.signedUrl);
      }

      // Find linked movement
      if (logData.movement_type === 'entry') {
        // Find the next EXIT after this entry
        const { data: exitData } = await supabase
          .from('entry_exit_logs')
          .select('*, supervisor:profiles(*)')
          .eq('equipment_id', logData.equipment_id)
          .eq('movement_type', 'exit')
          .gt('recorded_at', logData.recorded_at)
          .order('recorded_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        setLinkedLog(exitData as EntryExitLog | null);
      } else {
        // Find the preceding ENTRY before this exit
        const { data: entryData } = await supabase
          .from('entry_exit_logs')
          .select('*, supervisor:profiles(*)')
          .eq('equipment_id', logData.equipment_id)
          .eq('movement_type', 'entry')
          .lt('recorded_at', logData.recorded_at)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const entryLog = entryData as EntryExitLog | null;
        setLinkedLog(entryLog);

        // Fetch linked entry's company/project
        if (entryLog?.company_id) {
          const { data: comp } = await supabase
            .from('companies')
            .select('*')
            .eq('id', entryLog.company_id)
            .maybeSingle();
          setLinkedCompany(comp as Company | null);
        }
        if (entryLog?.project_id) {
          const { data: proj } = await supabase
            .from('projects')
            .select('*')
            .eq('id', entryLog.project_id)
            .maybeSingle();
          setLinkedProject(proj as Project | null);
        }
      }
    } catch {
      setError(t('movementLoadError'));
    } finally {
      setLoading(false);
    }
  }, [movementId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <InlineSpinner label={t('loading')} />;

  if (error) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="btn-ghost">
          <ArrowLeft size={18} /> {t('backToMovements')}
        </button>
        <Alert type="error">{error}</Alert>
      </div>
    );
  }

  if (!log) return null;

  const isEntry = log.movement_type === 'entry';  
  let durationMs = 0;

  if (linkedLog) {
    console.log('linked', linkedLog)
    if (linkedLog.movementType === 'entry') {
      console.log('pre is entry')
      durationMs = new Date(linkedLog.recorded_at).getTime() - new Date(log.recorded_at).getTime();
    } else if (linkedLog.movementType === 'exit') {
      console.log('pre is exit')
      durationMs = new Date(log.recorded_at).getTime() - new Date(linkedLog.recorded_at).getTime();
    }
  }

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="btn-ghost">
        <ArrowLeft size={18} /> {t('backToMovements')}
      </button>

      <PageHeader
        title={t('movementDetails')}
        description={t('movementDetailsDesc')}
      />

      {/* Movement type banner */}
      <div
        className="rounded-xl border p-4 flex items-center gap-3"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{
            background: isEntry
              ? 'rgba(34,197,94,0.12)'
              : 'rgba(245,158,11,0.12)',
          }}
        >
          {isEntry ? (
            <LogIn size={20} className="text-green-600 dark:text-green-400" />
          ) : (
            <LogOut size={20} className="text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <div>
          <p className="text-xs text-muted">{t('movementType')}</p>
          <p className="font-bold text-lg">{isEntry ? t('entry') : t('exit')}</p>
        </div>
      </div>

      {/* Main details card */}
      <div className="card">
        <h3 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">
          {t('movementDetails')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          <InfoRow
            icon={<Truck size={16} />}
            label={t('equipmentCodeLabel')}
            value={log.equipment ? `${log.equipment.code} — ${log.equipment.type}` : '—'}
          />
          <InfoRow
            icon={<Building2 size={16} />}
            label={t('company')}
            value={company ? `${company.name_ar} — ${company.name_en}` : '—'}
          />
          <InfoRow
            icon={<MapPin size={16} />}
            label={t('project')}
            value={project ? `${project.name_ar} — ${project.name_en}` : '—'}
          />
          <InfoRow
            icon={<FileText size={16} />}
            label={t('contractorEquipmentCode')}
            value={log.contractor_equipment_code}
          />
          <InfoRow
            icon={<User size={16} />}
            label={t('driverName')}
            value={log.driver_name}
          />
          <InfoRow
            icon={<User size={16} />}
            label={t('supervisorName')}
            value={log.supervisor?.full_name}
          />
          <InfoRow
            icon={<Clock size={16} />}
            label={t('movementDate')}
            value={formatDateTime(log.recorded_at)}
          />
          <InfoRow
            icon={<Clock size={16} />}
            label={t('registrationMethod')}
            value={log.registration_method === 'qr' ? t('qr') : t('manual')}
          />
        </div>

        {/* Notes */}
        {log.notes && (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-start gap-3">
              <StickyNote size={16} className="text-muted mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted">{t('notes')}</p>
                <p className="font-medium whitespace-pre-wrap">{log.notes}</p>
              </div>
            </div>
          </div>
        )}

        {/* Photo */}
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Camera size={16} className="text-muted" />
            <p className="text-xs text-muted">{t('photo')}</p>
          </div>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={t('photo')}
              className="rounded-lg max-h-80 object-cover"
            />
          ) : (
            <p className="text-sm text-muted italic">{t('noPhoto')}</p>
          )}
        </div>
      </div>

      {/* Linked movement section */}
      {isEntry ? (
        <div className="card">
          <h3 className="text-sm font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            <Link2 size={16} /> {t('linkedExit')}
          </h3>
          {linkedLog ? (
            <div className="space-y-2">
              <InfoRow
                icon={<Clock size={16} />}
                label={t('movementDate')}
                value={formatDateTime(linkedLog.recorded_at)}
              />
              <div className="flex items-center gap-3 py-2">
                <Clock size={16} className="text-muted shrink-0" />
                <div>
                  <p className="text-xs text-muted">{t('durationOnSite')}</p>
                  <p className="font-medium">{formatDuration(durationMs, t)}</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateMovement(linkedLog.id)}
                className="btn-outline mt-2"
              >
                <ExternalLink size={16} /> {t('viewDetails')}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted italic">{t('notExitedYet')}</p>
          )}
        </div>
      ) : (
        <div className="card">
          <h3 className="text-sm font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            <Link2 size={16} /> {t('linkedEntry')}
          </h3>
          {linkedLog ? (
            <div className="space-y-2">
              <InfoRow
                icon={<Clock size={16} />}
                label={t('movementDate')}
                value={formatDateTime(linkedLog.recorded_at)}
              />
              <InfoRow
                icon={<Building2 size={16} />}
                label={t('company')}
                value={linkedCompany ? `${linkedCompany.name_ar} — ${linkedCompany.name_en}` : '—'}
              />
              <InfoRow
                icon={<MapPin size={16} />}
                label={t('project')}
                value={linkedProject ? `${linkedProject.name_ar} — ${linkedProject.name_en}` : '—'}
              />
              <InfoRow
                icon={<FileText size={16} />}
                label={t('contractorEquipmentCode')}
                value={linkedLog.contractor_equipment_code}
              />
              <div className="flex items-center gap-3 py-2">
                <Clock size={16} className="text-muted shrink-0" />
                <div>
                  <p className="text-xs text-muted">{t('durationOnSite')}</p>
                  <p className="font-medium">{formatDuration(durationMs, t)}</p>
                </div>
              </div>
              <button
                onClick={() => onNavigateMovement(linkedLog.id)}
                className="btn-outline mt-2"
              >
                <ExternalLink size={16} /> {t('viewDetails')}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted italic">—</p>
          )}
        </div>
      )}
    </div>
  );
}
