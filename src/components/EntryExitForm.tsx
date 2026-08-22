import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { QRScanner } from '@/components/QRScanner';
import { Spinner } from '@/components/Spinner';
import { QrCode, Search, Upload, AlertTriangle, CheckCircle, Clock, MapPin, Building2, FileText } from 'lucide-react';
import type { Equipment, MovementType, LastMovement, Company, Project } from '@/lib/types';
import { Select } from '@/components/Select';
import { sanitizeSearchTerm } from '@/lib/search';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_ODOMETER = 10000000;

interface EntryExitFormProps {
  open: boolean;
  onClose: () => void;
  movementType: MovementType;
  onSaved: () => void;
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

export function EntryExitForm({ open, onClose, movementType, onSaved }: EntryExitFormProps) {
  const { t } = useI18n();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [step, setStep] = useState<'select' | 'details'>('select');
  const [scanOpen, setScanOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [lastMovement, setLastMovement] = useState<LastMovement | null>(null);
  const [loadingMovement, setLoadingMovement] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [driverName, setDriverName] = useState('');
  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [contractorCode, setContractorCode] = useState('');
  const [recordedAt, setRecordedAt] = useState('');

  const isEntry = movementType === 'entry';

  const reset = useCallback(() => {
    setStep('select');
    setSearch('');
    setSelected(null);
    setLastMovement(null);
    setLoadingMovement(false);
    setValidationError(null);
    setDriverName('');
    setOdometer('');
    setNotes('');
    setPhotoFile(null);
    setSaveError(null);
    setSelectedCompanyId('');
    setSelectedProjectId('');
    setContractorCode('');
    setRecordedAt('');
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    supabase.from('companies').select('*').order('name_ar').then(({ data }) => setCompanies((data as Company[]) ?? []));
    supabase.from('projects').select('*').order('name_ar').then(({ data }) => setProjects((data as Project[]) ?? []));
  }, [open]);

  // Search equipment
  useEffect(() => {
    if (!open || step !== 'select') return;
    let active = true;
    setLoadingEquipment(true);

    const query = supabase
      .from('equipment')
      .select('*, project:projects(*), lessor:lessors(*)')
      .eq('is_active', true)
      .order('code');

    const term = sanitizeSearchTerm(search);
    if (term) {
      query.or(`code.ilike.%${term}%,type.ilike.%${term}%`);
    }

    query.limit(50).then(({ data, error }) => {
      if (!active) return;
      if (error) console.error(error);
      setEquipment((data as Equipment[]) ?? []);
      setLoadingEquipment(false);
    });

    return () => { active = false; };
  }, [open, step, search]);

  // Check last movement when equipment is selected
  const checkLastMovement = useCallback(async (eq: Equipment): Promise<LastMovement | null> => {
    setLoadingMovement(true);
    setValidationError(null);

    const { data, error } = await supabase
      .rpc('get_last_movement', { p_equipment_id: eq.id });

    setLoadingMovement(false);

    if (error) {
      console.error(error);
      setSaveError(t('saveFailed'));
      return null;
    }

    const last = (data as LastMovement[])[0] ?? null;
    setLastMovement(last);

    // Validation logic
    if (isEntry) {
      if (last && last.movement_type === 'entry') {
        setValidationError(t('entryBlockedMsg'));
      } else {
        setValidationError(null);
      }
    } else {
      if (!last) {
        setValidationError(t('exitNoPreviousMsg'));
      } else if (last.movement_type === 'exit') {
        setValidationError(t('exitBlockedMsg'));
      } else {
        setValidationError(null);
      }
    }

    return last;
  }, [isEntry, t]);

  const handleSelectEquipment = (eq: Equipment) => {
    setSelected(eq);
    setSaveError(null);
    setValidationError(null);
    setStep('details');
    // Fire async; don't block UI
    checkLastMovement(eq);
  };

  const handleQRScan = async (decoded: string) => {
    setScanOpen(false);
    const { data, error } = await supabase
      .from('equipment')
      .select('*, project:projects(*), lessor:lessors(*)')
      .eq('qr_value', decoded)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      setSaveError(t('noEquipmentFound'));
      return;
    }

    handleSelectEquipment(data as Equipment);
  };

  const handleSave = async () => {
    if (!selected || !user) return;
    if (validationError) return;

    let odometerValue: number | null = null;
    if (odometer.trim()) {
      const parsed = parseFloat(odometer);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed >= MAX_ODOMETER) {
        setSaveError(t('saveFailed'));
        return;
      }
      odometerValue = parsed;
    }

    setSaving(true);
    setSaveError(null);

    try {
      let photoUrl: string | null = null;

      // Upload photo if provided
      if (photoFile) {
        if (!ALLOWED_PHOTO_TYPES.includes(photoFile.type)) {
          setSaveError(t('invalidPhotoType'));
          setSaving(false);
          return;
        }
        if (photoFile.size > MAX_PHOTO_BYTES) {
          setSaveError(t('photoTooLarge'));
          setSaving(false);
          return;
        }
        const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
        const fileName = `${user.id}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from('log-photos')
          .upload(fileName, photoFile);

        if (uploadError) throw uploadError;
        photoUrl = fileName;
      }

      const payload: Record<string, unknown> = {
        equipment_id: selected.id,
        supervisor_id: user.id,
        movement_type: movementType,
        registration_method: 'qr' in window && scanOpen ? 'qr' : 'manual',
        driver_name: driverName || null,
        odometer_reading: odometerValue,
        notes: notes || null,
        photo_url: photoUrl,
      };

      // ENTRY: client supplies company, project, and contractor code.
      // EXIT: the database trigger inherits these from the latest entry, so the
      // client must not send them.
      if (isEntry) {
        payload.company_id = selectedCompanyId || null;
        payload.project_id = selectedProjectId || null;
        payload.contractor_equipment_code = contractorCode.trim() || null;
      }

      // Admins may supply a custom recorded_at; non-admins get now() from the trigger.
      if (isAdmin && recordedAt.trim()) {
        payload.recorded_at = new Date(recordedAt).toISOString();
      }

      const { error } = await supabase.from('entry_exit_logs').insert(payload);

      if (error) throw error;

      onSaved();
      onClose();
      reset();
    } catch (err) {
      console.error(err);
      // The most likely cause of a DB rejection here is a stale frontend state:
      // another user recorded a movement between our check and our submit.
      // Refresh the latest movement state and show a clean message.
      setSaveError(t('movementStateChanged'));
      checkLastMovement(selected);
    } finally {
      setSaving(false);
    }
  };

  // Resolve company/project names for the exit brief
  const lastEntryCompany = useMemo(() => {
    if (!lastMovement?.company_id) return null;
    return companies.find((c) => c.id === lastMovement.company_id) ?? null;
  }, [lastMovement, companies]);

  const lastEntryProject = useMemo(() => {
    if (!lastMovement?.project_id) return null;
    return projects.find((p) => p.id === lastMovement.project_id) ?? null;
  }, [lastMovement, projects]);

  // Current status derived from last movement
  const currentStatus: 'inside' | 'outside' | 'none' = !lastMovement
    ? 'none'
    : lastMovement.movement_type === 'entry'
      ? 'inside'
      : 'outside';

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={isEntry ? t('registerEntry') : t('registerExit')}
        size="lg"
      >
        {step === 'select' && (
          <div className="space-y-4">
            {/* QR Scan button */}
            <button
              onClick={() => setScanOpen(true)}
              className="btn-primary w-full py-3.5"
            >
              <QrCode size={20} />
              {t('scanQR')}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
              <span className="text-xs text-muted">{t('manualSelect')}</span>
              <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={18} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted" />
              <input
                type="text"
                className="input ps-10"
                placeholder={t('searchingEquipment')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            {/* Equipment list */}
            {loadingEquipment ? (
              <div className="flex justify-center py-8"><Spinner size={24} /></div>
            ) : equipment.length === 0 ? (
              <p className="text-center text-sm text-muted py-8">{t('noEquipmentFound')}</p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-2">
                {equipment.map((eq) => (
                  <button
                    key={eq.id}
                    onClick={() => handleSelectEquipment(eq)}
                    className="w-full text-start rounded-lg border p-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{eq.code}</p>
                        <p className="text-xs text-muted">{eq.type}</p>
                        {eq.plate_number && <p className="text-xs text-muted">{t('plateNumber')}: {eq.plate_number}</p>}
                      </div>
                      <div className="text-end">
                        <span className="badge border" style={{ borderColor: 'var(--border)' }}>
                          {eq.ownership_status === 'owned' ? t('owned') : t('rented')}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'details' && selected && (
          <div className="space-y-4">
            {/* Selected equipment info */}
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold">{selected.code}</h3>
                <button
                  onClick={() => { setStep('select'); setSelected(null); }}
                  className="text-xs text-muted hover:text-fg"
                >
                  {t('back')}
                </button>
              </div>
              <p className="text-sm text-muted">{selected.type}</p>
              {selected.plate_number && <p className="text-sm text-muted">{t('plateNumber')}: {selected.plate_number}</p>}
              {selected.project && <p className="text-sm text-muted">{t('project')}: {selected.project.name_ar} — {selected.project.name_en}</p>}
            </div>

            {/* Latest movement brief card */}
            {loadingMovement ? (
              <div className="flex items-center justify-center py-4">
                <Spinner size={20} />
              </div>
            ) : (
              <div
                className="rounded-lg border p-4 space-y-2"
                style={{
                  borderColor: validationError ? 'var(--fg)' : 'var(--border)',
                  background: 'var(--surface)',
                }}
              >
                {/* Header line */}
                <div className="flex items-center gap-2 text-sm font-medium">
                  {currentStatus === 'inside' ? (
                    <>
                      <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
                      <span>{t('currentStatus')}: {t('insideSite')}</span>
                    </>
                  ) : currentStatus === 'outside' ? (
                    <>
                      <MapPin size={16} className="text-amber-600 dark:text-amber-400" />
                      <span>{t('currentStatus')}: {t('outsideSite')}</span>
                    </>
                  ) : (
                    <>
                      <Clock size={16} className="text-muted" />
                      <span>{t('noPreviousMovement')}</span>
                    </>
                  )}
                </div>

                {/* Last movement detail */}
                {lastMovement && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Clock size={14} />
                    <span>
                      {t('lastMovement')}: {lastMovement.movement_type === 'entry' ? t('entry') : t('exit')} — {formatDateTime(lastMovement.recorded_at)}
                    </span>
                  </div>
                )}

                {/* Allowed / blocked indicator */}
                {!validationError && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle size={14} className="text-green-600 dark:text-green-400" />
                    <span className="text-green-700 dark:text-green-300">
                      {isEntry ? t('entryAllowed') : t('exitAllowed')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Validation warning */}
            {validationError && (
              <Alert type="error">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{validationError}</span>
                </div>
              </Alert>
            )}

            {/* EXIT: read-only latest entry brief (only when exit is valid) */}
            {!isEntry && !validationError && lastMovement && (
              <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <p className="text-sm font-medium">{t('latestEntryBrief')}</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Building2 size={14} className="text-muted" />
                    <span className="text-muted">{t('company')}:</span>
                    <span className="font-medium">
                      {lastEntryCompany ? `${lastEntryCompany.name_ar} — ${lastEntryCompany.name_en}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-muted" />
                    <span className="text-muted">{t('project')}:</span>
                    <span className="font-medium">
                      {lastEntryProject ? `${lastEntryProject.name_ar} — ${lastEntryProject.name_en}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-muted" />
                    <span className="text-muted">{t('contractorEquipmentCode')}:</span>
                    <span className="font-medium" dir="ltr">
                      {lastMovement.contractor_equipment_code || '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-muted" />
                    <span className="text-muted">{t('entryDateTime')}:</span>
                    <span className="font-medium">{formatDateTime(lastMovement.recorded_at)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Form fields */}
            <div className="space-y-4">
              {isEntry ? (
                <>
                  <div>
                    <label className="label">{t('company')} *</label>
                    <Select
                      value={selectedCompanyId}
                      onChange={setSelectedCompanyId}
                      placeholder="—"
                      searchable
                      options={[
                        { value: '', label: '—' },
                        ...companies.map((c) => ({ value: c.id, label: `${c.name_ar} — ${c.name_en}` })),
                      ]}
                    />
                  </div>

                  <div>
                    <label className="label">{t('project')} *</label>
                    <Select
                      value={selectedProjectId}
                      onChange={setSelectedProjectId}
                      placeholder="—"
                      searchable
                      options={[
                        { value: '', label: '—' },
                        ...projects.map((p) => ({ value: p.id, label: `${p.name_ar} — ${p.name_en}` })),
                      ]}
                    />
                  </div>

                  <div>
                    <label className="label">{t('contractorEquipmentCode')}</label>
                    <input
                      type="text"
                      className="input"
                      value={contractorCode}
                      onChange={(e) => setContractorCode(e.target.value)}
                      dir="ltr"
                    />
                  </div>
                </>
              ) : (
                <Alert type="info">
                  <div className="flex items-start gap-2">
                    <CheckCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{t('exitInheritsEntry')}</span>
                  </div>
                </Alert>
              )}

              <div>
                <label className="label">{t('driverName')}</label>
                <input
                  type="text"
                  className="input"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                />
              </div>

              <div>
                <label className="label">{t('odometerReading')}</label>
                <input
                  type="number"
                  className="input"
                  value={odometer}
                  min={0}
                  max={MAX_ODOMETER - 1}
                  step="any"
                  onChange={(e) => setOdometer(e.target.value)}
                  dir="ltr"
                />
              </div>

              {/* Admin-only: custom recorded_at */}
              {isAdmin && (
                <div>
                  <label className="label">{t('dateTimeLabel')}</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={recordedAt}
                    onChange={(e) => setRecordedAt(e.target.value)}
                    dir="ltr"
                  />
                </div>
              )}

              <div>
                <label className="label">{t('notes')}</label>
                <textarea
                  className="input min-h-20 resize-none"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <div>
                <label className="label">{t('photo')}</label>
                <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ borderColor: 'var(--border)' }}>
                  <Upload size={18} className="text-muted" />
                  <span className="text-sm text-muted">
                    {photoFile ? photoFile.name : t('uploadPhoto')}
                  </span>
                  <input
                    type="file"
                    accept={ALLOWED_PHOTO_TYPES.join(',')}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (!file) { setPhotoFile(null); return; }
                      if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
                        setPhotoFile(null);
                        setSaveError(t('invalidPhotoType'));
                        return;
                      }
                      if (file.size > MAX_PHOTO_BYTES) {
                        setPhotoFile(null);
                        setSaveError(t('photoTooLarge'));
                        return;
                      }
                      setSaveError(null);
                      setPhotoFile(file);
                    }}
                  />
                </label>
              </div>
            </div>

            {saveError && <Alert type="error">{saveError}</Alert>}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="btn-outline flex-1">
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !!validationError || loadingMovement}
                className="btn-primary flex-1"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <QRScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={handleQRScan}
      />
    </>
  );
}
