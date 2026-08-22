import type { ListFilter } from '@/components/data-list/types';

type QueryLike = {
  eq: (column: string, value: unknown) => QueryLike;
  neq: (column: string, value: unknown) => QueryLike;
  in: (column: string, values: string[]) => QueryLike;
  not: (column: string, operator: string, value: unknown) => QueryLike;
  ilike: (column: string, pattern: string) => QueryLike;
  is: (column: string, value: null | boolean) => QueryLike;
  gt: (column: string, value: string) => QueryLike;
  lt: (column: string, value: string) => QueryLike;
  gte: (column: string, value: string) => QueryLike;
  lte: (column: string, value: string) => QueryLike;
};

export function applyListFilters<T>(source: T, filters: ListFilter[], allowedFields: Set<string>): T {
  let query = source as unknown as QueryLike;
  for (const filter of filters) {
    if (!allowedFields.has(filter.field)) continue;
    const values = filter.value.split(',').map((value) => value.trim()).filter(Boolean);
    if (!filter.value && !['is_set', 'is_not_set'].includes(filter.operator)) continue;
    switch (filter.operator) {
      case 'eq': query = query.eq(filter.field, filter.value); break;
      case 'neq': query = query.neq(filter.field, filter.value); break;
      case 'in': query = query.in(filter.field, values); break;
      case 'not_in': query = query.not(filter.field, 'in', `(${values.join(',')})`); break;
      case 'like': query = query.ilike(filter.field, `%${filter.value}%`); break;
      case 'not_like': query = query.not(filter.field, 'ilike', `%${filter.value}%`); break;
      case 'is_set': query = query.not(filter.field, 'is', null); break;
      case 'is_not_set': query = query.is(filter.field, null); break;
      case 'gt': query = query.gt(filter.field, filter.value); break;
      case 'lt': query = query.lt(filter.field, filter.value); break;
      case 'gte': query = query.gte(filter.field, filter.value); break;
      case 'lte': query = query.lte(filter.field, filter.value); break;
      case 'between': query = query.gte(filter.field, filter.value).lte(filter.field, filter.valueTo ?? filter.value); break;
    }
  }
  return query as unknown as T;
}
