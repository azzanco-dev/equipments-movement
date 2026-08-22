import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import type { Lessor } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';

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

  const fetchLessors = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('lessors').select('*').order('name');
    if (error) console.error(error);
    setLessors((data as Lessor[]) ?? []);
    setLoading(false);
  }, []);

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
      <PageHeader title={t('lessors')} description={t('lessorsDesc')} />
      <div className="flex justify-end">
        <button onClick={openAdd} className="btn-primary"><Plus size={18} /> {t('addLessor')}</button>
      </div>
      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : lessors.length === 0 ? (
        <div className="card text-center py-12"><p className="text-muted">{t('noLessors')}</p></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="table-header text-start px-4 py-3">{t('lessorName')}</th>
                <th className="table-header text-start px-4 py-3">{t('contactPerson')}</th>
                <th className="table-header text-start px-4 py-3">{t('contactNumber')}</th>
                <th className="table-header text-start px-4 py-3">{t('actions')}</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('editLessor') : t('addLessor')} size="sm">
        {formError && <div className="mb-4"><Alert type="error">{formError}</Alert></div>}
        <div className="space-y-4">
          <div><label className="label">{t('lessorName')} *</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">{t('contactPerson')}</label><input className="input" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></div>
          <div><label className="label">{t('contactNumber')}</label><input className="input" value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} /></div>
        </div>
        <div className="flex gap-3 pt-4">
          <button onClick={() => setModalOpen(false)} className="btn-outline flex-1">{t('cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? t('saving') : t('save')}</button>
        </div>
      </Modal>
    </div>
  );
}
