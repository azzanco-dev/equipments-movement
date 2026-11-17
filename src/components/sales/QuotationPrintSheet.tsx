import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Price } from '@/components/purchasing/Price'
import { translations, type TranslationKey } from '@/i18n/translations'
import {
  COMPANY_PROFILE,
  companyProfileFacts,
  type CompanyProfile,
} from '@/lib/companyProfile'
import { formatDate } from '@/lib/dateFormat'
import { printIssuedAtLabel, quotationPageCss } from '@/lib/quotationPrint'
import {
  BORNE_BY_PRINT_KEYS,
  type QuotationCost,
  type QuotationLine,
  type QuotationRow,
  type QuotationTerm,
} from '@/lib/quotations'
import type { QuotationCompanyNumbers } from '@/lib/quotationsData'

/** If the browser never reports the dialog closed, the sheet leaves anyway. */
const AFTERPRINT_FALLBACK_MS = 120_000

export interface QuotationPrintSheetProps {
  quotation: QuotationRow
  lines: readonly QuotationLine[]
  costs: readonly QuotationCost[]
  terms: readonly QuotationTerm[]
  /** The client's numbers (null when not readable). */
  company: QuotationCompanyNumbers | null
  /** The client and the project in Arabic and English. */
  client: { ar: string; en: string | null }
  project: { ar: string; en: string | null } | null
  /** The company's own data of the footer (the one profile by default). */
  profile?: CompanyProfile
  /** The print dialog closed (or never opened): the sheet is unmounted. */
  onDone: () => void
}

/** The sheet is bilingual whatever the screen's language: every label in
 *  Arabic, then in English (the supplier PO sheet's rule). */
const ar = (key: TranslationKey) => translations.ar[key]
const en = (key: TranslationKey) => translations.en[key]

/** The English half of a label: smaller, muted, left to right. */
function En({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="text-[10px] font-normal text-muted">
      {children}
    </bdi>
  )
}

/** «عربي / English» on one line. */
function Inline({ k }: { k: TranslationKey }) {
  return (
    <>
      {ar(k)} <span className="text-border">/</span> <En>{en(k)}</En>
    </>
  )
}

/** The Arabic label with the English one under it. */
function Stacked({ k }: { k: TranslationKey }) {
  return (
    <>
      {ar(k)}
      <br />
      <En>{en(k)}</En>
    </>
  )
}

/**
 * «تصدير PDF» of a quotation (0199, owner 2026-11-16): the browser's print
 * dialog opens straight from the quotation page, exactly as the supplier PO
 * sheet does — portaled to `document.body` only while printing, hidden on
 * screen and the ONLY thing printed (`src/index.css`, «quotation print
 * sheet»; `print-export` forces the light tokens), the tab named after the
 * number while the dialog is up, unmounted on `afterprint`. Nothing is
 * fetched or stored.
 *
 * One bilingual A4 sheet: a three-part header (the full logo; «عرض سعر /
 * Quotation» with the project under it; the English facts — the number,
 * always printed since 0200 issues it at creation, the issue date and
 * «Valid Until»; nothing about a stage), the «مقدم العرض / From» and
 * «العميل / To» boxes, the prices table (a missing price reads «غير
 * مسعر»), the VAT line, the costs, the notes and the copied terms (Arabic,
 * the English under each).
 * 12 px text; no side or top page margin, the sheet's own padding instead.
 *
 * Trust pieces (owner 2026-11-17, «نبغى نضيف موثوقية اكثر لمستند الـ PDF»,
 * the quotation sheet only; no signature, stamp, QR or check code): the
 * sheet ends with the company's official data — only the fields of
 * `COMPANY_PROFILE` that hold a value — and the line «هذا المستند صادر
 * الكترونيا … ولا يحتاج توقيع او ختم» in Arabic then English; and EVERY
 * page carries, in its bottom margin, «صفحة 1 من 2 / Page 1 of 2» and the
 * Saudi time the file was issued (`quotationPageCss`: CSS page-margin
 * boxes, which also keep the browser's own header and footer off the page).
 */
