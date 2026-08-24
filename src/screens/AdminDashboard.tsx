import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nContext';
import { InlineSpinner } from '@/components/Spinner';
import { exportLogsToExcel, exportVisitsToExcel } from '@/lib/excel';
import { LogIn, LogOut, Truck, AlertCircle, Download } from 'lucide-react';
import type { EntryExitLog, EquipmentVisit } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { sanitizeSearchTerm } from '@/lib/search';
import { DataListToolbar } from '@/components/data-list/DataListToolbar';
import { DataListPagination } from '@/components/data-list/DataListPagination';
import { useDataListState } from '@/components/data-list/useDataListState';
import { movementsListConfig, visitsListConfig } from '@/lib/listConfigs';
import { applyListFilters } from '@/lib/applyListFilters';
import { formatDate } from '@/lib/dateFormat';
import { Modal } from '@/components/Modal';
import { localizedName } from '@/lib/localizedName';

async function loadLatestDriverNames(entryIds: string[]) {
  if (!entryIds.length) return new Map<string, string>();
  const { data } = await supabase.from('movement_driver_changes')
    .select('entry_log_id,new_driver_name,changed_at,id')
    .in('entry_log_id', entryIds)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false });
  const latest = new Map<string, string>();
  for (const change of data ?? []) {
    if (!latest.has(change.entry_log_id)) latest.set(change.entry_log_id, change.new_driver_name);
  }
  return latest;
}

