import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DataListConfig, ListFilter } from './types';

const validSizes = new Set([20, 50, 100, 200, 350, 500]);

export function useDataListState(config: DataListConfig) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const search = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const requestedSize = Number(params.get('size')) || 20;
  const pageSize = validSizes.has(requestedSize) ? requestedSize : 20;
  const requestedSort = params.get('sort') ?? config.defaultSort;
  const sort = config.sortableFields.some((field) => field.key === requestedSort) ? requestedSort : config.defaultSort;
  const direction = params.get('dir') === 'desc' ? 'desc' : params.get('dir') === 'asc' ? 'asc' : (config.defaultDirection ?? 'asc');
  const filters = useMemo<ListFilter[]>(() => {
    try {
      const value = JSON.parse(params.get('filters') ?? '[]') as ListFilter[];
      return value.filter((filter) => config.filterFields.some((field) => field.key === filter.field && field.operators.includes(filter.operator)));
    } catch { return []; }
  }, [params, config.filterFields]);

  const update = useCallback((values: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(values).forEach(([key, value]) => value === null || value === '' ? next.delete(key) : next.set(key, String(value)));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { if (searchInput !== search) update({ q: searchInput.trim(), page: 1 }); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, search, update]);

  return {
    searchInput, setSearchInput, search, page, pageSize, sort, direction, filters,
    setPage: (value: number) => update({ page: Math.max(1, value) }),
    setPageSize: (value: number) => update({ size: value, page: 1 }),
    setSort: (field: string, dir: 'asc' | 'desc') => update({ sort: field, dir, page: 1 }),
    setFilters: (value: ListFilter[]) => update({ filters: value.length ? JSON.stringify(value) : null, page: 1 }),
    clear: () => { setSearchInput(''); router.replace(pathname, { scroll: false }); },
  };
}
