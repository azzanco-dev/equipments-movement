import type { ListFilter } from '@/components/data-list/types'

/**
 * The fixed parts of the «اسعار المعدات» list (card pricing, migration
 * 0174), kept out of `listConfigs.ts` so that module keeps exporting list
 * configs only (its tests iterate every export).
 */

/**
 * The page lists only the cards that sit on a supplier PO line (owner
 * 2026-11-04: «كروت المعدات بتصير تجيب كل المعدات الي لها PO مورد»): the
 * query ALWAYS carries `supplier_line_id IS NOT NULL`, whatever the filters.
 */
export const CARD_PRICES_REQUIRED_COLUMN = 'supplier_line_id'

/** The open cards by default: a visible, removable filter. */
export const CARD_PRICES_DEFAULT_FILTER: ListFilter = {
  id: 'default-open',
  field: 'is_open',
  operator: 'eq',
  value: 'true',
}

/**
 * Applies the always-on condition to a PostgREST query (`.not(column, 'is',
 * null)`); typed loosely so the pure tests can pass a recorder.
 */
export function withSupplierLineOnly<
  T extends { not: (column: string, operator: 'is', value: null) => T },
>(query: T): T {
  return query.not(CARD_PRICES_REQUIRED_COLUMN, 'is', null)
}
