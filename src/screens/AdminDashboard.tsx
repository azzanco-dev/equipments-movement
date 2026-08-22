import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { InlineSpinner } from '@/components/Spinner';
import { exportLogsToExcel, exportVisitsToExcel } from '@/lib/excel';
import { LogIn, LogOut, Truck, AlertCircle, Download, Filter, Calendar } from 'lucide-react';
import { DatePicker } from '@/components/DatePicker';
import type { EntryExitLog, EquipmentVisit, Profile, Equipment } from '@/lib/types';
import { Select } from '@/components/Select';
import { PageHeader } from '@/components/PageHeader';

export function AdminDashboard({ onSelectMovement }: { onSelectMovement?: (id: string) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'logs' | 'reports'>('logs');

  // Stats
  const [stats, setStats] = useState({ todayEntries: 0, todayExits: 0, activeEquipment: 0, outsideEquipment: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  // Logs
  const [logs, setLogs] = useState<EntryExitLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [filterEquipment, setFilterEquipment] = useState('');
  const [filterSupervisor, setFilterSupervisor] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'entry' | 'exit'>('all');
  const [filterDate, setFilterDate] = useState('');
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [supervisors, setSupervisors] = useState<Profile[]>([]);

  // Reports
  const [visits, setVisits] = useState<EquipmentVisit[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [visitDateFrom, setVisitDateFrom] = useState('');
  const [visitDateTo, setVisitDateTo] = useState('');

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    // Today's entries
    const { count: todayEntries } = await supabase
      .from('entry_exit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('movement_type', 'entry')
      .gte('recorded_at', todayStr);

    // Today's exits
    const { count: todayExits } = await supabase
      .from('entry_exit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('movement_type', 'exit')
      .gte('recorded_at', todayStr);

    // Active equipment count
    const { count: activeCount } = await supabase
      .from('equipment')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Equipment currently outside site (last movement was exit)
    const { data: lastMovements } = await supabase.rpc('get_all_equipment_last_movement');
    const outsideCount = (lastMovements as { movement_type: string }[] | null)?.filter(
      (m) => m.movement_type === 'exit'
    ).length ?? 0;

    setStats({
      todayEntries: todayEntries ?? 0,
      todayExits: todayExits ?? 0,
      activeEquipment: activeCount ?? 0,
      outsideEquipment: outsideCount,
    });
    setLoadingStats(false);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    let query = supabase
      .from('entry_exit_logs')
      .select('*, equipment(*), supervisor:profiles(*)')
      .order('recorded_at', { ascending: false })
      .limit(200);

    if (filterType !== 'all') query = query.eq('movement_type', filterType);
    if (filterEquipment) query = query.eq('equipment_id', filterEquipment);
    if (filterSupervisor) query = query.eq('supervisor_id', filterSupervisor);
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
    setLoadingLogs(false);
  }, [filterType, filterEquipment, filterSupervisor, filterDate]);

  const fetchVisits = useCallback(async () => {
    setLoadingVisits(true);
    let query = supabase.from('equipment_visits').select('*').order('entry_recorded_at', { ascending: false }).limit(200);

    if (visitDateFrom) {
      const d = new Date(visitDateFrom);
      d.setHours(0, 0, 0, 0);
      query = query.gte('entry_recorded_at', d.toISOString());
    }
    if (visitDateTo) {
      const d = new Date(visitDateTo);
      d.setHours(23, 59, 59, 999);
      query = query.lte('entry_recorded_at', d.toISOString());
    }

    const { data, error } = await query;
    if (error) console.error(error);
    setVisits((data as EquipmentVisit[]) ?? []);
    setLoadingVisits(false);
  }, [visitDateFrom, visitDateTo]);

  // Initial load
  useEffect(() => {
    fetchStats();
    supabase.from('equipment').select('*').eq('is_active', true).order('code').then(({ data }) => {
      setEquipmentList((data as Equipment[]) ?? []);
    });
    supabase.from('profiles').select('*').order('full_name').then(({ data }) => {
      setSupervisors((data as Profile[]) ?? []);
    });
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const statCards = [
    { label: t('todayEntries'), value: stats.todayEntries, icon: <LogIn size={20} /> },
    { label: t('todayExits'), value: stats.todayExits, icon: <LogOut size={20} /> },
    { label: t('activeEquipment'), value: stats.activeEquipment, icon: <Truck size={20} /> },
    { label: t('equipmentOutside'), value: stats.outsideEquipment, icon: <AlertCircle size={20} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title={t('dashboard')} description={t('dashboardDesc')} />

      {/* Stats */}
      {loadingStats ? (
        <InlineSpinner label={t('loading')} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {statCards.map((stat) => (
            <div key={stat.label} className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted font-medium">{stat.label}</span>
                <span className="text-muted">{stat.icon}</span>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setTab('logs')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'logs'
              ? 'border-black dark:border-white text-fg'
              : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {t('allLogs')}
        </button>
        <button
          onClick={() => setTab('reports')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'reports'
              ? 'border-black dark:border-white text-fg'
              : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {t('visitReports')}
        </button>
      </div>

      {/* Logs tab */}
      {tab === 'logs' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Filter size={16} />
            </div>
            <Select
              className="w-auto min-w-[140px]"
              value={filterEquipment}
              onChange={setFilterEquipment}
              placeholder={t('allEquipment')}
              searchable

              options={[
                { value: '', label: t('allEquipment') },
                ...equipmentList.map((eq) => ({ value: eq.id, label: `${eq.code} — ${eq.type}` })),
              ]}
            />
            <Select
              className="w-auto min-w-[140px]"
              value={filterSupervisor}
              onChange={setFilterSupervisor}
              placeholder={t('allSupervisors')}
              searchable

              options={[
                { value: '', label: t('allSupervisors') },
                ...supervisors.map((s) => ({ value: s.id, label: s.full_name })),
              ]}
            />
            <Select
              className="w-auto min-w-[100px]"
              value={filterType}
              onChange={(v) => setFilterType(v as 'all' | 'entry' | 'exit')}
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
            <button
              onClick={() => exportLogsToExcel(logs, `logs-${new Date().toISOString().slice(0, 10)}`, t as (k: string) => string)}
              className="btn-outline"
              disabled={logs.length === 0}
            >
              <Download size={16} />
              {t('exportExcel')}
            </button>
          </div>

          {/* Table */}
          {loadingLogs ? (
            <InlineSpinner label={t('loading')} />
          ) : logs.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-muted">{t('noResults')}</p>
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
                      <th className="table-header text-start px-4 py-3">{t('supervisorName')}</th>
                      <th className="table-header text-start px-4 py-3">{t('registrationMethod')}</th>
                      <th className="table-header text-start px-4 py-3">{t('recordedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className={`border-b last:border-0 ${onSelectMovement ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors' : ''}`}
                        style={{ borderColor: 'var(--border)' }}
                        onClick={onSelectMovement ? () => onSelectMovement(log.id) : undefined}
                      >
                        <td className="px-4 py-3 font-semibold">{log.equipment?.code ?? '—'}</td>
                        <td className="px-4 py-3 text-muted">{log.equipment?.type ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className="badge border" style={{ borderColor: 'var(--border)' }}>
                            {log.movement_type === 'entry' ? t('entry') : t('exit')}
                          </span>
                        </td>
                        <td className="px-4 py-3">{log.driver_name ?? '—'}</td>
                        <td className="px-4 py-3">{log.supervisor?.full_name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted">{log.registration_method === 'qr' ? t('qr') : t('manual')}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(log.recorded_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reports tab */}
      {tab === 'reports' && (
        <div className="space-y-4">
          {/* Date filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Calendar size={16} />
            </div>
            <DatePicker
              className="w-auto"
              value={visitDateFrom}
              onChange={setVisitDateFrom}
              placeholder={t('from')}
            />
            <DatePicker
              className="w-auto"
              value={visitDateTo}
              onChange={setVisitDateTo}
              placeholder={t('to')}
            />
            <button
              onClick={() => exportVisitsToExcel(visits, `visits-${new Date().toISOString().slice(0, 10)}`, t as (k: string) => string)}
              className="btn-outline"
              disabled={visits.length === 0}
            >
              <Download size={16} />
              {t('exportExcel')}
            </button>
          </div>

          {/* Visits table */}
          {loadingVisits ? (
            <InlineSpinner label={t('loading')} />
          ) : visits.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-muted">{t('noVisits')}</p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <th className="table-header text-start px-4 py-3">{t('equipmentCodeLabel')}</th>
                      <th className="table-header text-start px-4 py-3">{t('equipmentType')}</th>
                      <th className="table-header text-start px-4 py-3">{t('driverName')}</th>
                      <th className="table-header text-start px-4 py-3">{t('entryTime')}</th>
                      <th className="table-header text-start px-4 py-3">{t('entryBy')}</th>
                      <th className="table-header text-start px-4 py-3">{t('exitTime')}</th>
                      <th className="table-header text-start px-4 py-3">{t('exitBy')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v.entry_log_id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-4 py-3 font-semibold">{v.equipment_code}</td>
                        <td className="px-4 py-3 text-muted">{v.equipment_type}</td>
                        <td className="px-4 py-3">{v.driver_name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(v.entry_recorded_at)}</td>
                        <td className="px-4 py-3">{v.entry_supervisor_name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">
                          {v.exit_recorded_at ? formatDate(v.exit_recorded_at) : '—'}
                        </td>
                        <td className="px-4 py-3">{v.exit_supervisor_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
