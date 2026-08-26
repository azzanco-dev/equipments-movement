import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import type { Lessor } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { DataListToolbar } from '@/components/data-list/DataListToolbar';
import { DataListActions } from '@/components/data-list/DataListActions';
import { DataListPagination } from '@/components/data-list/DataListPagination';
import { useDataListState } from '@/components/data-list/useDataListState';
import { lessorsListConfig } from '@/lib/listConfigs';
import { applyListFilters } from '@/lib/applyListFilters';
import { sanitizeSearchTerm } from '@/lib/search';
import { RelativeTime } from '@/components/RelativeTime';

export function AdminLessors() {
  const { t } = useI18n();
  const [lessors, setLessors] = useState<Lessor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Lessor | null>(null);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const list = useDataListState(lessorsListConfig);

  const fetchLessors = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('lessors').select('id,name,contact_person,contact_number,created_at', { count: 'exact' }).order(list.sort, { ascending: list.direction === 'asc' }).range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1);
    const term = sanitizeSearchTerm(list.search); if (term) query = query.or(`name.ilike.%${term}%,contact_person.ilike.%${term}%,contact_number.ilike.%${term}%`);
    query = applyListFilters(query, list.filters, new Set(lessorsListConfig.filterFields.map((field) => field.key)));
    const { data, error, count } = await query;
    if (error) console.error(error);
    setLessors((data as Lessor[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [list.direction, list.filters, list.page, list.pageSize, list.search, list.sort]);

  useEffect(() => { fetchLessors(); }, [fetchLessors]);

  function openAdd() { setEditing(null); setName(''); setContactPerson(''); setContactNumber(''); setFormError(null); setModalOpen(true); }
  function openEdit(l: Lessor) { setEditing(l); setName(l.name); setContactPerson(l.contact_person ?? ''); setContactNumber(l.contact_number ?? ''); setFormError(null); setModalOpen(true); }

  async function handleSave() {
    setSaving(true); setFormError(null);
    try {
      const payload = { name, contact_person: contactPerson || null, contact_number: contactNumber || null };
      if (editing) {
        const { error } = await supabase.from('lessors').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('lessors').insert(payload);
        if (error) throw error;
      }
      setModalOpen(false); fetchLessors();
    } catch (err) { console.error(err); setFormError(t('saveFailed')); }
    finally { setSaving(false); }
  }

  async function handleDelete(l: Lessor) {
    if (!confirm(t('confirmDelete'))) return;
    const { error } = await supabase.from('lessors').delete().eq('id', l.id);
    if (error) console.error(error);
    fetchLessors();
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('lessors')} description={t('lessorsDesc')} actions={<DataListActions primaryAction={<button onClick={openAdd} className="btn-primary"><Plus size={18} /> {t('addLessor')}</button>} />} />
      <DataListToolbar config={lessorsListConfig} search={list.searchInput} onSearch={list.setSearchInput} sort={list.sort} direction={list.direction} onSort={list.setSort} pageSize={list.pageSize} onPageSize={list.setPageSize} filters={list.filters} onFilters={list.setFilters} />
      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : lessors.length === 0 ? (
        <div className="card text-center py-12"><p className="text-muted">{t('noLessors')}</p></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="compact-table w-full text-sm">
              <thead><tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="table-header text-start px-4 py-3">{t('lessorName')}</th>
                <th className="table-header text-start px-4 py-3">{t('contactPerson')}</th>
                <th className="table-header text-start px-4 py-3">{t('contactNumber')}</th>
                <th className="table-header text-start px-4 py-3">{t('actions')}</th>
                <th className="table-header text-start px-4 py-3">{t('createdAt')}</th>
              </tr></thead>
              <tbody>
                {lessors.map((l) => (
                  <tr key={l.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 font-semibold">{l.name}</td>
                    <td className="px-4 py-3 text-muted">{l.contact_person ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{l.contact_number ?? '—'}</td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      <button onClick={() => openEdit(l)} className="btn-ghost p-1.5"><Edit2 size={16} /></button>
                      <button onClick={() => handleDelete(l)} className="btn-ghost p-1.5"><Trash2 size={16} /></button>
                    </div></td>
                    <td className="px-4 py-3"><RelativeTime value={l.created_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <DataListPagination page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage} />
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editLessor') : t('addLessor')} size="sm">
        {formError && <div className="mb-4"><Alert type="error">{formError}</Alert></div>}
        <div className="space-y-4">
          <div><label className="label">{t('lessorName')} *</label><input className="input" placeholder={t('lessorNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">{t('contactPerson')}</label><input className="input" placeholder={t('contactPersonPlaceholder')} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></div>
          <div><label className="label">{t('contactNumber')}</label><input className="input" dir="ltr" placeholder={t('contactNumberPlaceholder')} value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} /></div>
        </div>
        <div className="flex gap-3 pt-4">
          <button onClick={() => setModalOpen(false)} className="btn-outline flex-1">{t('cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? t('saving') : t('save')}</button>
        </div>
      </Modal>
    </div>
  );
}