export function QuotationPrintSheet({
  quotation,
  lines,
  costs,
  terms,
  company,
  client,
  project,
  profile = COMPANY_PROFILE,
  onDone,
}: QuotationPrintSheetProps) {
  const logoRef = useRef<HTMLImageElement>(null)
  const [logoSettled, setLogoSettled] = useState(false)
  const printed = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const number = quotation.quote_number
  // The time the file is issued: this print, fixed for all its pages.
  const [issuedAt] = useState(() => printIssuedAtLabel(new Date()))
  const companyFacts = companyProfileFacts(profile)
  const electronic = (text: string, company: string) =>
    text.replace('{company}', company)

  useEffect(() => {
    // Once per mount: the ref survives React's development double-mount.
    if (printed.current) return
    if (!logoSettled && !logoRef.current?.complete) return
    printed.current = true
    const previousTitle = document.title
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.removeEventListener('afterprint', finish)
      window.clearTimeout(fallback)
      document.title = previousTitle
      doneRef.current()
    }
    const fallback = window.setTimeout(finish, AFTERPRINT_FALLBACK_MS)
    window.addEventListener('afterprint', finish)
    // The suggested PDF file name is the number.
    document.title = number
    const fontsReady =
      typeof document.fonts?.ready?.then === 'function'
        ? document.fonts.ready
        : Promise.resolve()
    void fontsReady.then(() =>
      window.requestAnimationFrame(() => window.print()),
    )
    // No cleanup on purpose: once the print started, the listener and the
    // fallback belong to it and `finish` removes them. A cleanup here ran
    // when the logo's load event re-ran this effect after a cached logo had
    // already printed, and the next run returned early, so the sheet stayed
    // mounted with the number as the title. (React's development
    // double-mount would also tear them down if they were owned by a
    // mount-only effect.)
  }, [logoSettled, number])

  const headerFacts: { key: TranslationKey; value: string }[] = [
    { key: 'quotationPrintNumber', value: number },
    { key: 'quotationPrintIssueDate', value: formatDate(quotation.issue_date) },
    {
      key: 'quotationPrintValidUntil',
      value: formatDate(quotation.valid_until),
    },
  ]
  const cell = 'border px-2 py-1.5 align-top'
  const head = `${cell} bg-surface-hover font-semibold`
  const price = (value: QuotationLine['daily_price']) =>
    value === null || value === undefined || value === '' ? (
      <span className="text-muted">
        {ar('quotationPrintUnpriced')} <En>{en('quotationPrintUnpriced')}</En>
      </span>
    ) : (
      <Price value={value} />
    )

  return createPortal(
    <div
      className="quotation-print-sheet print-export hidden bg-bg text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      dir="rtl"
      lang="ar"
      aria-hidden="true"
    >
      {/* No side or top page margin: the sheet's own padding is the margin,
          repeated on every page. The bottom margin holds the page number
          and the issue time (margin boxes), so the browser adds no footer
          of its own. */}
      <style>{quotationPageCss(issuedAt)}</style>
      <div className="mx-auto max-w-[210mm] px-[10mm] pb-[2mm] pt-[12mm] text-[12px] leading-snug [-webkit-box-decoration-break:clone] [box-decoration-break:clone]">
        <header className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b pb-3">
          <img
            ref={logoRef}
            onLoad={() => setLogoSettled(true)}
            onError={() => setLogoSettled(true)}
            src="/azzanco-logo-full.png"
            alt=""
            className="h-[18mm] w-auto justify-self-start object-contain"
          />
          <div className="text-center">
            <h1 className="text-xl font-bold leading-tight">
              {ar('quotationPrintTitle')}
            </h1>
            <p className="text-sm font-semibold" dir="ltr">
              {en('quotationPrintTitle')}
            </p>
            {project && (
              <p className="mt-1">
                {project.ar}
                {project.en && project.en !== project.ar && (
                  <>
                    <br />
                    <En>{project.en}</En>
                  </>
                )}
              </p>
            )}
          </div>
          {/* The corner is English only, as on the PO sheet. */}
          <dl
            className="m-0 justify-self-end space-y-0.5 text-[11px]"
            dir="ltr"
          >
            {headerFacts.map((fact) => (
              <div key={fact.key} className="flex gap-1.5">
                <dt className="text-muted">{en(fact.key)}:</dt>
                <dd className="m-0 font-semibold">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        {/* «مقدم العرض» on the start side, the client on the other. */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">
              <Inline k="quotationPrintFrom" />
            </h2>
            <p className="font-semibold">
              <Stacked k="supplierPoPrintBuyerName" />
            </p>
          </section>
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">
              <Inline k="quotationPrintTo" />
            </h2>
            <p className="font-semibold">
              {client.ar}
              {client.en && client.en !== client.ar && (
                <>
                  <br />
                  <En>{client.en}</En>
                </>
              )}
            </p>
            {(
              [
                ['supplierPoPrintVatNumber', company?.tax_number],
                ['supplierPoPrintCrNumber', company?.commercial_register],
              ] as const
            ).map(([key, value]) =>
              value ? (
                <p key={key} className="mt-1 text-[11px]">
                  <span className="text-muted">
                    <Inline k={key} />:
                  </span>{' '}
                  <bdi dir="ltr" className="font-semibold">
                    {value}
                  </bdi>
                </p>
              ) : null,
            )}
          </section>
        </div>

        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '40%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead className="[display:table-header-group]">
            <tr>
              <th scope="col" className={`${head} text-start`}>
                #
              </th>
              <th scope="col" className={`${head} text-start`}>
                <Stacked k="quotationPrintDescription" />
              </th>
              {(
                [
                  'quotationPrintDaily',
                  'quotationPrintMonthly',
                  'quotationPrintMobDemob',
                ] as const
              ).map((key) => (
                <th key={key} scope="col" className={`${head} text-end`}>
                  <Stacked k={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id} className="break-inside-avoid even:bg-surface">
                <td className={`${cell} tabular-nums text-muted`}>
                  {index + 1}
                </td>
                <td className={`${cell} break-words`}>
                  <p className="font-semibold">{line.equipment_type}</p>
                  {line.note && (
                    <p className="text-[11px] text-muted">{line.note}</p>
                  )}
                </td>
                <td className={`${cell} text-end font-medium`}>
                  {price(line.daily_price)}
                </td>
                <td className={`${cell} text-end font-medium`}>
                  {price(line.monthly_price)}
                </td>
                <td className={`${cell} text-end font-medium`}>
                  {price(line.mob_demob_price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px]">
          {ar('quotationPrintVatLine')} <En>{en('quotationPrintVatLine')}</En>
        </p>

        {costs.length > 0 && (
          <section className="mt-4 break-inside-avoid">
            <h2 className="mb-1 font-semibold">
              <Inline k="quotationPrintCosts" />
            </h2>
            <table className="w-full max-w-[120mm] table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '65%' }} />
                <col style={{ width: '35%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={`${head} text-start`}>
                    <Stacked k="quotationPrintCost" />
                  </th>
                  <th scope="col" className={`${head} text-start`}>
                    <Stacked k="quotationPrintBorneBy" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {costs.map((cost) => (
                  <tr key={cost.id} className="even:bg-surface">
                    <td className={`${cell} break-words`}>{cost.name}</td>
                    <td className={cell}>
                      <Inline k={BORNE_BY_PRINT_KEYS[cost.borne_by]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {quotation.notes && (
          <section className="mt-4 break-inside-avoid">
            <h2 className="mb-1 font-semibold">
              <Inline k="quotationPrintNotes" />
            </h2>
            <p className="whitespace-pre-wrap break-words">{quotation.notes}</p>
          </section>
        )}

        {terms.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-1 font-semibold">
              <Inline k="quotationPrintTerms" />
            </h2>
            <ol className="m-0 list-none space-y-1.5 p-0">
              {terms.map((term, index) => (
                <li key={term.id} className="break-inside-avoid">
                  <p className="whitespace-pre-wrap">
                    <span className="tabular-nums">{index + 1}. </span>
                    {term.body_ar}
                  </p>
                  <p
                    dir="ltr"
                    className="whitespace-pre-wrap text-start text-[10px] text-muted"
                  >
                    {index + 1}. {term.body_en}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* The end of the sheet: the company's official data (only what is
            filled in) and the electronic-issue line. */}
        <footer className="mt-6 break-inside-avoid border-t pt-2 text-[10px] text-muted">
          {companyFacts.length > 0 && (
            <div className="mb-1.5">
              <p className="font-semibold text-fg">
                {profile.nameAr} <span className="text-border">/</span>{' '}
                <En>{profile.nameEn}</En>
              </p>
              <p className="flex flex-wrap gap-x-4 gap-y-0.5">
                {companyFacts.map((fact) => (
                  <span key={fact.key}>
                    <Inline k={fact.label} />:{' '}
                    <bdi dir={fact.dir} className="font-semibold text-fg">
                      {fact.value}
                    </bdi>
                  </span>
                ))}
              </p>
            </div>
          )}
          <p>{electronic(ar('quotationPrintElectronic'), profile.nameAr)}</p>
          <p dir="ltr" className="text-start">
            {electronic(en('quotationPrintElectronic'), profile.nameEn)}
          </p>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
