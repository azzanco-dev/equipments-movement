import { Filter, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { FilterBuilder } from './FilterBuilder';
import { PAGE_SIZE_OPTIONS, type DataListConfig, type ListFilter } from './types';

export function DataListToolbar({ config, search, onSearch, sort, direction, onSort, pageSize, onPageSize, filters, onFilters, selectedCount = 0, bulkActions, actions }: { config: DataListConfig; search: string; onSearch: (value: string) => void; sort: string; direction: 'asc' | 'desc'; onSort: (field: string, direction: 'asc' | 'desc') => void; pageSize: number; onPageSize: (size: number) => void; filters: ListFilter[]; onFilters: (filters: ListFilter[]) => void; selectedCount?: number; bulkActions?: ReactNode; actions?: ReactNode }) {
  const [filtersOpen, setFiltersOpen] = useState(filters.length > 0);
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted" /><input className="input ps-9" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={config.searchPlaceholder} /></div>
      <button className="btn-outline" onClick={() => setFiltersOpen((value) => !value)}><Filter size={16} />الفلاتر{filters.length ? ` (${filters.length})` : ''}</button>
      <Select className="min-w-[150px]" value={sort} onChange={(value) => onSort(value, direction)} options={config.sortableFields.map((field) => ({ value: field.key, label: field.label }))} />
      <Select className="w-[90px]" value={direction} onChange={(value) => onSort(sort, value as 'asc' | 'desc')} options={[{ value: 'asc', label: 'تصاعدي' }, { value: 'desc', label: 'تنازلي' }]} />
      <Select className="w-[90px]" value={String(pageSize)} onChange={(value) => onPageSize(Number(value))} options={(config.pageSizeOptions ?? PAGE_SIZE_OPTIONS).map((value) => ({ value: String(value), label: String(value) }))} />{actions}</div>
    {filtersOpen && <div className="card space-y-2"><div className="flex justify-between"><span className="text-sm font-semibold">تصفية النتائج</span>{filters.length > 0 && <button className="btn-ghost text-xs" onClick={() => onFilters([])}><X size={14} />مسح</button>}</div><FilterBuilder fields={config.filterFields} filters={filters} onChange={onFilters} /></div>}
    {selectedCount > 0 && <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}><b>{selectedCount} محدد</b>{bulkActions}</div>}
  </div>;
}
