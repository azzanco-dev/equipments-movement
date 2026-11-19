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
import {
  printIssuedAtLabel,
  quotationCostNameEn,
  quotationHoursRows,
  quotationPageCss,
  quotationPrintDir,
  quotationWorkingHoursOf,
  type QuotationPrintVariant,
} from '@/lib/quotationPrint'
import {
  BORNE_BY_PRINT_KEYS,
  quotationAttentionOf,
  type QuotationCost,
  type QuotationLine,
  type QuotationRow,
  type QuotationTerm,
} from '@/lib/quotations'

/** If the browser never reports the dialog closed, the sheet leaves anyway. */
const AFTERPRINT_FALLBACK_MS = 120_000

type Lang = 'ar' | 'en'

export interface QuotationPrintSheetProps {
  /** Arabic only, English only, or both on one sheet. */
  variant: QuotationPrintVariant
  quotation: QuotationRow
  lines: readonly QuotationLine[]
  costs: readonly QuotationCost[]
  terms: readonly QuotationTerm[]
  /** The client in Arabic and English. */
  client: { ar: string; en: string | null }
  /** The company's own data of the header (the one profile by default). */
  profile?: CompanyProfile
  /** The print dialog closed (or never opened): the sheet is unmounted. */
  onDone: () => void
}

const word = (lang: Lang, key: TranslationKey) => translations[lang][key]

/** The English half of a mixed label: smaller, muted, left to right. */
function En({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="text-[10px] font-normal text-muted">
      {children}
    </bdi>
  )
}

/** A label on one line: the version's language, or «عربي / English». */
function Label({ v, k }: { v: QuotationPrintVariant; k: TranslationKey }) {
  if (v !== 'both') return <>{word(v, k)}</>
  return (
    <>
      {word('ar', k)} <span className="text-border">/</span>{' '}
      <En>{word('en', k)}</En>
    </>
  )
}

/** A table head: the version's language, or the Arabic label with the
 *  English one under it. */
function HeadLabel({ v, k }: { v: QuotationPrintVariant; k: TranslationKey }) {
  if (v !== 'both') return <>{word(v, k)}</>
  return (
    <>
      {word('ar', k)}
      <br />
      <En>{word('en', k)}</En>
    </>
  )
}

/** «label: value» of the small fact rows (the company, the quotation, the
 *  client's contact). A mixed «عربي / English» label takes no colon: after
 *  the English half it would land on the wrong side. */
function Fact({
  label,
  children,
  strong = false,
  colon = true,
}: {
  label: ReactNode
  children: ReactNode
  strong?: boolean
  colon?: boolean
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-muted">
        {label}
        {colon && ':'}
      </dt>
      <dd
        className={
          strong ? 'm-0 font-medium text-[var(--brand-charcoal)]' : 'm-0'
        }
      >
        {children}
      </dd>
    </div>
  )
}

const BRAND = 'text-[var(--brand-charcoal)]'
/** A cell of the three tables. */
const CELL = 'border px-2 py-1.5 align-middle'
/** A table head: the brand charcoal with white text; the English half of a
 *  mixed label a little dimmer. */
const HEAD = `${CELL} border-[var(--brand-charcoal)] bg-[var(--brand-charcoal)] font-medium text-bg [&_bdi]:text-bg [&_bdi]:opacity-80`
/** A table under its 3 px amber rule. */
const TABLE =
  'w-full table-fixed border-collapse border-t-[3px] border-t-[var(--brand-amber)]'
/** The title of a section. */
const SECTION_TITLE = `mb-1.5 font-medium ${BRAND}`

