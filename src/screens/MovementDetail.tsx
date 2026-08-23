import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import type { TranslationKey } from '@/i18n/translations';
import { InlineSpinner } from '@/components/Spinner';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/Alert';
import { useAuth } from '@/auth/AuthContext';
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
  ChevronLeft,
  ChevronRight,
  X,
  Maximize2,
  Trash2,
  Upload,
  RefreshCw,
} from 'lucide-react';
import type { EntryExitLog, Company, Project, EntryExitPhoto, MovementDriverChange } from '@/lib/types';
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect';
import type { SelectOption } from '@/components/Select';
import { sanitizeSearchTerm } from '@/lib/search';
import { formatDate, formatDateTime } from '@/lib/dateFormat';

interface MovementDetailProps {
  movementId: string;
  onBack: () => void;
  onNavigateMovement: (id: string) => void;
}

function formatDuration(ms: number, t: (k: TranslationKey) => string): string {
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
  const { user, profile } = useAuth();
  const [log, setLog] = useState<EntryExitLog | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [linkedLog, setLinkedLog] = useState<EntryExitLog | null>(null);
  const [linkedCompany, setLinkedCompany] = useState<Company | null>(null);
  const [linkedProject, setLinkedProject] = useState<Project | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoItems, setPhotoItems] = useState<(EntryExitPhoto & { url: string })[]>([]);
  const [photoCarouselIndex, setPhotoCarouselIndex] = useState(0);
  const [fullImageOpen, setFullImageOpen] = useState(false);
  const [fullImageSrc, setFullImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkedError, setLinkedError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoActionError, setPhotoActionError] = useState<string | null>(null);
  const [driverChanges, setDriverChanges] = useState<MovementDriverChange[]>([]);
  const [driverEntryId, setDriverEntryId] = useState<string | null>(null);
  const [driverChangeOpen, setDriverChangeOpen] = useState(false);
  const [newDriverId, setNewDriverId] = useState('');
  const [newDriverOption, setNewDriverOption] = useState<SelectOption | null>(null);
  const [driverChangeNote, setDriverChangeNote] = useState('');
  const [driverChangeBusy, setDriverChangeBusy] = useState(false);
  const [driverChangeError, setDriverChangeError] = useState<string | null>(null);
  const photoUrls = photoItems.map((item) => item.url);

  const fetchData = useCallback(async () => {
    // Reset all movement-specific state so stale values from a previous
    // movement cannot bleed into the next one (especially when navigating
    // directly between linked ENTRY and EXIT records).
    setLog(null);
    setCompany(null);
    setProject(null);
    setLinkedLog(null);
    setLinkedCompany(null);
    setLinkedProject(null);
    setPhotoUrl(null);
    setPhotoItems([]);
    setPhotoCarouselIndex(0);
    setFullImageOpen(false);
    setFullImageSrc(null);
    setLinkedError(null);
    setDriverChanges([]);
    setDriverEntryId(null);
    setError(null);
    setLoading(true);

    try {
      const { data, error: fetchError } = await supabase
        .from('entry_exit_logs')
        .select('*, equipment:equipment(*), supervisor:profiles(*), driver:drivers(*)')
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

      const loadDriverChanges = async (entryId: string) => {
        const { data: changes } = await supabase.from('movement_driver_changes')
          .select('id,entry_log_id,previous_driver_id,previous_driver_name,new_driver_id,new_driver_name,changed_by,changed_at,note,changer:profiles!movement_driver_changes_changed_by_fkey(id,full_name,role,created_at)')
          .eq('entry_log_id', entryId).order('changed_at').order('id');
        setDriverEntryId(entryId);
        setDriverChanges((changes as unknown as MovementDriverChange[]) ?? []);
      };

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

      // Fetch photo signed URLs — prefer new entry_exit_photos table,
      // fall back to legacy photo_url if no new photo rows exist.
      const { data: photoRows, error: photoErr } = await supabase
        .from('entry_exit_photos')
        .select('*')
        .eq('entry_exit_log_id', movementId)
        .order('sort_order', { ascending: true });

      if (photoErr) {
        console.error(photoErr);
      } else if (photoRows && photoRows.length > 0) {
        const signedItems = await Promise.all(
          (photoRows as EntryExitPhoto[]).map(async (p) => {
            const { data: signed } = await supabase.storage
              .from('log-photos')
              .createSignedUrl(p.file_path, 3600);
            return signed?.signedUrl ? { ...p, url: signed.signedUrl } : null;
          })
        );
        setPhotoItems(signedItems.filter((item): item is EntryExitPhoto & { url: string } => item !== null));
      } else if (logData.photo_url) {
        const { data: signed } = await supabase.storage
          .from('log-photos')
          .createSignedUrl(logData.photo_url, 3600);
        if (signed?.signedUrl) setPhotoUrl(signed.signedUrl);
      }

      // Find linked movement using the same deterministic (recorded_at, id)
      // ordering as the database trigger, so ties on recorded_at are broken
      // by id consistently.
      if (logData.movement_type === 'entry') {
        await loadDriverChanges(logData.id);
        // Next EXIT: (recorded_at > entry) OR (recorded_at = entry AND id > entry.id)
        const { data: exitData, error: linkErr } = await supabase
          .from('entry_exit_logs')
          .select('*, supervisor:profiles(*)')
          .eq('equipment_id', logData.equipment_id)
          .eq('movement_context', logData.movement_context ?? 'site')
          .eq('movement_type', 'exit')
          .or(`recorded_at.gt.${logData.recorded_at},and(recorded_at.eq.${logData.recorded_at},id.gt.${logData.id})`)
          .order('recorded_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (linkErr) {
          setLinkedError(t('movementLoadError'));
        } else {
          setLinkedLog(exitData as EntryExitLog | null);
        }
      } else {
        // Preceding ENTRY: (recorded_at < exit) OR (recorded_at = exit AND id < exit.id)
        const { data: entryData, error: linkErr } = await supabase
          .from('entry_exit_logs')
          .select('*, supervisor:profiles(*)')
          .eq('equipment_id', logData.equipment_id)
          .eq('movement_context', logData.movement_context ?? 'site')
          .eq('movement_type', 'entry')
          .or(`recorded_at.lt.${logData.recorded_at},and(recorded_at.eq.${logData.recorded_at},id.lt.${logData.id})`)
          .order('recorded_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (linkErr) {
          setLinkedError(t('movementLoadError'));
        } else {
          const entryLog = entryData as EntryExitLog | null;
          setLinkedLog(entryLog);
          if (entryLog) await loadDriverChanges(entryLog.id);

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
      }
    } catch {
      setError(t('movementLoadError'));
    } finally {
      setLoading(false);
    }
  }, [movementId, t]);

  const loadDrivers = useCallback(async (query: string): Promise<SelectOption[]> => {
    let request = supabase.from('drivers').select('id,full_name,mobile_number').order('full_name').limit(20);
    const term = sanitizeSearchTerm(query);
    if (term) request = request.or(`full_name.ilike.%${term}%,mobile_number.ilike.%${term}%`);
    const { data } = await request;
    return (data ?? []).map((driver) => ({ value: driver.id, label: `${driver.full_name}${driver.mobile_number ? ` — ${driver.mobile_number}` : ''}` }));
  }, []);

  const changeDriver = async () => {
    if (!driverEntryId || !newDriverId) return;
    setDriverChangeBusy(true); setDriverChangeError(null);
    const { error: changeError } = await supabase.rpc('change_active_movement_driver', { p_entry_log_id: driverEntryId, p_new_driver_id: newDriverId, p_note: driverChangeNote.trim() || null });
    setDriverChangeBusy(false);
    if (changeError) { setDriverChangeError(t('driverChangeFailed')); return; }
    setDriverChangeOpen(false); setNewDriverId(''); setNewDriverOption(null); setDriverChangeNote('');
    await fetchData();
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || photoItems.length >= 3) return;
    const selected = Array.from(files);
    if (selected.length > 3 - photoItems.length || selected.some((file) => file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setPhotoActionError(t('invalidPhotosForMovement'));
      return;
    }
    setPhotoBusy(true); setPhotoActionError(null);
    const { data } = await supabase.auth.getSession();
    const form = new FormData(); selected.forEach((file) => form.append('photos', file));
    const response = await fetch(`/api/movements/${movementId}/photos`, { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` }, body: form });
    setPhotoBusy(false);
    if (!response.ok) { setPhotoActionError(t('photoUploadFailed')); return; }
    await fetchData();
  };

  const deletePhoto = async (photoId: string) => {
    if (!confirm(t('confirmDeletePhoto'))) return;
    setPhotoBusy(true); setPhotoActionError(null);
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/movements/${movementId}/photos`, { method: 'DELETE', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ photoId }) });
    setPhotoBusy(false);
    if (!response.ok) { setPhotoActionError(t('photoDeleteFailed')); return; }
    setPhotoCarouselIndex(0); await fetchData();
  };

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
  const isWorkshopMovement = log.movement_context === 'workshop';

  let durationMs = 0;

  if (linkedLog) {
    if (linkedLog.movement_type === 'exit') {
      // log الحالي = دخول، linkedLog = خروج
      durationMs = new Date(linkedLog.recorded_at).getTime() - new Date(log.recorded_at).getTime();
    } else if (linkedLog.movement_type === 'entry') {
      // log الحالي = خروج، linkedLog = دخول
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
            label={t('equipmentNameLabel')}
            value={log.equipment ? `${log.equipment.code} — ${log.equipment.type}` : '—'}
          />
          {isWorkshopMovement && isEntry && (
            <InfoRow
              icon={<FileText size={16} />}
              label={t('workshopPurpose')}
              value={log.workshop_purpose === 'maintenance' ? t('maintenancePurpose') : log.workshop_purpose === 'parking' ? t('parkingPurpose') : t('pendingClassification')}
            />
          )}
          {!isWorkshopMovement && (
            <>
              <InfoRow
                icon={<FileText size={16} />}
                label={t('contractorEquipmentCode')}
                value={log.contractor_equipment_code}
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
                icon={<User size={16} />}
                label={t('driverName')}
                value={log.driver?.full_name ?? log.driver_name}
              />
            </>
          )}
          {profile?.role === 'admin' && (
            <InfoRow
              icon={<User size={16} />}
              label={t('supervisorName')}
              value={log.supervisor?.full_name}
            />
          )}
          <InfoRow
            icon={<Clock size={16} />}
            label={t('movementDate')}
            value={formatDate(log.recorded_at)}
          />
          {profile?.role === 'admin' && (
            <InfoRow
              icon={<Clock size={16} />}
              label={t('createdAt')}
              value={log.created_at ? formatDateTime(log.created_at) : '—'}
            />
          )}
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

        {/* Photos */}
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Camera size={16} className="text-muted" />
            <p className="text-xs text-muted">{t('photo')}</p>
          </div>
          {photoActionError && <div className="mb-3"><Alert type="error">{photoActionError}</Alert></div>}
          {photoUrls.length > 0 ? (
            <div className="relative rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', height: '320px' }}>
              <div className="absolute inset-0 flex items-center justify-center">
                <img
                  src={photoUrls[photoCarouselIndex]}
                  alt={`Photo ${photoCarouselIndex + 1}`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <button
                type="button"
                onClick={() => { setFullImageSrc(photoUrls[photoCarouselIndex]); setFullImageOpen(true); }}
                className="absolute top-1 end-1 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
              >
                <Maximize2 size={16} />
              </button>
              {(photoItems[photoCarouselIndex]?.uploaded_by === user?.id || profile?.role === 'admin') && (
                <button type="button" disabled={photoBusy} onClick={() => deletePhoto(photoItems[photoCarouselIndex].id)} className="absolute top-1 start-1 rounded-full bg-red-600/80 p-1.5 text-white hover:bg-red-700"><Trash2 size={16} /></button>
              )}
              {photoUrls.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPhotoCarouselIndex((prev) => (prev - 1 + photoUrls.length) % photoUrls.length)}
                    className="absolute start-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoCarouselIndex((prev) => (prev + 1) % photoUrls.length)}
                    className="absolute end-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <ChevronRight size={20} />
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white bg-black/50 rounded-full px-2 py-0.5">
                    {photoCarouselIndex + 1} / {photoUrls.length}
                  </span>
                </>
              )}
            </div>
          ) : photoUrl ? (
            <div className="relative rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', height: '320px' }}>
              <div className="absolute inset-0 flex items-center justify-center">
                <img src={photoUrl} alt={t('photo')} className="max-h-full max-w-full object-contain" />
              </div>
              <button
                type="button"
                onClick={() => { setFullImageSrc(photoUrl); setFullImageOpen(true); }}
                className="absolute top-1 end-1 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
              >
                <Maximize2 size={16} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted italic">{t('noPhoto')}</p>
          )}
          {photoItems.length < 3 && (
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border)' }}>
              <Upload size={16} />{photoBusy ? t('loading') : t('addPhoto')}
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={photoBusy} onChange={(event) => { addPhotos(event.target.files); event.target.value = ''; }} />
            </label>
          )}
        </div>
      </div>

      {driverEntryId && log.movement_context !== 'workshop' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="font-bold">{t('driverChangeHistory')}</h3><p className="text-xs text-muted">{t('currentDriver')}: {driverChanges.at(-1)?.new_driver_name ?? (isEntry ? log.driver_name : linkedLog?.driver_name) ?? '—'}</p></div>
            {isEntry && !linkedLog && profile?.role !== 'workshop' && <button className="btn-outline" onClick={() => setDriverChangeOpen((value) => !value)}><RefreshCw size={16} />{t('changeDriver')}</button>}
          </div>
          {driverChangeOpen && <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
            <div><label className="label">{t('newDriver')} *</label><AsyncSearchSelect value={newDriverId} selectedOption={newDriverOption} onChange={(value, option) => { setNewDriverId(value); setNewDriverOption(option); }} loadOptions={loadDrivers} placeholder={t('selectDriver')} /></div>
            <div><label className="label">{t('notes')}</label><input className="input" value={driverChangeNote} onChange={(event) => setDriverChangeNote(event.target.value)} placeholder={t('notesPlaceholder')} /></div>
            {driverChangeError && <Alert type="error">{driverChangeError}</Alert>}
            <div className="flex gap-2"><button className="btn-outline flex-1" onClick={() => setDriverChangeOpen(false)}>{t('cancel')}</button><button className="btn-primary flex-1" disabled={!newDriverId || driverChangeBusy} onClick={changeDriver}>{driverChangeBusy ? t('saving') : t('save')}</button></div>
          </div>}
          {driverChanges.length === 0 ? <p className="text-sm text-muted">{t('noDriverChanges')}</p> : <div className="space-y-2">{driverChanges.map((change) => <div key={change.id} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}><p><span className="font-medium">{change.previous_driver_name}</span> ← <span className="font-medium">{change.new_driver_name}</span></p><p className="text-xs text-muted">{formatDateTime(change.changed_at)}{change.changer?.full_name ? ` — ${change.changer.full_name}` : ''}</p>{change.note && <p className="mt-1 text-xs">{change.note}</p>}</div>)}</div>}
        </div>
      )}

      {/* Linked movement section */}
      {isEntry ? (
        <div className="card">
          <h3 className="text-sm font-bold text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            <Link2 size={16} /> {t('linkedExit')}
          </h3>
          {linkedError ? (
            <Alert type="error">{linkedError}</Alert>
          ) : linkedLog ? (
            <div className="space-y-2">
              <InfoRow
                icon={<Clock size={16} />}
                label={t('movementDate')}
                value={formatDate(linkedLog.recorded_at)}
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
          {linkedError ? (
            <Alert type="error">{linkedError}</Alert>
          ) : linkedLog ? (
            <div className="space-y-2">
              <InfoRow
                icon={<Clock size={16} />}
                label={t('movementDate')}
                value={formatDate(linkedLog.recorded_at)}
              />
              {!isWorkshopMovement && (
                <>
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
                </>
              )}
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

      {/* Full image modal */}
      {fullImageOpen && fullImageSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setFullImageOpen(false)}
        >
          <button
            onClick={() => setFullImageOpen(false)}
            className="absolute top-4 end-4 rounded-full p-2 bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X size={24} />
          </button>
          <img
            src={fullImageSrc}
            alt={t('photo')}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
