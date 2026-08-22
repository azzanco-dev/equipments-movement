import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Edit2, Eye, Plus, Search, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sanitizeSearchTerm } from '@/lib/search';
import { useI18n } from '@/i18n/I18nContext';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Select';
import type { Driver } from '@/lib/types';

const PAGE_SIZE = 20;
export const DRIVER_NATIONALITIES = ['اليمن', 'مصر', 'باكستان', 'الهند', 'نيبال', 'بنجلاديش', 'السودان'] as const;
export const DRIVER_EMPLOYMENT_TYPES = ['العزاني', 'تكوين', 'البناء', 'البدراني', 'امدادات العربة', 'نقدي'] as const;

const EMPTY_FORM = { full_name: '', id_number: '', mobile_number: '', nationality: '', employment_type: '', job_title: '' };

export function AdminDrivers({ onSelectDriver }: { onSelectDriver: (id: string) => void }) {
  const { t } = useI18n();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [nationality, setNationality] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [sort, setSort] = useState<'full_name' | 'created_at'>('full_name');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('drivers')
      .select('id,full_name,id_number,mobile_number,nationality,employment_type,job_title,created_at,updated_at', { count: 'exact' })
      .order(sort, { ascending: sort === 'full_name' })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    const term = sanitizeSearchTerm(debouncedSearch);
    if (term) query = query.or(`full_name.ilike.%${term}%,id_number.ilike.%${term}%,mobile_number.ilike.%${term}%`);
    if (nationality) query = query.eq('nationality', nationality);
    if (employmentType) query = query.eq('employment_type', employmentType);
    const { data, error: fetchError, count } = await query;
    if (fetchError) setError(t('driversLoadError'));
    setDrivers((data as Driver[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [debouncedSearch, employmentType, nationality, page, sort, t]);

  useEffect(() => { fetchDrivers(); }, [fetchDrivers]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setError(null); setModalOpen(true); };
  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setForm({ full_name: driver.full_name, id_number: driver.id_number, mobile_number: driver.mobile_number, nationality: driver.nationality, employment_type: driver.employment_type, job_title: driver.job_title ?? '' });
    setError(null); setModalOpen(true);
  };

  const save = async () => {
    if (!form.full_name.trim() || !/^\d{5,20}$/.test(form.id_number) || !/^\+?\d{7,15}$/.test(form.mobile_number) || !form.nationality || !form.employment_type) {
      setError(t('driverValidationError')); return;
    }
    setSaving(true); setError(null);
    const payload = { ...form, full_name: form.full_name.trim(), id_number: form.id_number.trim(), mobile_number: form.mobile_number.trim(), job_title: form.job_title.trim() || null };
    const result = editing
      ? await supabase.from('drivers').update(payload).eq('id', editing.id)
      : await supabase.from('drivers').insert(payload);
    setSaving(false);
    if (result.error) { setError(result.error.code === '23505' ? t('driverIdExists') : t('saveFailed')); return; }
    setModalOpen(false); await fetchDrivers();
  };

  const remove = async (driver: Driver) => {
    if (!confirm(t('confirmDelete'))) return;
    const { error: deleteError } = await supabase.from('drivers').delete().eq('id', driver.id);
    if (deleteError) setError(t('driverDeleteBlocked')); else fetchDrivers();
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('drivers')} description={t('driversDesc')} />
      {error && !modalOpen && <Alert type="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1"><Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input ps-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchDrivers')} /></div>
        <Select className="min-w-[140px]" value={nationality} onChange={(value) => { setNationality(value); setPage(0); }} options={[{ value: '', label: t('allNationalities') }, ...DRIVER_NATIONALITIES.map((value) => ({ value, label: value }))]} />
        <Select className="min-w-[150px]" value={employmentType} onChange={(value) => { setEmploymentType(value); setPage(0); }} options={[{ value: '', label: t('allEmploymentTypes') }, ...DRIVER_EMPLOYMENT_TYPES.map((value) => ({ value, label: value }))]} />
        <Select className="min-w-[130px]" value={sort} onChange={(value) => setSort(value as 'full_name' | 'created_at')} options={[{ value: 'full_name', label: t('sortByName') }, { value: 'created_at', label: t('sortByNewest') }]} />
        <button className="btn-primary" onClick={openCreate}><Plus size={17} />{t('addDriver')}</button>
      </div>

      {loading ? <InlineSpinner label={t('loading')} /> : drivers.length === 0 ? <div className="card py-12 text-center text-muted">{t('noDrivers')}</div> : (
        <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b" style={{ borderColor: 'var(--border)' }}>
          <th className="table-header px-4 py-3 text-start">{t('fullName')}</th><th className="table-header px-4 py-3 text-start">{t('idNumber')}</th><th className="table-header px-4 py-3 text-start">{t('mobileNumber')}</th><th className="table-header px-4 py-3 text-start">{t('nationality')}</th><th className="table-header px-4 py-3 text-start">{t('employmentType')}</th><th className="table-header px-4 py-3 text-start">{t('actions')}</th>
        </tr></thead><tbody>{drivers.map((driver) => <tr key={driver.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
          <td className="px-4 py-3 font-semibold">{driver.full_name}</td><td className="px-4 py-3" dir="ltr">{driver.id_number}</td><td className="px-4 py-3" dir="ltr">{driver.mobile_number}</td><td className="px-4 py-3">{driver.nationality}</td><td className="px-4 py-3">{driver.employment_type}</td><td className="px-4 py-3"><div className="flex gap-1"><button className="btn-ghost p-1.5" onClick={() => onSelectDriver(driver.id)}><Eye size={16} /></button><button className="btn-ghost p-1.5" onClick={() => openEdit(driver)}><Edit2 size={16} /></button><button className="btn-ghost p-1.5" onClick={() => remove(driver)}><Trash2 size={16} /></button></div></td>
        </tr>)}</tbody></table></div></div>
      )}
      <div className="flex items-center justify-between text-sm"><span className="text-muted">{total} {t('drivers')}</span><div className="flex gap-2"><button className="btn-outline px-3" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronRight size={16} /></button><span className="px-2 py-2">{page + 1}</span><button className="btn-outline px-3" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}><ChevronLeft size={16} /></button></div></div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editDriver') : t('addDriver')} size="md">
        <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}
          <div><label className="label">{t('fullName')} *</label><input className="input" value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="label">{t('idNumber')} *</label><input className="input" dir="ltr" value={form.id_number} onChange={(event) => setForm({ ...form, id_number: event.target.value.replace(/\D/g, '') })} /></div><div><label className="label">{t('mobileNumber')} *</label><input className="input" dir="ltr" value={form.mobile_number} onChange={(event) => setForm({ ...form, mobile_number: event.target.value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '') })} /></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="label">{t('nationality')} *</label><Select value={form.nationality} onChange={(value) => setForm({ ...form, nationality: value })} options={DRIVER_NATIONALITIES.map((value) => ({ value, label: value }))} /></div><div><label className="label">{t('employmentType')} *</label><Select value={form.employment_type} onChange={(value) => setForm({ ...form, employment_type: value })} options={DRIVER_EMPLOYMENT_TYPES.map((value) => ({ value, label: value }))} /></div></div>
          <div><label className="label">{t('jobTitle')}</label><input className="input" value={form.job_title} onChange={(event) => setForm({ ...form, job_title: event.target.value })} /></div>
          <div className="flex gap-3 pt-2"><button className="btn-outline flex-1" onClick={() => setModalOpen(false)}>{t('cancel')}</button><button className="btn-primary flex-1" disabled={saving} onClick={save}>{saving ? t('saving') : t('save')}</button></div>
        </div>
      </Modal>
    </div>
  );
}
