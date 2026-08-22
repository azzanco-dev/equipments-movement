import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { QRScanner } from '@/components/QRScanner';
import { Spinner } from '@/components/Spinner';
import { QrCode, Search, AlertTriangle, CheckCircle, Clock, MapPin, Building2, FileText, ChevronLeft, ChevronRight, X, Camera } from 'lucide-react';
import type { Equipment, MovementType, LastMovement, Company, Project } from '@/lib/types';
import { Select } from '@/components/Select';
import { sanitizeSearchTerm } from '@/lib/search';

const FRONTEND_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_PHOTOS = 3;

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
  const [notes, setNotes] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [contractorCode, setContractorCode] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [registrationMethod, setRegistrationMethod] = useState<'manual' | 'qr'>('manual');

  const isEntry = movementType === 'entry';

  const reset = useCallback(() => {
    setStep('select');
    setSearch('');
    setSelected(null);
    setLastMovement(null);
    setLoadingMovement(false);
    setValidationError(null);
    setDriverName('');
    setNotes('');
    setPhotoFiles([]);
    setPhotoPreviews([]);
    setCarouselIndex(0);
    setSaveError(null);
    setSelectedCompanyId('');
    setSelectedProjectId('');
    setContractorCode('');
    setRecordedAt('');
    setRegistrationMethod('manual');
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

    setRegistrationMethod('qr');
    handleSelectEquipment(data as Equipment);
  };

  const handleAddPhoto = (file: File | null) => {
    if (!file) return;
    if (photoFiles.length >= MAX_PHOTOS) return;
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setSaveError(t('invalidPhotoType'));
      return;
    }
    if (file.size > FRONTEND_MAX_PHOTO_BYTES) {
      setSaveError(t('photoTooLargeMulti'));
      return;
    }
    setSaveError(null);
    const preview = URL.createObjectURL(file);
    setPhotoFiles((prev) => [...prev, file]);
    setPhotoPreviews((prev) => [...prev, preview]);
    setCarouselIndex(photoFiles.length);
  };

  const handleRemovePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index]);
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
    setCarouselIndex((prev) => Math.max(0, Math.min(prev, photoFiles.length - 2)));
  };

  useEffect(() => {
    return () => {
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!selected || !user) return;
    if (validationError) return;

    setSaving(true);
    setSaveError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Missing session');

      const form = new FormData();
      form.set('equipment_id', selected.id);
      form.set('movement_type', movementType);
      form.set('registration_method', registrationMethod);
      if (driverName) form.set('driver_name', driverName);
      if (notes) form.set('notes', notes);
      if (isEntry) {
        if (selectedCompanyId) form.set('company_id', selectedCompanyId);
        if (selectedProjectId) form.set('project_id', selectedProjectId);
        if (contractorCode.trim()) form.set('contractor_equipment_code', contractorCode.trim());
      }
      if (isAdmin && recordedAt.trim()) form.set('recorded_at', new Date(recordedAt).toISOString());
      photoFiles.forEach((file) => form.append('photos', file));

      const response = await fetch('/api/movements', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Movement save failed');

      onSaved();
      onClose();
      reset();
    } catch (err) {
      console.error(err);
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
                          {eq.ownership_status === 'alazani' ? t('owned') : t('rented')}
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
                {photoFiles.length > 0 && (
                  <div className="mb-3">
                    <div className="relative rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', height: '240px' }}>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <img
                          src={photoPreviews[carouselIndex]}
                          alt={`Photo ${carouselIndex + 1}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      {photoFiles.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setCarouselIndex((prev) => (prev - 1 + photoFiles.length) % photoFiles.length)}
                            className="absolute start-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
                          >
                            <ChevronLeft size={20} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCarouselIndex((prev) => (prev + 1) % photoFiles.length)}
                            className="absolute end-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
                          >
                            <ChevronRight size={20} />
                          </button>
                          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white bg-black/50 rounded-full px-2 py-0.5">
                            {carouselIndex + 1} / {photoFiles.length}
                          </span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(carouselIndex)}
                        className="absolute top-1 end-1 rounded-full p-1 bg-black/40 hover:bg-red-600 text-white transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted mb-2">
                  {t('photosCount').replace('{count}', String(photoFiles.length)).replace('{max}', String(MAX_PHOTOS))}
                </p>
                {photoFiles.length < MAX_PHOTOS ? (
                  <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <Camera size={18} className="text-muted" />
                    <span className="text-sm text-muted">{t('addPhoto')}</span>
                    <input
                      type="file"
                      accept={ALLOWED_PHOTO_TYPES.join(',')}
                      className="hidden"
                      onChange={(e) => {
                        handleAddPhoto(e.target.files?.[0] ?? null);
                        e.target.value = '';
                      }}
                    />
                  </label>
                ) : (
                  <p className="text-xs text-muted text-center py-2">{t('maxPhotosReached')}</p>
                )}
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
