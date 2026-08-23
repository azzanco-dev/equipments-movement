import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { useAuth } from '@/auth/AuthContext';
import { InlineSpinner } from '@/components/Spinner';
import { LogIn, LogOut, Filter } from 'lucide-react';
import { DatePicker } from '@/components/DatePicker';
import type { EntryExitLog, MovementType } from '@/lib/types';
import { Select } from '@/components/Select';
import { PageHeader } from '@/components/PageHeader';
import { formatDate } from '@/lib/dateFormat';
import { Alert } from '@/components/Alert';

export function SupervisorDashboard({ onSelectMovement, onCreateMovement }: { onSelectMovement: (id: string) => void; onCreateMovement: (type: MovementType) => void }) {
  const { t } = useI18n();
  const { user, profile } = useAuth();
  const [logs, setLogs] = useState<EntryExitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | MovementType>('all');
  const [filterDate, setFilterDate] = useState('');
  const [classificationBusy, setClassificationBusy] = useState<string | null>(null);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const workshopManagerMode = profile?.role === 'workshop_manager';
  const workshopMode = profile?.role === 'workshop' || workshopManagerMode;

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from('entry_exit_logs')
      .select('*, equipment(*)')
      .eq('movement_context', workshopMode ? 'workshop' : 'site')
      .order('recorded_at', { ascending: false })
      .limit(100);

    if (!workshopManagerMode) query = query.eq('supervisor_id', user.id);

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
  }, [user, workshopMode, workshopManagerMode, filterType, filterDate]);

  const classifyEntry = async (logId: string, purpose: string) => {
    setClassificationBusy(logId);
    setClassificationError(null);
    const { error } = await supabase.rpc('classify_workshop_entry', { p_entry_log_id: logId, p_purpose: purpose });
    setClassificationBusy(null);
    if (error) { setClassificationError(t('workshopClassificationFailed')); return; }
    await fetchLogs();
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title={t('dashboard')} description={workshopManagerMode ? t('workshopManagerDashboardDesc') : t('supervisorDashboardDesc')} />

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <button
          onClick={() => onCreateMovement('entry')}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border p-6 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="status-entry flex h-12 w-12 items-center justify-center rounded-full border">
            <LogIn size={24} />
          </div>
          <span className="font-bold text-lg">{t('registerEntry')}</span>
        </button>

        <button
          onClick={() => onCreateMovement('exit')}
          className="flex flex-col items-center justify-center gap-2 rounded-xl border p-6 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="status-exit flex h-12 w-12 items-center justify-center rounded-full border">
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
        <h2 className="text-lg font-bold mb-3">{workshopManagerMode ? t('recentWorkshopLogs') : t('recentLogs')}</h2>
        {classificationError && <div className="mb-3"><Alert type="error">{classificationError}</Alert></div>}

        {loading ? (
          <InlineSpinner label={t('loading')} />
        ) : logs.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-muted">{t('noLogs')}</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="compact-table w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <th className="table-header text-start px-4 py-3">{workshopMode ? t('equipmentCodeLabel') : t('contractorEquipmentCode')}</th>
                    <th className="table-header text-start px-4 py-3">{t('equipmentNameLabel')}</th>
                    <th className="table-header text-start px-4 py-3">{t('movementType')}</th>
                    {workshopManagerMode && <th className="table-header text-start px-4 py-3">{t('workshopPurpose')}</th>}
                    {!workshopMode && <th className="table-header text-start px-4 py-3">{t('driverName')}</th>}
                    <th className="table-header text-start px-4 py-3">{t('recordedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      style={{ borderColor: 'var(--border)' }}
                      onClick={() => onSelectMovement(log.id)}
                    >
                      <td className="px-4 py-3 font-semibold">{workshopMode ? (log.equipment?.code ?? '—') : (log.contractor_equipment_code ?? '—')}</td>
                      <td className="px-4 py-3 text-muted">{workshopMode ? (log.equipment?.type ?? '—') : (log.equipment?.code ?? '—')}</td>
                      <td className="px-4 py-3">
                        <span className={`badge border ${log.movement_type === 'entry' ? 'status-entry' : 'status-exit'}`}>
                          {log.movement_type === 'entry' ? t('entry') : t('exit')}
                        </span>
                      </td>
                      {workshopManagerMode && (
                        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                          {log.movement_type === 'entry' ? (
                            <Select
                              compact
                              className={`min-w-[130px] ${classificationBusy === log.id ? 'pointer-events-none opacity-60' : ''}`}
                              value={log.workshop_purpose ?? ''}
                              onChange={(value) => classifyEntry(log.id, value)}
                              options={[
                                ...(log.workshop_purpose ? [] : [{ value: '', label: t('pendingClassification') }]),
                                { value: 'maintenance', label: t('maintenancePurpose') },
                                { value: 'parking', label: t('parkingPurpose') },
                              ]}
                            />
                          ) : '—'}
                        </td>
                      )}
                      {!workshopMode && <td className="px-4 py-3">{log.driver_name ?? '—'}</td>}
                      <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(log.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