/**
 * «تصدير PDF» of a quotation: the browser's print dialog opens straight
 * from the quotation page, exactly as the supplier PO sheet does — portaled
 * to `document.body` only while printing, hidden on screen and the ONLY
 * thing printed (`src/index.css`, «quotation print sheet»; `print-export`
 * forces the light tokens), the tab named after the number while the dialog
 * is up, unmounted on `afterprint`. Nothing is fetched or stored.
 *
 * The sheet the owner approved in Figma on 2026-11-19 («تمام اعتمد الان»),
 * in THREE versions (`variant`): Arabic, English (left to right) and both.
 * Top to bottom, in the company's two brand colours (`--brand-amber`,
 * `--brand-charcoal`):
 *  1. the header — the company's own data at the start side (the name, then
 *     the fields of `COMPANY_PROFILE` that hold a value, one a line), the
 *     title over a short amber rule in the middle, the logo at the end side
 *     (so the logo is at the left of an Arabic sheet and at the right of the
 *     English one, «غير مكان اللوقو حسب اللغة»);
 *  2. the quotation's number and two dates on ONE line, then the client
 *     alone in a bordered box (a border, never a light fill: «الرمادي
 *     الخفيف مايظهر في الطباعة») with «عناية», the mobile and the email of
 *     its company record;
 *  3. the prices table (a missing price reads «غير مسعر») and the VAT line;
 *  4. «تكاليف اضافية» beside «ساعات العمل»;
 *  5. the notes and the copied terms (the mixed sheet: the Arabic list,
 *     then the English one);
 *  6. the line «هذا المستند صادر الكترونيا … ولا يحتاج توقيع او ختم».
 * No project, no «مقدم العرض» box. 12 px text; no side or top page margin,
 * the sheet's own padding instead. EVERY page carries, in its bottom
 * margin, the page number and the Saudi time the file was issued
 * (`quotationPageCss`: CSS page-margin boxes, which also keep the browser's
 * own header and footer off the page). No signature, stamp or QR.
 */
