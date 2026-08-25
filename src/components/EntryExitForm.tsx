import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { Skeleton } from '@/components/Spinner';
import { Search, AlertTriangle, CheckCircle, Clock, MapPin, ChevronLeft, ChevronRight, X, Camera } from 'lucide-react';
import type { Driver, Equipment, MovementType, LastMovement } from '@/lib/types';
import { DatePicker } from '@/components/DatePicker';
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect';
import { sanitizeSearchTerm } from '@/lib/search';
import { Select, type SelectOption } from '@/components/Select';
import { PlateNumberInput } from '@/components/PlateNumberInput';
import { formatDate } from '@/lib/dateFormat';
import { localizedName } from '@/lib/localizedName';

const FRONTEND_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTOS = 3;

interface EntryExitFormProps {
  open: boolean;
  onClose: () => void;
  movementType: MovementType;
  onSaved: () => void;
  pageMode?: boolean;
  onViewMovement?: (id: string) => void;
}

function toLocalDateTimeInput(date: Date): string {
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

export function EntryExitForm({ open, onClose, movementType, onSaved, pageMode = false, onViewMovement }: EntryExitFormProps) {
  const { t, lang } = useI18n();
  const { user, profile } = useAuth();

  const [step, setStep] = useState<'select' | 'details'>('select');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [lastMovement, setLastMovement] = useState<LastMovement | null>(null);
  const [loadingMovement, setLoadingMovement] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [driverId, setDriverId] = useState('');
  const [selectedDriver, setSelectedDriver] = useState<SelectOption | null>(null);
  const [notes, setNotes] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [movementSaved, setMovementSaved] = useState(false);
  const [savedMovementId, setSavedMovementId] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<SelectOption | null>(null);
  const [selectedProject, setSelectedProject] = useState<SelectOption | null>(null);
  const [contractorCode, setContractorCode] = useState('');
  const [recordedAt, setRecordedAt] = useState('');
  const [quickDriver, setQuickDriver] = useState({ open: false, fullName: '', mobile: '' });
  const [quickEquipment, setQuickEquipment] = useState({ open: false, plate: '', code: '', type: '', lessorId: '', numberingStatus: 'numbered' as 'numbered' | 'unnumbered' });
  const [selectedQuickLessor, setSelectedQuickLessor] = useState<SelectOption | null>(null);
  const [quickLessor, setQuickLessor] = useState({ open: false, name: '', error: '' });
  const [quickSaving, setQuickSaving] = useState(false);

  const isEntry = movementType === 'entry';
  const workshopMode = profile?.role === 'workshop' || profile?.role === 'assistant_workshop_manager' || profile?.role === 'workshop_manager';
  const currentLocalDateTime = toLocalDateTimeInput(new Date());
  const movementDate = recordedAt.slice(0, 10);

  const updateMovementDate = (date: string) => {
    if (!date) {
      setRecordedAt('');
      return;
    }
    setRecordedAt(`${date}T${currentLocalDateTime.slice(11, 16)}`);
  };

  const reset = useCallback(() => {
    setStep('select');
    setSearch('');
    setOwnerFilter('');
    setSelected(null);
    setLastMovement(null);
    setLoadingMovement(false);
    setValidationError(null);
    setDriverId('');
    setSelectedDriver(null);
    setNotes('');
    setPhotoFiles([]);
    setPhotoPreviews([]);
    setCarouselIndex(0);
    setSaveError(null);
    setSaveWarning(null);
    setMovementSaved(false);
    setSavedMovementId('');
    setSelectedCompanyId('');
    setSelectedProjectId('');
    setSelectedCompany(null);
    setSelectedProject(null);
    setContractorCode('');
    setRecordedAt('');
    setQuickDriver({ open: false, fullName: '', mobile: '' });
    setQuickEquipment({ open: false, plate: '', code: '', type: '', lessorId: '', numberingStatus: 'numbered' });
    setSelectedQuickLessor(null);
    setQuickLessor({ open: false, name: '', error: '' });
  }, []);

  useEffect(() => {
    if (open) {
      setRecordedAt(toLocalDateTimeInput(new Date()));
    } else {
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open || profile?.role !== 'supervisor' || !profile.project_id) return;
    setSelectedProjectId(profile.project_id);
    supabase.from('projects').select('id,name_ar,name_en').eq('id', profile.project_id).maybeSingle().then(({ data }) => {
      if (data) setSelectedProject({ value: data.id, label: localizedName(lang, data.name_ar, data.name_en) });
    });
  }, [lang, open, profile?.project_id, profile?.role]);

  // Search equipment
  useEffect(() => {
    if (!open || step !== 'select') return;
    let active = true;
    setLoadingEquipment(true);

    const term = sanitizeSearchTerm(search);
    const timer = window.setTimeout(async () => {
      let result;
      if (workshopMode) {
        result = await supabase.rpc('search_workshop_equipment', {
          p_movement_type: movementType,
          p_search: term || null,
          p_ownership_status: ownerFilter || null,
        });
      } else {
        let query = supabase.from('equipment').select('id,code,type,plate_number,ownership_status,is_active,master_data_complete,numbering_status').eq('is_active', true).order('code');
        if (ownerFilter) query = query.eq('ownership_status', ownerFilter);
        if (term) query = query.or(`code.ilike.%${term}%,type.ilike.%${term}%,plate_number.ilike.%${term}%`);
        result = await query.limit(20);
      }
      const { data, error } = result;
      if (!active) return;
      if (error) console.error(error);
      setEquipment((data as unknown as Equipment[]) ?? []);
      setLoadingEquipment(false);
    }, search ? 300 : 0);

    return () => { active = false; window.clearTimeout(timer); };
  }, [open, step, search, ownerFilter, workshopMode, movementType]);

  // Check last movement when equipment is selected
  const checkLastMovement = useCallback(async (eq: Equipment): Promise<LastMovement | null> => {
    setLoadingMovement(true);
    setValidationError(null);

    const { data, error } = await supabase
      .rpc('get_last_movement', { p_equipment_id: eq.id, p_movement_context: workshopMode ? 'workshop' : 'site' });

    setLoadingMovement(false);

    if (error) {
      console.error(error);
      setSaveError(t('saveFailed'));
      return null;
    }

    const last = (data as LastMovement[])[0] ?? null;
    setLastMovement(last);
    if (!isEntry && last?.driver_id) {
      setDriverId(last.driver_id);
      setSelectedDriver({ value: last.driver_id, label: last.driver_name ?? '—' });
    }

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
  }, [isEntry, t, workshopMode]);

  const loadDrivers = useCallback(async (query: string): Promise<SelectOption[]> => {
    let request = supabase.from('drivers')
      .select('id,full_name,id_number,mobile_number')
      .order('full_name')
      .limit(20);
    const term = sanitizeSearchTerm(query);
    if (term) request = request.or(`full_name.ilike.%${term}%,id_number.ilike.%${term}%,mobile_number.ilike.%${term}%`);
    const { data, error } = await request;
    if (error) return [];
    return (data ?? []).map((driver) => ({
      value: driver.id,
      label: `${driver.full_name} — ${driver.id_number} — ${driver.mobile_number}`,
    }));
  }, []);

  const loadCompanies = useCallback(async (query: string): Promise<SelectOption[]> => {
    let request = supabase.from('companies').select('id,name_ar,name_en').order('name_ar').limit(20);
    const term = sanitizeSearchTerm(query);
    if (term) request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`);
    const { data } = await request;
    return (data ?? []).map((company) => ({ value: company.id, label: localizedName(lang, company.name_ar, company.name_en) }));
  }, [lang]);

  const loadProjects = useCallback(async (query: string): Promise<SelectOption[]> => {
    let request = supabase.from('projects').select('id,name_ar,name_en').order('name_ar').limit(20);
    const term = sanitizeSearchTerm(query);
    if (term) request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`);
    const { data } = await request;
    return (data ?? []).map((project) => ({ value: project.id, label: localizedName(lang, project.name_ar, project.name_en) }));
  }, [lang]);

  const loadEquipmentTypes = useCallback(async (query: string): Promise<SelectOption[]> => {
    let request = supabase.from('equipment_types').select('name').order('name').limit(20);
    const term = sanitizeSearchTerm(query);
    if (term) request = request.ilike('name', `%${term}%`);
    const { data } = await request;
    return (data ?? []).map((item) => ({ value: item.name, label: item.name }));
  }, []);

  const loadLessors = useCallback(async (query: string): Promise<SelectOption[]> => {
    let request = supabase.from('lessors').select('id,name').order('name').limit(20);
    const term = sanitizeSearchTerm(query);
    if (term) request = request.ilike('name', `%${term}%`);
    const { data } = await request;
    return (data ?? []).map((lessor) => ({ value: lessor.id, label: lessor.name }));
  }, []);

  const createQuickLessor = async () => {
    const trimmedName = quickLessor.name.trim();
    if (!trimmedName) {
      setQuickLessor((current) => ({ ...current, error: t('lessorNameRequired') }));
      return;
    }
    setQuickSaving(true);
    setQuickLessor((current) => ({ ...current, error: '' }));
    const { data, error } = await supabase.rpc('quick_create_lessor_by_name', { p_name: trimmedName });
    setQuickSaving(false);
    if (error || !data) {
      setQuickLessor((current) => ({ ...current, error: t('saveFailed') }));
      return;
    }
    const lessor = data as { id: string; name: string };
    const option = { value: lessor.id, label: lessor.name };
    setQuickEquipment((current) => ({ ...current, lessorId: lessor.id }));
    setSelectedQuickLessor(option);
    setQuickLessor({ open: false, name: '', error: '' });
  };

  const handleSelectEquipment = (eq: Equipment) => {
    setSelected(eq);
    setSaveError(null);
    setValidationError(null);
    setStep('details');
    // Fire async; don't block UI
    checkLastMovement(eq);
  };

  const createQuickDriver = async () => {
    if (!quickDriver.fullName.trim() || !/^\+?\d{7,15}$/.test(quickDriver.mobile)) { setSaveError(t('invalidQuickDriver')); return; }
    setQuickSaving(true); setSaveError(null);
    const { data, error } = await supabase.rpc('quick_create_driver', { p_full_name: quickDriver.fullName.trim(), p_mobile_number: quickDriver.mobile.trim() });
    setQuickSaving(false);
    if (error || !data) { setSaveError(t('saveFailed')); return; }
    const driver = data as Driver;
    setDriverId(driver.id); setSelectedDriver({ value: driver.id, label: `${driver.full_name} — ${driver.mobile_number}` });
    setQuickDriver({ open: false, fullName: '', mobile: '' });
  };

  const createQuickEquipment = async () => {
    if (!quickEquipment.plate.trim()) { setSaveError(t('plateRequired')); return; }
    if (workshopMode && quickEquipment.numberingStatus === 'numbered' && !quickEquipment.code.trim()) { setSaveError(t('equipmentCodeRequired')); return; }
    if (!workshopMode && !quickEquipment.type) { setSaveError(t('equipmentTypeRequired')); return; }
    if (!workshopMode && !quickEquipment.lessorId) { setSaveError(t('lessorRequired')); return; }
    setQuickSaving(true); setSaveError(null);
    const { data, error } = workshopMode
      ? await supabase.rpc('quick_create_workshop_equipment', { p_numbering_status: quickEquipment.numberingStatus, p_code: quickEquipment.code.trim(), p_plate_number: quickEquipment.plate.trim() })
      : await supabase.rpc('quick_create_foreman_equipment', { p_plate_number: quickEquipment.plate.trim(), p_type: quickEquipment.type, p_lessor_id: quickEquipment.lessorId });
    setQuickSaving(false);
    if (error || !data) { setSaveError(t('saveFailed')); return; }
    setQuickEquipment({ open: false, plate: '', code: '', type: '', lessorId: '', numberingStatus: 'numbered' });
    setSelectedQuickLessor(null);
    handleSelectEquipment(data as Equipment);
  };

  const handleAddPhotos = (files: FileList | null) => {
    if (!files?.length) return;

    const remainingSlots = MAX_PHOTOS - photoFiles.length;
    if (remainingSlots <= 0) return;

    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (selectedFiles.some((file) => !ALLOWED_PHOTO_TYPES.includes(file.type))) {
      setSaveError(t('invalidPhotoType'));
      return;
    }
    if (selectedFiles.some((file) => file.size > FRONTEND_MAX_PHOTO_BYTES)) {
      setSaveError(t('photoTooLargeMulti'));
      return;
    }

    setSaveError(null);
    const previews = selectedFiles.map((file) => URL.createObjectURL(file));
    setPhotoFiles((prev) => [...prev, ...selectedFiles]);
    setPhotoPreviews((prev) => [...prev, ...previews]);
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
    if (workshopMode && photoFiles.length === 0) {
      setSaveError(t('workshopPhotoRequired'));
      return;
    }
    if (!workshopMode && isEntry && !driverId) {
      setSaveError(t('driverRequired'));
      return;
    }
    if (!workshopMode && isEntry && !selectedCompanyId) {
      setSaveError(t('companyRequiredForEntry'));
      return;
    }
    if (!workshopMode && isEntry && !selectedProjectId) {
      setSaveError(t('projectRequiredForEntry'));
      return;
    }
    if (!recordedAt.trim()) {
      setSaveError(`${t('actualMovementTime')}: ${t('required')}`);
      return;
    }
    const saveTime = toLocalDateTimeInput(new Date()).slice(11, 16);
    const actualMovementDate = new Date(`${movementDate}T${saveTime}`);
    if (isNaN(actualMovementDate.getTime()) || actualMovementDate.getTime() > Date.now()) {
      setSaveError(t('movementTimeCannotBeFuture'));
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Missing session');

      const form = new FormData();
      form.set('equipment_id', selected.id);
      form.set('movement_type', movementType);
      form.set('movement_context', workshopMode ? 'workshop' : 'site');
      form.set('registration_method', 'manual');
      if (notes) form.set('notes', notes);
      if (!workshopMode && isEntry) {
        form.set('driver_id', driverId);
        if (selectedCompanyId) form.set('company_id', selectedCompanyId);
        if (selectedProjectId) form.set('project_id', selectedProjectId);
        if (contractorCode.trim()) form.set('contractor_equipment_code', contractorCode.trim());
      }
      form.set('recorded_at', actualMovementDate.toISOString());
      photoFiles.forEach((file) => form.append('photos', file));

      const response = await fetch('/api/movements', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? 'movement_save_failed');
      }
      const result = await response.json() as { id: string; photoFailures?: number };

      onSaved();
      setSavedMovementId(result.id);
      setMovementSaved(true);
      if (pageMode && onViewMovement) {
        onViewMovement(result.id);
        return;
      }
      if (result.photoFailures) {
        setSaveWarning(t('movementSavedPhotosFailed'));
      } else if (!pageMode) {
        onClose();
        reset();
      }
    } catch (err) {
      console.error(err);
      const code = err instanceof Error ? err.message : 'movement_save_failed';
      const messages: Record<string, string> = {
        future_time: t('movementTimeCannotBeFuture'),
        company_required: t('companyRequiredForEntry'),
        project_required: t('projectRequiredForEntry'),
        driver_required: t('driverRequired'),
        no_prior_entry: t('noPriorEntryAtSelectedTime'),
        workshop_exit_owner: t('workshopExitOwner'),
        invalid_sequence: isEntry ? t('entrySequenceConflict') : t('exitSequenceConflict'),
        invalid_photos: t('invalidPhotoType'),
        photo_required: t('workshopPhotoRequired'),
        invalid_movement_payload: t('movementSaveFailed'),
        photo_upload_failed: t('photoUploadFailed'),
        unauthorized: t('authError'),
        movement_save_failed: t('movementSaveFailed'),
      };
      setSaveError(messages[code] ?? t('movementSaveFailed'));
      checkLastMovement(selected);
    } finally {
      setSaving(false);
    }
  };

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
        inline={pageMode}
      >
        {step === 'select' && (
          <div className="space-y-4">
            {/* Owner filter */}
            <div>
              <label className="label">{t('selectOwner')}</label>
              <Select
                value={ownerFilter}
                onChange={setOwnerFilter}
                placeholder={t('allOwners')}
                options={[
                  { value: '', label: t('allOwners') },
                  { value: 'alazani', label: t('ownershipAlazani') },
                  { value: 'takween', label: t('ownershipTakween') },
                  { value: 'third_party_f', label: t('ownershipThirdPartyF') },
                  { value: 'third_party_partnership_b', label: t('ownershipThirdPartyPartnershipB') },
                  { value: 'external_supplier', label: t('ownershipExternalSupplier') },
                ]}
              />
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
            ) : (
              <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                {equipment.length === 0 && (
                  <p className="col-span-full py-4 text-center text-sm text-muted">{t('noEquipmentFound')}</p>
                )}
                {equipment.map((eq) => (
                  <button
                    key={eq.id}
                    onClick={() => handleSelectEquipment(eq)}
                    className="w-full text-start rounded-lg border p-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div>
                      <p className="font-semibold text-sm">{eq.code}</p>
                      <p className="text-xs text-muted">{eq.type}</p>
                      {eq.plate_number && <p className="text-xs text-muted">{t('plateNumber')}: {eq.plate_number}</p>}
                    </div>
                  </button>
                ))}
                {isEntry && (
                  <button
                    type="button"
                    className="w-full rounded-lg border px-3 py-2 text-start text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => setQuickEquipment((value) => ({ ...value, open: true, plate: search }))}
                  >
                    {t('addEquipment')} +
                  </button>
                )}
              </div>
            )}
            {quickEquipment.open && <div className="rounded-lg border p-4 text-start space-y-3" style={{ borderColor: 'var(--border)' }}>
              <p className="font-semibold">{t('quickEquipmentAdd')}</p>
              {workshopMode && <div className="flex gap-4 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={quickEquipment.numberingStatus === 'numbered'} onChange={() => setQuickEquipment({ ...quickEquipment, numberingStatus: 'numbered' })} /> {t('numbered')}</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" checked={quickEquipment.numberingStatus === 'unnumbered'} onChange={() => setQuickEquipment({ ...quickEquipment, numberingStatus: 'unnumbered', code: '' })} /> {t('unnumbered')}</label>
              </div>}
              {workshopMode && quickEquipment.numberingStatus === 'numbered' && <div><label className="label">{t('equipmentCode')} *</label><input className="input" dir="ltr" placeholder={t('equipmentCodePlaceholder')} value={quickEquipment.code} onChange={(event) => setQuickEquipment({ ...quickEquipment, code: event.target.value })} /></div>}
              <div><label className="label">{t('plateNumber')} *</label><PlateNumberInput value={quickEquipment.plate} onChange={(value) => setQuickEquipment({ ...quickEquipment, plate: value })} /></div>
              {!workshopMode && <>
                <div><label className="label">{t('equipmentType')} *</label><AsyncSearchSelect value={quickEquipment.type} selectedOption={quickEquipment.type ? { value: quickEquipment.type, label: quickEquipment.type } : null} onChange={(value) => setQuickEquipment({ ...quickEquipment, type: value })} loadOptions={loadEquipmentTypes} placeholder={t('selectEquipmentType')} /></div>
                <div>
                  <label className="label">{t('externalSupplier')} *</label>
                  <AsyncSearchSelect
                    value={quickEquipment.lessorId}
                    selectedOption={selectedQuickLessor}
                    onChange={(value, option) => { setQuickEquipment({ ...quickEquipment, lessorId: value }); setSelectedQuickLessor(option); }}
                    loadOptions={loadLessors}
                    placeholder={t('selectLessor')}
                    createLabel={`${t('addNewSupplier')} +`}
                    onCreate={(query) => setQuickLessor({ open: true, name: query, error: '' })}
                    alwaysShowCreate
                    disabled={quickSaving}
                  />
                </div>
              </>}
              <div className="flex gap-2"><button className="btn-outline flex-1" onClick={() => { setQuickEquipment({ open: false, plate: '', code: '', type: '', lessorId: '', numberingStatus: 'numbered' }); setSelectedQuickLessor(null); }}>{t('cancel')}</button><button className="btn-primary flex-1" disabled={quickSaving} onClick={createQuickEquipment}>{quickSaving ? t('saving') : t('save')}</button></div>
            </div>}
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
              {selected.project && <p className="text-sm text-muted">{t('project')}: {localizedName(lang, selected.project.name_ar, selected.project.name_en)}</p>}
            </div>

            {/* Latest movement brief card */}
            {loadingMovement ? (
              <div className="space-y-2 py-2"><Skeleton className="h-14" /><Skeleton className="h-8 w-2/3" /></div>
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
                      <span>{t('currentStatus')}: {t(lastMovement?.movement_context === 'workshop' ? 'insideWorkshop' : 'insideSite')}</span>
                    </>
                  ) : currentStatus === 'outside' ? (
                    <>
                      <MapPin size={16} className="text-amber-600 dark:text-amber-400" />
                      <span>{t('currentStatus')}: {t(lastMovement?.movement_context === 'workshop' ? 'outsideWorkshop' : 'outsideSite')}</span>
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
                      {t('lastMovement')}: {lastMovement.movement_type === 'entry' ? t('entry') : t('exit')} — {formatDate(lastMovement.recorded_at)}
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

            {/* Form fields */}
            {!workshopMode && !isEntry && lastMovement && !validationError && (
              <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <p className="mb-2 font-medium">{t('latestEntryBrief')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <span><span className="text-muted">{t('entryDateTime')}:</span> {formatDate(lastMovement.recorded_at)}</span>
                  <span><span className="text-muted">{t('driverName')}:</span> {lastMovement.driver_name ?? '—'}</span>
                  <span><span className="text-muted">{t('contractorEquipmentCode')}:</span> {lastMovement.contractor_equipment_code ?? '—'}</span>
                  <span className="text-muted">{t('exitInheritsEntry')}</span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {!workshopMode && isEntry ? (
                <>
                  <div>
                    <label className="label">{t('company')} *</label>
                    <AsyncSearchSelect
                      value={selectedCompanyId}
                      selectedOption={selectedCompany}
                      onChange={(value, option) => { setSelectedCompanyId(value); setSelectedCompany(option); }}
                      placeholder={t('selectCompany')}
                      loadOptions={loadCompanies}
                    />
                  </div>

                  <div>
                    <label className="label">{t('project')} *</label>
                    <AsyncSearchSelect
                      value={selectedProjectId}
                      selectedOption={selectedProject}
                      onChange={(value, option) => { setSelectedProjectId(value); setSelectedProject(option); }}
                      placeholder={t('selectProject')}
                      loadOptions={loadProjects}
                      disabled={profile?.role === 'supervisor'}
                    />
                  </div>

                  <div>
                    <label className="label">{t('contractorEquipmentCode')}</label>
                    <input
                      type="text"
                      className="input"
                      value={contractorCode}
                      placeholder={t('contractorCodePlaceholder')}
                      onChange={(e) => setContractorCode(e.target.value)}
                      dir="ltr"
                    />
                  </div>
                </>
              ) : null}

              {!workshopMode && <div>
                <label className="label">{t('driverName')} {isEntry && '*'}</label>
                {isEntry ? (
                  <AsyncSearchSelect
                    value={driverId}
                    selectedOption={selectedDriver}
                    onChange={(value, option) => { setDriverId(value); setSelectedDriver(option); }}
                    loadOptions={loadDrivers}
                    placeholder={t('selectDriver')}
                    createLabel={`${t('addNewDriver')} +`}
                    onCreate={(query) => setQuickDriver({ open: true, fullName: query, mobile: '' })}
                    alwaysShowCreate
                  />
                ) : (
                  <div className="input bg-gray-50 dark:bg-gray-900/30">{selectedDriver?.label ?? t('driverInheritedFromEntry')}</div>
                )}
              </div>}
              {!workshopMode && isEntry && quickDriver.open && <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border)' }}><p className="font-semibold">{t('quickDriverAdd')}</p><div className="grid gap-3 sm:grid-cols-2"><div><label className="label">{t('fullName')} *</label><input className="input" placeholder={t('fullNamePlaceholder')} value={quickDriver.fullName} onChange={(event) => setQuickDriver({ ...quickDriver, fullName: event.target.value })} /></div><div><label className="label">{t('mobileNumber')} *</label><input className="input" dir="ltr" placeholder={t('mobileNumberPlaceholder')} value={quickDriver.mobile} onChange={(event) => setQuickDriver({ ...quickDriver, mobile: event.target.value.replace(/[^\d+]/g, '') })} /></div></div><div className="flex gap-2"><button className="btn-outline flex-1" onClick={() => setQuickDriver({ open: false, fullName: '', mobile: '' })}>{t('cancel')}</button><button className="btn-primary flex-1" disabled={quickSaving} onClick={createQuickDriver}>{quickSaving ? t('saving') : t('save')}</button></div></div>}

              {!workshopMode && <div>
                <label className="label">{t('actualMovementTime')}</label>
                <div className="max-w">
                  <DatePicker
                    value={movementDate}
                    onChange={updateMovementDate}
                    max={currentLocalDateTime.slice(0, 10)}
                    placeholder={t('date')}
                  />
                </div>
              </div>}

              {!workshopMode && <div>
                <label className="label">{t('notes')}</label>
                <textarea
                  className="input min-h-20 resize-none p-2"
                  value={notes}
                  placeholder={t('notesPlaceholder')}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>}

              <div>
                <label className="label">{t('photo')}{workshopMode ? ' *' : ''}</label>
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
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleAddPhotos(e.target.files);
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
            {saveWarning && <Alert type="warning">{saveWarning}</Alert>}
            {movementSaved && <Alert type="success">{t('movementSavedSuccess')}</Alert>}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="btn-outline flex-1">
                {t('cancel')}
              </button>
              {!movementSaved ? <button onClick={handleSave} disabled={saving || !!validationError || loadingMovement} className="btn-primary flex-1">{saving ? t('saving') : t('save')}</button> : <>
                {onViewMovement && <button className="btn-primary flex-1" onClick={() => onViewMovement(savedMovementId)}>{t('viewMovement')}</button>}
                <button className="btn-outline flex-1" onClick={reset}>{t('registerAnotherMovement')}</button>
              </>}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={quickLessor.open}
        onClose={() => setQuickLessor({ open: false, name: '', error: '' })}
        title={t('addNewSupplier')}
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="label">{t('lessorName')} *</label>
            <input
              className="input"
              value={quickLessor.name}
              placeholder={t('lessorNamePlaceholder')}
              onChange={(event) => setQuickLessor({ ...quickLessor, name: event.target.value, error: '' })}
              autoFocus
            />
          </div>
          {quickLessor.error && <Alert type="error">{quickLessor.error}</Alert>}
          <div className="flex gap-2">
            <button className="btn-outline flex-1" onClick={() => setQuickLessor({ open: false, name: '', error: '' })}>{t('cancel')}</button>
            <button className="btn-primary flex-1" disabled={quickSaving || !quickLessor.name.trim()} onClick={createQuickLessor}>{quickSaving ? t('saving') : t('save')}</button>
          </div>
        </div>
      </Modal>

    </>
  );
}
