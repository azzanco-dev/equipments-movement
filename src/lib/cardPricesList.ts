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

// Until migration 0189 the page opened on the OPEN cards (a default filter
// on `is_open`); a card is neither open nor ended any more (owner
// 2026-11-11), so the page lists every card that sits on a supplier PO.

/**
 * Applies the always-on condition to a PostgREST query (`.not(column, 'is',
 * null)`); typed loosely so the pure tests can pass a recorder.
 */
export function withSupplierLineOnly<
  T extends { not: (column: string, operator: 'is', value: null) => T },
>(query: T): T {
  return query.not(CARD_PRICES_REQUIRED_COLUMN, 'is', null)
}