export function QuotationPrintSheet({
  variant,
  quotation,
  lines,
  costs,
  terms,
  client,
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
  const both = variant === 'both'
  /** The language of a one-language sheet; Arabic leads the mixed one. */
  const main: Lang = variant === 'en' ? 'en' : 'ar'
  const dir = quotationPrintDir(variant)
  const electronic = (lang: Lang) =>
    word(lang, 'quotationPrintElectronic').replace(
      '{company}',
      lang === 'ar' ? profile.nameAr : profile.nameEn,
    )

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

  const quoteFacts: { key: TranslationKey; value: string }[] = [
    { key: 'quotationPrintNumber', value: number },
    { key: 'quotationPrintIssueDate', value: formatDate(quotation.issue_date) },
    {
      key: 'quotationPrintValidUntil',
      value: formatDate(quotation.valid_until),
    },
  ]
  // The client's name: its English one on the English sheet when it has
  // one, and under the Arabic one on the mixed sheet.
  const clientEn = client.en && client.en !== client.ar ? client.en : null
  const clientName = main === 'en' ? (clientEn ?? client.ar) : client.ar
  // «عناية»: the quotation's own copy of a responsible person (0204), each
  // value only when it holds one; and the quotation's working hours.
  const attention = quotationAttentionOf(quotation)
  const clientContact = (
    [
      ['quotationPrintAttention', attention?.name, 'auto'],
      ['quotationPrintMobile', attention?.contact_number, 'ltr'],
      ['quotationPrintEmail', attention?.email, 'ltr'],
    ] as const
  ).filter(([, value]) => (value ?? '').trim() !== '')
  const hours = quotationWorkingHoursOf(quotation)
  const price = (value: QuotationLine['daily_price']) =>
    value === null || value === undefined || value === '' ? (
      <span className="text-muted">
        {word(main, 'quotationPrintUnpriced')}
        {both && (
          <>
            {' '}
            <En>{word('en', 'quotationPrintUnpriced')}</En>
          </>
        )}
      </span>
    ) : (
      // The riyal sign stays at the left of the amount on every version.
      <span dir="rtl" className="inline-block">
        <Price value={value} />
      </span>
    )
  /** A cost's name: its English one on the English sheet when it is one of
   *  the default costs, and beside the Arabic one on the mixed sheet. */
  const costName = (name: string) => {
    const english = quotationCostNameEn(name)
    if (!english) return name
    if (variant === 'en') return english
    if (!both) return name
    return (
      <>
        {name} <span className="text-border">/</span> <En>{english}</En>
      </>
    )
  }
  const termLists: Lang[] = both ? ['ar', 'en'] : [main]

  return createPortal(
    <div
      className="quotation-print-sheet print-export hidden bg-bg text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      dir={dir}
      lang={main}
      aria-hidden="true"
    >
      {/* No side or top page margin: the sheet's own padding is the margin,
          repeated on every page. The bottom margin holds the page number
          and the issue time (margin boxes), so the browser adds no footer
          of its own. */}
      <style>{quotationPageCss(issuedAt, variant)}</style>
      <div className="mx-auto max-w-[210mm] px-[10mm] pb-[2mm] pt-[12mm] text-[12px] leading-[17px] [-webkit-box-decoration-break:clone] [box-decoration-break:clone]">
        {/* 1. The company's data, the title, the logo. */}
        <header className="mb-[18px] grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          <div className="min-w-0 max-w-[74mm] justify-self-start text-[11px] leading-[15px]">
            <p className={`text-[12px] font-medium leading-[17px] ${BRAND}`}>
              {main === 'en' ? profile.nameEn : profile.nameAr}
            </p>
            {both && (
              <p dir="ltr" className="text-end text-muted">
                {profile.nameEn}
              </p>
            )}
            {companyFacts.length > 0 && (
              <dl className="m-0 mt-0.5 space-y-0.5">
                {companyFacts.map((fact) => (
                  <div key={fact.key}>
                    <Fact
                      label={<Label v={variant} k={fact.label} />}
                      colon={!both}
                    >
                      <bdi dir={fact.dir}>
                        {main === 'en' ? fact.valueEn : fact.value}
                      </bdi>
                    </Fact>
                    {both && fact.valueEn !== fact.value && (
                      <p dir="ltr" className="text-end text-[10px] text-muted">
                        {fact.valueEn}
                      </p>
                    )}
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="flex flex-col items-center">
            <h1
              className={`text-[30px] font-bold leading-[38px] ${BRAND} ${
                main === 'en' ? '[font-family:var(--font-latin)]' : ''
              }`}
            >
              {word(main, 'quotationPrintTitle')}
            </h1>
            {both && (
              <p dir="ltr" className="text-[18px] leading-6">
                {word('en', 'quotationPrintTitle')}
              </p>
            )}
            <span
              aria-hidden="true"
              className="my-1.5 block h-1 w-14 rounded-sm bg-[var(--brand-amber)]"
            />
          </div>
          <img
            ref={logoRef}
            onLoad={() => setLogoSettled(true)}
            onError={() => setLogoSettled(true)}
            src="/azzanco-logo-full.png"
            alt=""
            className="h-[18mm] w-auto justify-self-end object-contain"
          />
        </header>

        {/* 2. The quotation's facts on one line (English on the mixed
            sheet, so at the left), then the client alone in its box. */}
        <dl
          className="m-0 mb-2 flex flex-wrap gap-x-6 gap-y-0.5 text-[11px] leading-[15px]"
          dir={both ? 'ltr' : undefined}
        >
          {quoteFacts.map((fact) => (
            <Fact
              key={fact.key}
              label={word(both ? 'en' : main, fact.key)}
              strong
            >
              <bdi dir="ltr">{fact.value}</bdi>
            </Fact>
          ))}
        </dl>
        <section className="mb-[18px] break-inside-avoid rounded-md border border-[color-mix(in_srgb,var(--brand-charcoal)_35%,transparent)] p-3">
          <h2 className="text-[11px] font-normal leading-[15px] text-muted">
            <Label v={variant} k="quotationPrintTo" />
          </h2>
          <p className={`font-medium ${BRAND}`}>{clientName}</p>
          {both && clientEn && (
            <p dir="ltr" className="text-end text-[11px] text-muted">
              {clientEn}
            </p>
          )}
          {clientContact.length > 0 && (
            <dl className="m-0 mt-1.5 flex flex-wrap gap-x-6 gap-y-0.5 text-[11px] leading-[15px]">
              {clientContact.map(([key, value, valueDir]) => (
                <Fact
                  key={key}
                  label={<Label v={variant} k={key} />}
                  colon={!both}
                >
                  <bdi dir={valueDir}>{value}</bdi>
                </Fact>
              ))}
            </dl>
          )}
        </section>

        {/* 3. The prices by equipment type. */}
        <table className={TABLE}>
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '40%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead className="[display:table-header-group]">
            <tr>
              <th scope="col" className={`${HEAD} text-start`}>
                #
              </th>
              <th scope="col" className={`${HEAD} text-start`}>
                <HeadLabel v={variant} k="quotationPrintDescription" />
              </th>
              {(
                [
                  'quotationPrintDaily',
                  'quotationPrintMonthly',
                  'quotationPrintMobDemob',
                ] as const
              ).map((key) => (
                <th key={key} scope="col" className={`${HEAD} text-center`}>
                  <HeadLabel v={variant} k={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id} className="break-inside-avoid even:bg-surface">
                <td className={`${CELL} tabular-nums text-muted`}>
                  {index + 1}
                </td>
                <td className={`${CELL} break-words`}>
                  <p className="font-medium">{line.equipment_type}</p>
                  {line.note && (
                    <p className="text-[11px] text-muted">{line.note}</p>
                  )}
                </td>
                <td className={`${CELL} text-center`}>
                  {price(line.daily_price)}
                </td>
                <td className={`${CELL} text-center`}>
                  {price(line.monthly_price)}
                </td>
                <td className={`${CELL} text-center`}>
                  {price(line.mob_demob_price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] leading-[15px] text-muted">
          {word(main, 'quotationPrintVatLine')}
          {both && (
            <>
              {' '}
              <En>{word('en', 'quotationPrintVatLine')}</En>
            </>
          )}
        </p>

        {/* 4. «تكاليف اضافية» at the start side, «ساعات العمل» beside it. */}
        <div className="mt-[18px] grid grid-cols-2 items-start gap-4">
          {costs.length > 0 && (
            <section className="break-inside-avoid">
              <h2 className={SECTION_TITLE}>
                <Label v={variant} k="quotationPrintCosts" />
              </h2>
              <table className={TABLE}>
                <colgroup>
                  <col style={{ width: '68%' }} />
                  <col style={{ width: '32%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className={`${HEAD} text-start`}>
                      <HeadLabel v={variant} k="quotationPrintCost" />
                    </th>
                    <th scope="col" className={`${HEAD} text-start`}>
                      <HeadLabel v={variant} k="quotationPrintBorneBy" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map((cost) => (
                    <tr key={cost.id} className="even:bg-surface">
                      <td className={`${CELL} break-words`}>
                        {costName(cost.name)}
                      </td>
                      <td className={CELL}>
                        <Label
                          v={variant}
                          k={BORNE_BY_PRINT_KEYS[cost.borne_by]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <section className="break-inside-avoid">
            <h2 className={SECTION_TITLE}>
              <Label v={variant} k="quotationPrintHours" />
            </h2>
            <table className={TABLE}>
              <colgroup>
                <col style={{ width: '77%' }} />
                <col style={{ width: '23%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={`${HEAD} text-start`}>
                    <HeadLabel v={variant} k="quotationPrintHoursItem" />
                  </th>
                  <th scope="col" className={`${HEAD} text-center`}>
                    <HeadLabel v={variant} k="quotationPrintHoursCount" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {quotationHoursRows(hours).map((row) => (
                  <tr key={row.key} className="even:bg-surface">
                    <td className={CELL}>
                      <Label v={variant} k={row.key} />
                    </td>
                    <td
                      className={`${CELL} text-center font-medium tabular-nums`}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {quotation.notes && (
          <section className="mt-[18px] break-inside-avoid">
            <h2 className={SECTION_TITLE}>
              <Label v={variant} k="quotationPrintNotes" />
            </h2>
            <p className="whitespace-pre-wrap break-words">{quotation.notes}</p>
          </section>
        )}

        {/* 5. The terms in the version's language; the mixed sheet prints
            the Arabic list alone, then the English list under it (owner
            2026-11-17, «خلي الشروط العربية لحالها, وتحتها الشروط
            الانجليزية»). */}
        {terms.length > 0 &&
          termLists.map((lang, listIndex) => (
            <section
              key={lang}
              className={`${listIndex === 0 ? 'mt-[18px]' : 'mt-3'} text-start`}
              dir={lang === 'en' ? 'ltr' : 'rtl'}
              lang={lang}
            >
              <h2 className={SECTION_TITLE}>
                {word(lang, 'quotationPrintTerms')}
              </h2>
              <ol className="m-0 list-none space-y-1 p-0">
                {terms.map((term, index) => (
                  <li
                    key={term.id}
                    className="break-inside-avoid whitespace-pre-wrap"
                  >
                    <span className="tabular-nums">{index + 1}. </span>
                    {lang === 'en' ? term.body_en : term.body_ar}
                  </li>
                ))}
              </ol>
            </section>
          ))}

        {/* 6. The electronic-issue line closes the sheet. */}
        <footer className="mt-[18px] break-inside-avoid border-t pt-2 text-[10px] leading-[14px] text-muted">
          {(both ? (['ar', 'en'] as const) : [main]).map((lang) => (
            <p
              key={lang}
              dir={lang === 'en' ? 'ltr' : 'rtl'}
              className="text-start"
            >
              {electronic(lang)}
            </p>
          ))}
        </footer>
      </div>
    </div>,
    document.body,
  )
}
