import { useCallback, useEffect, useState } from 'react';
import { Edit2, Eye, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sanitizeSearchTerm } from '@/lib/search';
import { useI18n } from '@/i18n/I18nContext';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { Modal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Select';
import type { Driver } from '@/lib/types';
import { DriverExcelImport } from '@/components/DriverExcelImport';
import { DRIVER_EMPLOYMENT_TYPES, DRIVER_NATIONALITIES } from '@/lib/driverExcel';
import { DataListToolbar } from '@/components/data-list/DataListToolbar';
import { DataListPagination } from '@/components/data-list/DataListPagination';
import { useDataListState } from '@/components/data-list/useDataListState';
import { useRowSelection } from '@/components/data-list/useRowSelection';
import { driversListConfig } from '@/lib/listConfigs';
import { applyListFilters } from '@/lib/applyListFilters';

const EMPTY_FORM = { full_name: '', id_number: '', mobile_number: '', nationality: '', employment_type: '', job_title: '' };

export function AdminDrivers({ onSelectDriver }: { onSelectDriver: (id: string) => void }) {
  const { t } = useI18n();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const list = useDataListState(driversListConfig);
  const selection = useRowSelection();
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('drivers')
      .select('id,full_name,id_number,mobile_number,nationality,employment_type,job_title,created_at,updated_at', { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1);
    const term = sanitizeSearchTerm(list.search);
    if (term) query = query.or(`full_name.ilike.%${term}%,id_number.ilike.%${term}%,mobile_number.ilike.%${term}%`);
    query = applyListFilters(query, list.filters, new Set(driversListConfig.filterFields.map((field) => field.key)));
    const { data, error: fetchError, count } = await query;
    if (fetchError) setError(t('driversLoadError'));
    setDrivers((data as Driver[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [list.direction, list.filters, list.page, list.pageSize, list.search, list.sort, t]);

  useEffect(() => { fetchDrivers(); }, [fetchDrivers]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setError(null); setModalOpen(true); };
  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setForm({ full_name: driver.full_name, id_number: driver.id_number ?? '', mobile_number: driver.mobile_number ?? '', nationality: driver.nationality ?? '', employment_type: driver.employment_type ?? '', job_title: driver.job_title ?? '' });
    setError(null); setModalOpen(true);
  };

  const save = async () => {
    if (!form.full_name.trim() || (form.id_number && !/^\d{5,20}$/.test(form.id_number)) || (form.mobile_number && !/^\+?\d{7,15}$/.test(form.mobile_number))) {
      setError(t('driverValidationError')); return;
    }
    setSaving(true); setError(null);
    const payload = { ...form, full_name: form.full_name.trim(), id_number: form.id_number.trim() || null, mobile_number: form.mobile_number.trim() || null, nationality: form.nationality || null, employment_type: form.employment_type || null, job_title: form.job_title.trim() || null };
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
  const removeSelected = async () => {
    if (!selection.selected.size || !confirm(t('confirmDelete'))) return;
    const { error: deleteError } = await supabase.from('drivers').delete().in('id', [...selection.selected]);
    if (deleteError) setError(t('driverDeleteBlocked')); else { selection.clear(); fetchDrivers(); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('drivers')} description={t('driversDesc')} />
      {error && !modalOpen && <Alert type="error">{error}</Alert>}
      <DataListToolbar compact config={driversListConfig} search={list.searchInput} onSearch={list.setSearchInput} sort={list.sort} direction={list.direction} onSort={list.setSort} pageSize={list.pageSize} onPageSize={list.setPageSize} filters={list.filters} onFilters={list.setFilters} selectedCount={selection.selected.size} bulkActions={<button className="btn-outline h-8 px-3 py-0 text-[13px]" onClick={removeSelected}><Trash2 size={15} />{t('delete')}</button>} actions={<><button className="btn-outline h-8 px-3 py-0 text-[13px]" onClick={() => setImportOpen(true)}><FileSpreadsheet size={15} />استيراد Excel</button><button className="btn-primary h-8 px-3 py-0 text-[13px]" onClick={openCreate}><Plus size={15} />{t('addDriver')}</button></>} />

      {loading ? <InlineSpinner label={t('loading')} /> : drivers.length === 0 ? <div className="card py-12 text-center text-muted">{t('noDrivers')}</div> : (
        <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="compact-table w-full text-sm"><thead><tr className="border-b" style={{ borderColor: 'var(--border)' }}>
          <th className="px-3 py-3"><input type="checkbox" checked={drivers.length > 0 && drivers.every((driver) => selection.selected.has(driver.id))} onChange={() => selection.togglePage(drivers.map((driver) => driver.id))} /></th><th className="table-header px-4 py-3 text-start">{t('fullName')}</th><th className="table-header px-4 py-3 text-start">{t('idNumber')}</th><th className="table-header px-4 py-3 text-start">{t('mobileNumber')}</th><th className="table-header px-4 py-3 text-start">{t('nationality')}</th><th className="table-header px-4 py-3 text-start">{t('employmentType')}</th><th className="table-header px-4 py-3 text-start">{t('actions')}</th>
        </tr></thead><tbody>{drivers.map((driver) => <tr key={driver.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
          <td className="px-3 py-3"><input type="checkbox" checked={selection.selected.has(driver.id)} onChange={() => selection.toggle(driver.id)} /></td><td className="px-4 py-3 font-semibold">{driver.full_name}</td><td className="px-4 py-3" dir="ltr">{driver.id_number ?? '—'}</td><td className="px-4 py-3" dir="ltr">{driver.mobile_number ?? '—'}</td><td className="px-4 py-3">{driver.nationality ?? '—'}</td><td className="px-4 py-3">{driver.employment_type ?? '—'}</td><td className="px-4 py-3"><div className="flex gap-1"><button className="btn-ghost p-1.5" onClick={() => onSelectDriver(driver.id)}><Eye size={16} /></button><button className="btn-ghost p-1.5" onClick={() => openEdit(driver)}><Edit2 size={16} /></button><button className="btn-ghost p-1.5" onClick={() => remove(driver)}><Trash2 size={16} /></button></div></td>
        </tr>)}</tbody></table></div></div>
      )}
      <DataListPagination page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editDriver') : t('addDriver')} size="md">
        <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}
          <div><label className="label">{t('fullName')} *</label><input className="input" placeholder={t('fullNamePlaceholder')} value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="label">{t('idNumber')}</label><input className="input" dir="ltr" placeholder={t('idNumberPlaceholder')} value={form.id_number} onChange={(event) => setForm({ ...form, id_number: event.target.value.replace(/\D/g, '') })} /></div><div><label className="label">{t('mobileNumber')}</label><input className="input" dir="ltr" placeholder={t('mobileNumberPlaceholder')} value={form.mobile_number} onChange={(event) => setForm({ ...form, mobile_number: event.target.value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '') })} /></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="label">{t('nationality')}</label><Select value={form.nationality} onChange={(value) => setForm({ ...form, nationality: value })} options={[{ value: '', label: '—' }, ...DRIVER_NATIONALITIES.map((value) => ({ value, label: value }))]} /></div><div><label className="label">{t('employmentType')}</label><Select value={form.employment_type} onChange={(value) => setForm({ ...form, employment_type: value })} options={[{ value: '', label: '—' }, ...DRIVER_EMPLOYMENT_TYPES.map((value) => ({ value, label: value }))]} /></div></div>
          <div><label className="label">{t('jobTitle')}</label><input className="input" placeholder={t('jobTitlePlaceholder')} value={form.job_title} onChange={(event) => setForm({ ...form, job_title: event.target.value })} /></div>
          <div className="flex gap-3 pt-2"><button className="btn-outline flex-1" onClick={() => setModalOpen(false)}>{t('cancel')}</button><button className="btn-primary flex-1" disabled={saving} onClick={save}>{saving ? t('saving') : t('save')}</button></div>
        </div>
      </Modal>
      <DriverExcelImport open={importOpen} onClose={() => setImportOpen(false)} onImported={fetchDrivers} />
    </div>
  );
}
