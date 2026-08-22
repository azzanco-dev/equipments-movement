import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { useAuth } from '@/auth/AuthContext';
import { EntryExitForm } from '@/components/EntryExitForm';
import { InlineSpinner } from '@/components/Spinner';
import { LogIn, LogOut, Filter } from 'lucide-react';
import { DatePicker } from '@/components/DatePicker';
import type { EntryExitLog, MovementType } from '@/lib/types';
import { Select } from '@/components/Select';
import { PageHeader } from '@/components/PageHeader';

export function SupervisorDashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<MovementType>('entry');
  const [logs, setLogs] = useState<EntryExitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | MovementType>('all');
  const [filterDate, setFilterDate] = useState('');

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from('entry_exit_logs')
      .select('*, equipment(*)')
      .eq('supervisor_id', user.id)
      .order('recorded_at', { ascending: false })
      .limit(100);

    if (filterType !== 'all') {
      query = query.eq('movement_type', filterType);
    }
    if (filterDate) {
      const start = new Date(filterDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(filterDate);
      end.setHours(23, 59, 59, 999);
      query = query.gte('recorded_at', start.toISOString()).lte('recorded_at', end.toISOString());
    }

    const { data, error } = await query;
    if (error) console.error(error);
    setLogs((data as EntryExitLog[]) ?? []);
    setLoading(false);
  }, [user, filterType, filterDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const openForm = (type: MovementType) => {
    setFormType(type);
    setFormOpen(true);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title={t('dashboard')} description={t('supervisorDashboardDesc')} />

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <button
          onClick={() => openForm('entry')}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border p-6 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black dark:bg-white">
            <LogIn size={24} className="text-white dark:text-black" />
          </div>
          <span className="font-bold text-lg">{t('registerEntry')}</span>
        </button>

        <button
          onClick={() => openForm('exit')}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border p-6 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-black dark:border-white">
            <LogOut size={24} />
          </div>
          <span className="font-bold text-lg">{t('registerExit')}</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Filter size={16} />
        </div>
        <Select
          className="w-auto min-w-[100px]"
          value={filterType}
          onChange={(v) => setFilterType(v as 'all' | MovementType)}
          options={[
            { value: 'all', label: t('allTypes') },
            { value: 'entry', label: t('entry') },
            { value: 'exit', label: t('exit') },
          ]}
        />
        <DatePicker
          className="w-auto"
          value={filterDate}
          onChange={setFilterDate}
          placeholder={t('date')}
        />
        {(filterType !== 'all' || filterDate) && (
          <button
            onClick={() => { setFilterType('all'); setFilterDate(''); }}
            className="text-xs text-muted hover:text-fg"
          >
            {t('close')}
          </button>
        )}
      </div>

      {/* Recent logs */}
      <div>
        <h2 className="text-lg font-bold mb-3">{t('recentLogs')}</h2>

        {loading ? (
          <InlineSpinner label={t('loading')} />
        ) : logs.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-muted">{t('noLogs')}</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <th className="table-header text-start px-4 py-3">{t('equipmentCodeLabel')}</th>
                    <th className="table-header text-start px-4 py-3">{t('equipmentType')}</th>
                    <th className="table-header text-start px-4 py-3">{t('movementType')}</th>
                    <th className="table-header text-start px-4 py-3">{t('driverName')}</th>
                    <th className="table-header text-start px-4 py-3">{t('registrationMethod')}</th>
                    <th className="table-header text-start px-4 py-3">{t('recordedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-4 py-3 font-semibold">{log.equipment?.code ?? '—'}</td>
                      <td className="px-4 py-3 text-muted">{log.equipment?.type ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="badge border" style={{ borderColor: 'var(--border)' }}>
                          {log.movement_type === 'entry' ? t('entry') : t('exit')}
                        </span>
                      </td>
                      <td className="px-4 py-3">{log.driver_name ?? '—'}</td>
                      <td className="px-4 py-3 text-muted">
                        {log.registration_method === 'qr' ? t('qr') : t('manual')}
                      </td>
                      <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(log.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <EntryExitForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        movementType={formType}
        onSaved={fetchLogs}
      />
    </div>
  );
}
