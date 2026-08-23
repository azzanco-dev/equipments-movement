import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { ChevronLeft, ChevronRight, Download, Edit2, List, Plus, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { DataListPagination } from '@/components/data-list/DataListPagination';

type EquipmentTypeRow = { id: string; name: string };
const PAGE_SIZE = 20;

export function AdminSettings() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const showEquipmentTypes = pathname === '/settings/equipment-types';
  const [rows, setRows] = useState<EquipmentTypeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [typesCount, setTypesCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EquipmentTypeRow | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('equipment_types').select('id,name', { count: 'exact' }).order('name').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (search.trim()) query = query.ilike('name', `%${search.trim()}%`);
    const { data, count } = await query;
    setRows((data as EquipmentTypeRow[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    supabase.from('equipment_types').select('id', { count: 'exact', head: true }).then(({ count }) => setTypesCount(count ?? 0));
  }, []);

  useEffect(() => { if (showEquipmentTypes) fetchRows(); }, [fetchRows, showEquipmentTypes]);

  const openCreate = () => { setEditing(null); setName(''); setError(null); setModalOpen(true); };
  const openEdit = (row: EquipmentTypeRow) => { setEditing(row); setName(row.name); setError(null); setModalOpen(true); };

  async function save() {
    const clean = name.trim();
    if (!clean) { setError(t('equipmentTypeRequired')); return; }
    const result = editing
      ? await supabase.from('equipment_types').update({ name: clean }).eq('id', editing.id)
      : await supabase.from('equipment_types').insert({ name: clean });
    if (result.error) { setError(t('duplicateEquipmentType')); return; }
    setModalOpen(false); await fetchRows();
  }

  async function remove(row: EquipmentTypeRow) {
    if (!confirm(t('confirmDeleteEquipmentType'))) return;
    const { error: deleteError } = await supabase.from('equipment_types').delete().eq('id', row.id);
    if (deleteError) { setError(t('equipmentTypeInUse')); return; }
    await fetchRows();
  }

  function downloadTemplate() {
    const sheet = XLSX.utils.json_to_sheet([{ [t('equipmentTypeName')]: 'حفار' }]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Equipment Types');
    XLSX.writeFile(book, 'equipment-types-template.xlsx');
  }

  async function importExcel(file?: File) {
    if (!file) return;
    setImporting(true); setError(null);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const names = [...new Set(data.map((row) => String(Object.values(row)[0] ?? '').trim()).filter(Boolean))];
      if (!names.length) throw new Error('empty');
      const { error: insertError } = await supabase.from('equipment_types').upsert(names.map((item) => ({ name: item })), { onConflict: 'name', ignoreDuplicates: true });
      if (insertError) throw insertError;
      setPage(1); await fetchRows();
    } catch {
      setError(t('invalidEquipmentTypesFile'));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (!showEquipmentTypes) return <div className="space-y-4">
    <PageHeader title={t('settings')} description={t('settingsDesc')} />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button type="button" onClick={() => router.push('/settings/equipment-types')} className="card group flex min-h-36 flex-col items-start text-start transition-colors hover:bg-gray-100 dark:hover:bg-gray-800">
        <div className="mb-4 flex w-full items-start justify-between gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border" style={{ borderColor: 'var(--border)' }}><List size={18} /></span>
          <ChevronRight size={18} className="text-muted transition-transform group-hover:translate-x-[-2px] rtl-flip" />
        </div>
        <h2 className="font-semibold">{t('equipmentTypes')}</h2>
        <p className="mt-1 text-sm text-muted">{t('equipmentTypesDesc')}</p>
        <p className="mt-auto pt-4 text-xs text-muted">{typesCount === null ? t('loading') : t('itemsCount').replace('{count}', String(typesCount))}</p>
      </button>
    </div>
  </div>;

  return <div className="space-y-4">
    <button className="btn-ghost" onClick={() => router.push('/settings')}><ChevronLeft size={16} className="rtl-flip" />{t('backToSettings')}</button>
    <PageHeader title={t('equipmentTypes')} description={t('equipmentTypesDesc')} />
    {error && <Alert type="error">{error}</Alert>}
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{t('equipmentTypes')}</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={downloadTemplate}><Download size={16} />{t('downloadTemplate')}</button>
          <label className="btn-outline cursor-pointer"><Upload size={16} />{importing ? t('loading') : t('importExcel')}<input ref={fileRef} className="hidden" type="file" accept=".xlsx,.xls" disabled={importing} onChange={(event) => importExcel(event.target.files?.[0])} /></label>
          <button className="btn-primary" onClick={openCreate}><Plus size={16} />{t('addEquipmentType')}</button>
        </div>
      </div>
      <input className="input max-w-md" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t('searchEquipmentTypes')} />
      {loading ? <InlineSpinner label={t('loading')} /> : <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}><table className="compact-table w-full text-sm"><thead><tr className="border-b" style={{ borderColor: 'var(--border)' }}><th className="table-header px-3 py-2 text-start">{t('equipmentTypeName')}</th><th className="table-header px-3 py-2 text-start">{t('actions')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2"><div className="flex gap-1"><button className="btn-ghost p-1.5" onClick={() => openEdit(row)}><Edit2 size={15} /></button><button className="btn-ghost p-1.5 text-red-600" onClick={() => remove(row)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>}
      <DataListPagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </div>
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editEquipmentType') : t('addEquipmentType')} size="sm"><div className="space-y-4"><div><label className="label">{t('equipmentTypeName')} *</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('equipmentTypePlaceholder')} /></div><div className="flex gap-2"><button className="btn-outline flex-1" onClick={() => setModalOpen(false)}>{t('cancel')}</button><button className="btn-primary flex-1" onClick={save}>{t('save')}</button></div></div></Modal>
  </div>;
}
