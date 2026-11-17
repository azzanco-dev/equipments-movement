import { translations } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import { saudiClockLabel } from '@/lib/homeGreeting'
import { saudiDateKey } from '@/lib/saudiTime'

/**
 * The page footer of the quotation PDF (owner 2026-11-17, «نبغى نضيف
 * موثوقية اكثر لمستند الـ PDF»): on EVERY printed page the page number
 * «صفحة 1 من 2 / Page 1 of 2» and the time the file was issued.
 *
 * It is drawn by CSS page-margin boxes (`@bottom-right` / `@bottom-left`
 * with `counter(page)` / `counter(pages)`), the only way a browser gives a
 * true page number. Checked in Chrome 157 and Edge by printing to PDF: the
 * counters are right on every page, and a page that defines its own margin
 * boxes gets NO browser header or footer (date, title, link). A browser
 * without margin boxes (Firefox, Safari) ignores them: no page number is
 * printed there, never a wrong one.
 */

/** The bottom margin that holds the footer line. */
export const QUOTATION_PAGE_FOOTER_MM = 12

/** «17/11/2026 10:24 PM»: the Saudi day and 12-hour time, Latin digits, the
 *  same clock helpers as the app header. */
export function printIssuedAtLabel(now: Date): string {
  return `${formatDate(saudiDateKey(now))} ${saudiClockLabel(now, 'en')}`
}

/** A CSS string literal: quotes and backslashes escaped, no raw line break. */
export function cssString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')}"`
}

/**
 * The `@page` rule of the quotation sheet: A4 portrait, no side or top
 * margin (the sheet's own padding is the margin), a bottom margin for the
 * footer line — the page number at the start side, the issue time at the
 * end side, both bilingual, in the app's font and the muted token.
 */
export function quotationPageCss(issuedAt: string): string {
  const { ar, en } = translations
  const box =
    'direction: rtl; white-space: nowrap; padding: 0 10mm; ' +
    'font-family: var(--font-primary); font-size: 10px; color: var(--muted);'
  const page =
    `${cssString(`${ar.quotationPrintPage} `)} counter(page) ` +
    `${cssString(` ${ar.quotationPrintPageOf} `)} counter(pages) ` +
    `${cssString(` / ${en.quotationPrintPage} `)} counter(page) ` +
    `${cssString(` ${en.quotationPrintPageOf} `)} counter(pages)`
  const issued = cssString(
    `${ar.quotationPrintFileIssued} / ${en.quotationPrintFileIssued}: ${issuedAt}`,
  )
  return (
    `@page { size: A4 portrait; margin: 0 0 ${QUOTATION_PAGE_FOOTER_MM}mm 0; ` +
    `@bottom-right { content: ${page}; ${box} } ` +
    `@bottom-left { content: ${issued}; ${box} } }`
  )
}
