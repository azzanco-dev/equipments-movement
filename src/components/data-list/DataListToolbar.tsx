import { ArrowDownAZ, ArrowUpAZ, ChevronDown, Filter, MoreHorizontal, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { FilterBuilder } from './FilterBuilder';
import { PAGE_SIZE_OPTIONS, type DataListConfig, type ListFilter } from './types';
import { useI18n } from '@/i18n/I18nContext';

interface ToolbarProps {
  config: DataListConfig; search: string; onSearch: (value: string) => void;
  sort: string; direction: 'asc' | 'desc'; onSort: (field: string, direction: 'asc' | 'desc') => void;
  pageSize: number; onPageSize: (size: number) => void; filters: ListFilter[]; onFilters: (filters: ListFilter[]) => void;
  selectedCount?: number; bulkActions?: ReactNode; actions?: ReactNode; menuActions?: ReactNode; primaryAction?: ReactNode; compact?: boolean;
}

export function DataListToolbar({ config, search, onSearch, sort, direction, onSort, pageSize, onPageSize, filters, onFilters, selectedCount = 0, bulkActions, actions, menuActions, primaryAction, compact = false }: ToolbarProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<'filters' | 'sort' | 'actions' | null>(null);
  const [draftFilters, setDraftFilters] = useState(filters);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const currentSort = config.sortableFields.find((field) => field.key === sort);
  useEffect(() => { const close = (event: MouseEvent) => { if (!toolbarRef.current?.contains(event.target as Node)) setOpen(null); }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close); }, []);
  const toggle = (target: 'filters' | 'sort' | 'actions') => { if (target === 'filters') setDraftFilters(filters); setOpen((current) => current === target ? null : target); };
  return <div className="space-y-3" ref={toolbarRef}>
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] w-full sm:w-[360px] lg:w-[460px]"><Search size={compact ? 14 : 16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted" /><input className={`input ps-9 ${compact ? 'h-8 py-1 text-sm' : ''}`} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={config.searchPlaceholder} /></div>
      <div className="relative">
        <button className="btn-outline" onClick={() => toggle('filters')}><Filter size={15} />{t('filters')}{filters.length > 0 && <span className="rounded bg-gray-100 px-1.5 text-xs dark:bg-gray-700">{filters.length}</span>}<ChevronDown size={14} /></button>
        {open === 'filters' && <div className="absolute end-0 top-[calc(100%+6px)] z-40 w-[min(560px,calc(100vw-24px))] rounded-lg border p-3 shadow-xl" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
          <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">{t('filterResults')}</span><button className="btn-ghost p-1" onClick={() => setOpen(null)}><X size={15} /></button></div>
          <FilterBuilder fields={config.filterFields} filters={draftFilters} onChange={setDraftFilters} compact />
          <div className="mt-4 flex justify-end gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}><button className="btn-ghost" onClick={() => setDraftFilters([])}>{t('clear')}</button><button className="btn-primary" onClick={() => { onFilters(draftFilters); setOpen(null); }}>{t('applyFilters')}</button></div>
        </div>}
      </div>
      <div className="relative">
        <button className="btn-outline" onClick={() => toggle('sort')}>{direction === 'asc' ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}<span className="hidden sm:inline">{currentSort?.label ?? t('sortBy')}</span><ChevronDown size={14} /></button>
        {open === 'sort' && <div className="absolute end-0 top-[calc(100%+8px)] z-40 min-w-[230px] rounded-xl border py-2 shadow-xl" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
          <div className="flex gap-1 border-b px-2 pb-2" style={{ borderColor: 'var(--border)' }}><button className={`btn-ghost flex-1 ${direction === 'asc' ? 'bg-gray-100 dark:bg-gray-700' : ''}`} onClick={() => onSort(sort, 'asc')}>{t('ascending')}</button><button className={`btn-ghost flex-1 ${direction === 'desc' ? 'bg-gray-100 dark:bg-gray-700' : ''}`} onClick={() => onSort(sort, 'desc')}>{t('descending')}</button></div>
          <div className="max-h-72 overflow-y-auto p-1">{config.sortableFields.map((field) => <button key={field.key} className={`flex w-full items-center rounded-lg px-3 py-2 text-start text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${field.key === sort ? 'font-semibold' : ''}`} onClick={() => { onSort(field.key, direction); setOpen(null); }}>{field.label}</button>)}</div>
        </div>}
      </div>
      <Select compact className="w-[78px]" value={String(pageSize)} onChange={(value) => onPageSize(Number(value))} options={(config.pageSizeOptions ?? PAGE_SIZE_OPTIONS).map((value) => ({ value: String(value), label: String(value) }))} />
      {menuActions && <div className="relative"><button className="btn-outline px-2.5" onClick={() => toggle('actions')} aria-label={t('moreActions')}><MoreHorizontal size={18} /></button>{open === 'actions' && <div className="absolute end-0 top-[calc(100%+8px)] z-40 min-w-[190px] space-y-1 rounded-xl border p-2 shadow-xl [&>button]:w-full [&>button]:justify-start" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }} onClick={() => setOpen(null)}>{menuActions}</div>}</div>}
      {actions}{primaryAction}
    </div>
    {selectedCount > 0 && <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}><b>{t('selectedCount').replace('{count}', String(selectedCount))}</b>{bulkActions}</div>}
  </div>;
}
