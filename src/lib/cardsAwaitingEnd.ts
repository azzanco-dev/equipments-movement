/**
 * «بانتظار الانهاء» of the «كروت المعدات» list (migration 0185): the open
 * cards whose unit left the card's project with «انتهاء عمل»
 * (`sales_cards_awaiting_end`). Not a column of `sales_equipment_cards`, so
 * the screen reads the ids first and filters `.in('card_id', ids)`; the
 * switch lives in the URL as `awaiting=1`, the deep link of the home's
 * attention item (`/sales/cards?awaiting=1`).
 */

/** The URL key of the switch. */
export const CARDS_AWAITING_END_PARAM = 'awaiting'

/** The deep link of the list restricted to the cards awaiting their end. */
export const CARDS_AWAITING_END_HREF = `/sales/cards?${CARDS_AWAITING_END_PARAM}=1`

/** True when the URL asks for the cards awaiting their end. */
export function isCardsAwaitingEnd(params: {
  get: (key: string) => string | null
}): boolean {
  return params.get(CARDS_AWAITING_END_PARAM) === '1'
}

/**
 * The query string after switching: the other keys kept (search, filters,
 * sort, page size), the page dropped (the result set changes), `awaiting=1`
 * set or removed.
 */
export function cardsAwaitingEndHref(
  params: { entries: () => Iterable<[string, string]> },
  awaiting: boolean,
): string {
  const query = new URLSearchParams(
    Array.from(params.entries()).filter(
      ([key]) => key !== CARDS_AWAITING_END_PARAM && key !== 'page',
    ),
  )
  if (awaiting) query.set(CARDS_AWAITING_END_PARAM, '1')
  return query.toString()
}