export function AdminDashboard({ onSelectMovement, onCreateMovement }: { onSelectMovement?: (id: string) => void; onCreateMovement?: (type: 'entry' | 'exit') => void }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'reports' ? 'reports' : 'logs';

  // Stats
  const [stats, setStats] = useState({ todayEntries: 0, todayExits: 0, activeEquipment: 0, outsideEquipment: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  // Logs
  const [logs, setLogs] = useState<EntryExitLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [logsTotal, setLogsTotal] = useState(0);
  const list = useDataListState(movementsListConfig);

  // Reports
  const [visits, setVisits] = useState<EquipmentVisit[]>([]);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [visitsTotal, setVisitsTotal] = useState(0);
  const [selectedVisit, setSelectedVisit] = useState<EquipmentVisit | null>(null);
  const visitList = useDataListState(visitsListConfig, 'visit_');

  const setTab = (nextTab: 'logs' | 'reports') => {
    const next = new URLSearchParams(searchParams.toString());
    if (nextTab === 'reports') next.set('tab', 'reports'); else next.delete('tab');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    // Today's entries
    const { count: todayEntries } = await supabase
      .from('entry_exit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('movement_type', 'entry')
      .gte('recorded_at', todayStr);

    // Today's exits
    const { count: todayExits } = await supabase
      .from('entry_exit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('movement_type', 'exit')
      .gte('recorded_at', todayStr);

    // Active equipment count
    const { count: activeCount } = await supabase
      .from('equipment')
      .select('id', { count: 'exact', head: true })
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
    const term = sanitizeSearchTerm(list.search);
    let equipmentIds: string[] = [];
    if (term) {
      const { data: equipmentMatches } = await supabase.from('equipment').select('id').or(`code.ilike.%${term}%,type.ilike.%${term}%,plate_number.ilike.%${term}%`).limit(100);
      equipmentIds = (equipmentMatches ?? []).map((item) => item.id);
    }
    let query = supabase
      .from('entry_exit_logs')
      .select('id,equipment_id,supervisor_id,movement_type,movement_context,registration_method,driver_name,driver_id,notes,photo_url,company_id,project_id,contractor_equipment_code,recorded_at,created_at,equipment:equipment(id,code,type,plate_number),project:projects(id,name_ar,name_en)', { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1);
    if (term) query = query.or(`driver_name.ilike.%${term}%,contractor_equipment_code.ilike.%${term}%${equipmentIds.length ? `,equipment_id.in.(${equipmentIds.join(',')})` : ''}`);
    query = applyListFilters(query, list.filters, new Set(movementsListConfig.filterFields.map((field) => field.key)));
    const { data, error, count } = await query;
    if (error) console.error(error);
    const rows = (data as unknown as EntryExitLog[]) ?? [];
    const latestDrivers = await loadLatestDriverNames(rows.filter((row) => row.movement_type === 'entry').map((row) => row.id));
    setLogs(rows.map((row) => ({ ...row, current_driver_name: row.movement_type === 'entry' ? (latestDrivers.get(row.id) ?? row.driver_name) : row.driver_name })));
    setLogsTotal(count ?? 0);
    setLoadingLogs(false);
  }, [list.direction, list.filters, list.page, list.pageSize, list.search, list.sort]);

  const fetchVisits = useCallback(async () => {
    setLoadingVisits(true);
    let query = supabase.from('equipment_visits').select('equipment_id,equipment_code,equipment_type,contractor_equipment_code,plate_number,project_id,project_name_ar,project_name_en,company_name_ar,company_name_en,entry_log_id,entry_recorded_at,entry_supervisor_id,entry_supervisor_name,driver_name,odometer_reading,notes,exit_log_id,exit_recorded_at,exit_supervisor_id,exit_supervisor_name,exit_driver_name,exit_odometer,exit_notes,movement_context', { count: 'exact' }).order(visitList.sort, { ascending: visitList.direction === 'asc' }).range((visitList.page - 1) * visitList.pageSize, visitList.page * visitList.pageSize - 1);
    const term = sanitizeSearchTerm(visitList.search);
    if (term) query = query.or(`equipment_code.ilike.%${term}%,equipment_type.ilike.%${term}%,driver_name.ilike.%${term}%,exit_driver_name.ilike.%${term}%,contractor_equipment_code.ilike.%${term}%`);
    query = applyListFilters(query, visitList.filters, new Set(visitsListConfig.filterFields.map((field) => field.key)));
    const { data, error, count } = await query;
    if (error) console.error(error);
    const rows = (data as unknown as EquipmentVisit[]) ?? [];
    const latestDrivers = await loadLatestDriverNames(rows.map((row) => row.entry_log_id));
    setVisits(rows.map((row) => ({ ...row, last_driver_name: row.exit_driver_name ?? latestDrivers.get(row.entry_log_id) ?? row.driver_name })));
    setVisitsTotal(count ?? 0);
    setLoadingVisits(false);
  }, [visitList.direction, visitList.filters, visitList.page, visitList.pageSize, visitList.search, visitList.sort]);

  // Initial load
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => { if (tab === 'logs') fetchLogs(); }, [fetchLogs, tab]);
  useEffect(() => { if (tab === 'reports') fetchVisits(); }, [fetchVisits, tab]);

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
      {onCreateMovement && <div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={() => onCreateMovement('entry')}><LogIn size={17} />{t('registerEntry')}</button><button className="btn-outline" onClick={() => onCreateMovement('exit')}><LogOut size={17} />{t('registerExit')}</button></div>}

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
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {t('allLogs')}
        </button>
        <button
          onClick={() => setTab('reports')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'reports'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {t('visitReports')}
        </button>
      </div>

      {/* Logs tab */}
      {tab === 'logs' && (
        <div className="space-y-4">
          <DataListToolbar config={movementsListConfig} search={list.searchInput} onSearch={list.setSearchInput} sort={list.sort} direction={list.direction} onSort={list.setSort} pageSize={list.pageSize} onPageSize={list.setPageSize} filters={list.filters} onFilters={list.setFilters} actions={<button onClick={() => exportLogsToExcel(logs, `logs-${new Date().toISOString().slice(0, 10)}`, t as (k: string) => string)} className="btn-outline" disabled={logs.length === 0}><Download size={16} />{t('exportExcel')}</button>} />

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
                <table className="compact-table w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <th className="table-header text-start px-4 py-3">{t('contractorEquipmentCode')}</th>
                      <th className="table-header text-start px-4 py-3">{t('equipmentNameLabel')}</th>
                      <th className="table-header text-start px-4 py-3">{t('location')}</th>
                      <th className="table-header text-start px-4 py-3">{t('movementType')}</th>
                      <th className="table-header text-start px-4 py-3">{t('driverName')}</th>
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
                        <td className="px-4 py-3 font-semibold">{log.contractor_equipment_code ?? '—'}</td>
                        <td className="px-4 py-3">{log.equipment ? `${log.equipment.code} ${log.equipment.type}` : '—'}</td>
                        <td className="px-4 py-3">{log.movement_context === 'workshop' ? t('workshopLocation') : log.project ? localizedName(lang, log.project.name_ar, log.project.name_en) : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`badge border ${log.movement_type === 'entry' ? 'status-entry' : 'status-exit'}`}>
                            {log.movement_type === 'entry' ? t('entry') : t('exit')}
                          </span>
                        </td>
                        <td className="px-4 py-3">{log.current_driver_name ?? log.driver_name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(log.recorded_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DataListPagination page={list.page} pageSize={list.pageSize} total={logsTotal} onPage={list.setPage} />
        </div>
      )}

      {/* Reports tab */}
      {tab === 'reports' && (
        <div className="space-y-4">
          <DataListToolbar config={visitsListConfig} search={visitList.searchInput} onSearch={visitList.setSearchInput} sort={visitList.sort} direction={visitList.direction} onSort={visitList.setSort} pageSize={visitList.pageSize} onPageSize={visitList.setPageSize} filters={visitList.filters} onFilters={visitList.setFilters} actions={<button onClick={() => exportVisitsToExcel(visits, `visits-${new Date().toISOString().slice(0, 10)}`, t as (k: string) => string)} className="btn-outline" disabled={visits.length === 0}><Download size={16} />{t('exportExcel')}</button>} />

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
                <table className="compact-table min-w-[800px] w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <th className="table-header text-start px-4 py-3">{t('contractorEquipmentCode')}</th>
                      <th className="table-header text-start px-4 py-3">{t('equipmentNameLabel')}</th>
                      <th className="table-header text-start px-4 py-3">{t('location')}</th>
                      <th className="table-header text-start px-4 py-3">{t('driverName')}</th>
                      <th className="table-header text-start px-4 py-3">{t('entryTime')}</th>
                      <th className="table-header text-start px-4 py-3">{t('exitTime')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr
                        key={v.entry_log_id}
                        className="border-b last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => setSelectedVisit(v)}
                        tabIndex={0}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedVisit(v); }}
                      >
                        <td className="px-4 py-3 font-semibold">{v.contractor_equipment_code ?? '—'}</td>
                        <td className="px-4 py-3">{v.equipment_code} {v.equipment_type}</td>
                        <td className="px-4 py-3">{v.movement_context === 'workshop' ? t('workshopLocation') : localizedName(lang, v.project_name_ar, v.project_name_en)}</td>
                        <td className="px-4 py-3">{v.last_driver_name ?? v.driver_name ?? '—'}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(v.entry_recorded_at)}</td>
                        <td className="px-4 py-3 text-muted whitespace-nowrap">
                          {v.exit_recorded_at ? formatDate(v.exit_recorded_at) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DataListPagination page={visitList.page} pageSize={visitList.pageSize} total={visitsTotal} onPage={visitList.setPage} />
        </div>
      )}
      <Modal open={selectedVisit !== null} onClose={() => setSelectedVisit(null)} title={t('visitDetails')} size="lg">
        {selectedVisit && (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {[
              [t('equipmentCodeLabel'), selectedVisit.equipment_code],
              [t('equipmentNameLabel'), selectedVisit.equipment_type],
              [t('plateNumber'), selectedVisit.plate_number],
              [t('contractorEquipmentCode'), selectedVisit.contractor_equipment_code],
              [t('company'), localizedName(lang, selectedVisit.company_name_ar, selectedVisit.company_name_en)],
              [t('project'), localizedName(lang, selectedVisit.project_name_ar, selectedVisit.project_name_en)],
              [t('driverName'), selectedVisit.last_driver_name ?? selectedVisit.driver_name],
              [t('entryTime'), formatDate(selectedVisit.entry_recorded_at)],
              [t('entryBy'), selectedVisit.entry_supervisor_name],
              [t('exitTime'), selectedVisit.exit_recorded_at ? formatDate(selectedVisit.exit_recorded_at) : null],
              [t('exitBy'), selectedVisit.exit_supervisor_name],
              [t('entryNotes'), selectedVisit.notes],
              [t('exitNotes'), selectedVisit.exit_notes],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 font-medium break-words">{value || '—'}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
