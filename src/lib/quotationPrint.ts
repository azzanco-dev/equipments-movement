import { translations, type TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import { saudiClockLabel } from '@/lib/homeGreeting'
import { saudiDateKey } from '@/lib/saudiTime'

/**
 * The pure rules of the quotation PDF (the sheet the owner approved in
 * Figma on 2026-11-19, «تمام اعتمد الان»): its three versions, the fixed
 * working hours, the English names of the default costs and the page footer.
 */

// --- The three versions --------------------------------------------------------

/** Arabic only, English only, or both («خليط»: the bilingual sheet). */
export type QuotationPrintVariant = 'ar' | 'en' | 'both'

/** In the order the export menu offers them. */
export const QUOTATION_PRINT_VARIANTS: readonly QuotationPrintVariant[] = [
  'ar',
  'en',
  'both',
]

/** The menu label of each version. */
export const QUOTATION_PRINT_VARIANT_KEYS: Readonly<
  Record<QuotationPrintVariant, TranslationKey>
> = {
  ar: 'quotationPdfAr',
  en: 'quotationPdfEn',
  both: 'quotationPdfBoth',
}

/** The English sheet reads left to right; the two others right to left. */
export function quotationPrintDir(
  variant: QuotationPrintVariant,
): 'rtl' | 'ltr' {
  return variant === 'en' ? 'ltr' : 'rtl'
}

// --- Working hours -------------------------------------------------------------

/** «ساعات العمل» (owner 2026-11-18, «عدد الساعات اليومية وعدد الايام
 *  الشهرية وعدد الساعات الشهرية, جدول جنب جدول التكاليف»). */
export interface QuotationWorkingHours {
  dailyHours: number
  monthlyDays: number
  monthlyHours: number
}

/** The program's standard month: 10 hours a day, 26 days, 260 hours. Fixed
 *  for every quotation until the owner asks for them as quotation fields. */
export const QUOTATION_WORKING_HOURS: QuotationWorkingHours = {
  dailyHours: 10,
  monthlyDays: 26,
  monthlyHours: 260,
}

/** The rows of the working-hours table, in print order. */
export function quotationHoursRows(
  hours: QuotationWorkingHours = QUOTATION_WORKING_HOURS,
): { key: TranslationKey; value: number }[] {
  return [
    { key: 'quotationPrintDailyHours', value: hours.dailyHours },
    { key: 'quotationPrintMonthlyDays', value: hours.monthlyDays },
    { key: 'quotationPrintMonthlyHours', value: hours.monthlyHours },
  ]
}

// --- Cost names ----------------------------------------------------------------

/** The English names of the costs a new quotation starts with. A cost the
 *  user typed is stored in ONE language and prints as it is. */
export const QUOTATION_COST_NAMES_EN: Readonly<Record<string, string>> = {
  الديزل: 'Diesel',
  'المعيشة (الاكل والسكن)': 'Accommodation (food and housing)',
  المواصلات: 'Transportation',
}

/** The English name of a default cost, or null for any other name. */
export function quotationCostNameEn(name: string): string | null {
  return QUOTATION_COST_NAMES_EN[name.trim()] ?? null
}

// --- The page footer -----------------------------------------------------------

/**
 * On EVERY printed page the page number and the time the file was issued
 * (owner 2026-11-17, «نبغى نضيف موثوقية اكثر لمستند الـ PDF»).
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
 * footer line — the page number at the start side of the version, the issue
 * time at the end side, in the version's language (both for the mixed
 * sheet), in the app's font and the muted token.
 */
export function quotationPageCss(
  issuedAt: string,
  variant: QuotationPrintVariant = 'both',
): string {
  const { ar, en } = translations
  const dir = quotationPrintDir(variant)
  const box =
    `direction: ${dir}; white-space: nowrap; padding: 0 10mm; ` +
    'font-family: var(--font-primary); font-size: 10px; color: var(--muted);'
  const pageOf = (
    words: { quotationPrintPage: string; quotationPrintPageOf: string },
    lead = '',
  ) =>
    `${cssString(`${lead}${words.quotationPrintPage} `)} counter(page) ` +
    `${cssString(` ${words.quotationPrintPageOf} `)} counter(pages)`
  const page =
    variant === 'ar'
      ? pageOf(ar)
      : variant === 'en'
        ? pageOf(en)
        : `${pageOf(ar)} ${pageOf(en, ' / ')}`
  const issuedLabel =
    variant === 'ar'
      ? ar.quotationPrintFileIssued
      : variant === 'en'
        ? en.quotationPrintFileIssued
        : `${ar.quotationPrintFileIssued} / ${en.quotationPrintFileIssued}`
  const issued = cssString(`${issuedLabel}: ${issuedAt}`)
  // The page number sits at the start side: the right of a right-to-left
  // sheet, the left of the English one.
  const [pageBox, issuedBox] =
    dir === 'rtl'
      ? ['@bottom-right', '@bottom-left']
      : ['@bottom-left', '@bottom-right']
  return (
    `@page { size: A4 portrait; margin: 0 0 ${QUOTATION_PAGE_FOOTER_MM}mm 0; ` +
    `${pageBox} { content: ${page}; ${box} } ` +
    `${issuedBox} { content: ${issued}; ${box} } }`
  )
}
