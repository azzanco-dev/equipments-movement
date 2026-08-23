import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import { InlineSpinner } from '@/components/Spinner';
import { Plus, Trash2 } from 'lucide-react';
import type { Profile, UserRole } from '@/lib/types';
import { Select } from '@/components/Select';
import { PageHeader } from '@/components/PageHeader';
import { DataListToolbar } from '@/components/data-list/DataListToolbar';
import { DataListPagination } from '@/components/data-list/DataListPagination';
import { useDataListState } from '@/components/data-list/useDataListState';
import { usersListConfig } from '@/lib/listConfigs';
import { applyListFilters } from '@/lib/applyListFilters';
import { sanitizeSearchTerm } from '@/lib/search';
import { PasswordInput } from '@/components/PasswordInput';

export function AdminUsers() {
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const list = useDataListState(usersListConfig);
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('supervisor');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('profiles').select('id,full_name,role,created_at', { count: 'exact' }).order(list.sort, { ascending: list.direction === 'asc' }).range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1);
    const term = sanitizeSearchTerm(list.search);
    if (term) query = query.ilike('full_name', `%${term}%`);
    query = applyListFilters(query, list.filters, new Set(usersListConfig.filterFields.map((field) => field.key)));
    const { data, error, count } = await query;
    if (error) console.error(error);
    setUsers((data as Profile[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [list.direction, list.filters, list.page, list.pageSize, list.search, list.sort]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function openAdd() { setEmail(''); setPassword(''); setFullName(''); setRole('supervisor'); setFormError(null); setModalOpen(true); }

  async function handleSave() {
    setSaving(true); setFormError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            email: email.trim(),
            password,
            full_name: fullName.trim(),
            role,
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create user');

      setModalOpen(false); fetchUsers();
    } catch (err) { console.error(err); setFormError(t('userCreateError')); }
    finally { setSaving(false); }
  }

  async function handleRoleChange(u: Profile, newRole: UserRole) {
    if (u.id === currentUser?.id) return;
    const { error } = await supabase.rpc('admin_set_user_role', {
      p_user_id: u.id,
      p_role: newRole,
    });
    if (error) console.error(error);
    fetchUsers();
  }

  async function handleDelete(u: Profile) {
    if (u.id === currentUser?.id) return;
    if (!confirm(t('confirmDelete'))) return;
    const { error } = await supabase.from('profiles').delete().eq('id', u.id);
    if (error) console.error(error);
    fetchUsers();
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('users')} description={t('usersDesc')} />
      <DataListToolbar config={usersListConfig} search={list.searchInput} onSearch={list.setSearchInput} sort={list.sort} direction={list.direction} onSort={list.setSort} pageSize={list.pageSize} onPageSize={list.setPageSize} filters={list.filters} onFilters={list.setFilters} actions={<button onClick={openAdd} className="btn-primary"><Plus size={18} /> {t('addUser')}</button>} />
      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : users.length === 0 ? (
        <div className="card text-center py-12"><p className="text-muted">{t('noUsers')}</p></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="compact-table w-full text-sm">
              <thead><tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="table-header text-start px-4 py-3">{t('fullName')}</th>
                <th className="table-header text-start px-4 py-3">{t('role')}</th>
                <th className="table-header text-start px-4 py-3">{t('createdAt')}</th>
                <th className="table-header text-start px-4 py-3">{t('actions')}</th>
              </tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 font-semibold">{u.full_name}{u.id === currentUser?.id ? ' (You)' : ''}</td>
                    <td className="px-4 py-3">
                      {u.id === currentUser?.id ? (
                        <span className="text-muted">{u.role === 'admin' ? t('admin') : u.role === 'workshop' ? t('workshopOfficer') : t('supervisor')}</span>
                      ) : (
                        <Select
                          compact
                          className="w-auto min-w-[100px]"
                          value={u.role}
                          onChange={(v) => handleRoleChange(u, v as UserRole)}
                          options={[
                            { value: 'supervisor', label: t('supervisor') },
                            { value: 'workshop', label: t('workshopOfficer') },
                            { value: 'admin', label: t('admin') },
                          ]}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {u.id !== currentUser?.id && <button onClick={() => handleDelete(u)} className="btn-ghost p-1.5"><Trash2 size={16} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <DataListPagination page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage} />
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('addUser')} size="sm">
        {formError && <div className="mb-4"><Alert type="error">{formError}</Alert></div>}
        <div className="space-y-4">
          <div><label className="label">{t('fullName')} *</label><input className="input" placeholder={t('fullNamePlaceholder')} value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div><label className="label">{t('email')} *</label><input className="input" type="email" dir="ltr" placeholder={t('emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label">{t('password')} *</label><PasswordInput dir="ltr" placeholder={t('passwordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div>
            <label className="label">{t('role')}</label>
            <Select
              value={role}
              onChange={(v) => setRole(v as UserRole)}
              options={[
                { value: 'supervisor', label: t('supervisor') },
                { value: 'workshop', label: t('workshopOfficer') },
                { value: 'admin', label: t('admin') },
              ]}
            />
          </div>
        </div>
        <div className="flex gap-3 pt-4">
          <button onClick={() => setModalOpen(false)} className="btn-outline flex-1">{t('cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? t('saving') : t('save')}</button>
        </div>
      </Modal>
    </div>
  );
}
