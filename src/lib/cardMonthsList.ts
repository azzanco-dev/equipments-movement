import type { ListFilter } from '@/components/data-list/types'
import { saudiMonthKeys } from '@/lib/saudiTime'

/**
 * The month default of the «الشهور» list (sales phase 2, migration 0172),
 * kept out of `listConfigs.ts` so that module keeps exporting list configs
 * only (its tests iterate every export).
 */

/** The list's filter key of the month (`sales_card_month_slots.month`, the
 *  first day of the Saudi month). */
export const CARD_MONTHS_MONTH_FILTER_KEY = 'month'

/** The list opens on the PREVIOUS Saudi month (its first day): the month
 *  whose timesheet is usually being entered. */
export const CARD_MONTHS_DEFAULT_MONTH = saudiMonthKeys(1).from

/** The default month filter, visible and removable; the screen re-adds it
 *  when neither a month nor a company filter is left, because the view is
 *  computed on read and is never read whole. */
export const CARD_MONTHS_DEFAULT_FILTER: ListFilter = {
  id: 'default-month',
  field: CARD_MONTHS_MONTH_FILTER_KEY,
  operator: 'eq',
  value: CARD_MONTHS_DEFAULT_MONTH,
}

/** The view is computed on read: the query always carries a month or a
 *  company (the default month is re-added when both are removed). */
export function hasMonthOrCompanyFilter(
  filters: readonly ListFilter[],
): boolean {
  return filters.some(
    (filter) =>
      (filter.field === CARD_MONTHS_MONTH_FILTER_KEY ||
        filter.field === 'company_id') &&
      filter.value.trim() !== '',
  )
}
