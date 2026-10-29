import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Price, PricesByUnit } from '@/components/purchasing/Price'
import { translations, type TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import { splitPlateForDisplay } from '@/lib/plate'
import { formatSaudiDateTime } from '@/lib/printExport'
import {
  SUPPLIER_PO_RATE_UNIT_LABEL_KEYS,
  SUPPLIER_PO_TERMS_KEYS,
  SUPPLIER_PO_VAT_RATE,
  supplierPoRateUnitOf,
  supplierPoSupplierNames,
  supplierPoTotalsByUnit,
  vatOf,
  withVat,
} from '@/lib/purchasing'
import type {
  PurchasingUnit,
  SupplierPoLineRow,
  SupplierPoRow,
} from '@/lib/purchasingData'
import { saudiDateKey } from '@/lib/saudiTime'

/** If the browser never reports the dialog closed, the sheet leaves anyway. */
const AFTERPRINT_FALLBACK_MS = 120_000

export interface SupplierPoPrintSheetProps {
  po: SupplierPoRow
  /** The lines in the order the page shows them. */
  lines: readonly SupplierPoLineRow[]
  project: string
  /** 0160: the approver's name (an approved PO). */
  approvedBy?: string
  /** The print dialog closed (or never opened): the sheet is unmounted. */
  onDone: () => void
}

/** The sheet is bilingual whatever the screen's language (owner
 *  2026-10-29): every label in Arabic, then in English. */
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
function Stacked({ k, text }: { k?: TranslationKey; text?: [string, string] }) {
  const [arabic, english] = text ?? [ar(k!), en(k!)]
  return (
    <>
      {arabic}
      <br />
      <En>{english}</En>
    </>
  )
}

/** The plate as «1128 XVV» (digits, then the letters), else the chassis. */
function plateOrChassis(unit: PurchasingUnit): string | null {
  const plate = unit.plate_number?.trim()
  if (plate) {
    const parts = splitPlateForDisplay(plate)
    return parts ? `${parts.digits} ${parts.letters}` : plate
  }
  return unit.chassis_number?.trim() || null
}

/**
 * «تصدير PDF» of a supplier PO (owner 2026-10-22: the browser's print
 * dialog opens straight from the PO page — no tab, no page of the site).
 *
 * Mounted only while exporting: a sheet portaled to `document.body`, hidden
 * on screen and the ONLY thing printed (`src/index.css`, «PO print sheet»:
 * every other child of body is hidden for print while the sheet exists, and
 * the `print-export` class forces the light tokens). Once the logo and the
 * fonts are ready it calls `window.print()`, names the PDF after the PO
 * number and the day, and unmounts on `afterprint`. The page's own data is
 * the content; nothing is fetched or stored.
 *
 * The layout is version 4 of the owner's PDF reviews (approved 2026-10-29,
 * «خلاص اعتمد»): bilingual on one page — every label Arabic, then English —;
 * a header of three parts (the logo alone; «امر شراء / Purchase Order» with
 * the project under it; the PO number, the issue date and the state, a
 * draft reading «مسودة / Draft», also in the file name); the buyer
 * (العزاني) and the supplier boxes side by side; the lines as # · «وصف
 * المعدة» (code with the plate or chassis beside it, the type under them) ·
 * «تاريخ البداية» · «الوحدة» · price; the totals in a box joined to their
 * amounts by a light line («الاجمالي قبل الضريبة», the VAT with its rate,
 * «الاجمالي»); then the terms in Arabic with their English under them. Text
 * is 12 px except the title. No browser header or footer: the page has no
 * margin and the sheet carries its own padding.
 */
export function SupplierPoPrintSheet({
  po,
  lines,
  project,
  approvedBy,
  onDone,
}: SupplierPoPrintSheetProps) {
  const logoRef = useRef<HTMLImageElement>(null)
  const [logoSettled, setLogoSettled] = useState(false)
  const printed = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const poNumber = po.po_number
  const draft = po.approval_status !== 'approved'
  // The party in Arabic and, when it has one, English (0164).
  const supplier = supplierPoSupplierNames(po, ar, en)

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
    // The suggested PDF file name: the PO number, «مسودة» for a draft, and
    // the day.
    document.title = [
      poNumber,
      draft ? ar('supplierPoApprovalDraft') : null,
      saudiDateKey(new Date().toISOString()),
    ]
      .filter(Boolean)
      .join(' ')
    const fontsReady =
      typeof document.fonts?.ready?.then === 'function'
        ? document.fonts.ready
        : Promise.resolve()
    void fontsReady.then(() =>
      window.requestAnimationFrame(() => window.print()),
    )
    return () => {
      window.removeEventListener('afterprint', finish)
      window.clearTimeout(fallback)
    }
  }, [logoSettled, poNumber, draft])

  // 0157: one total per price unit (a month and a day are never added).
  const { parts: totals, unpriced } = supplierPoTotalsByUnit(lines)
  // The unit column says the unit; the totals name it only when a PO mixes
  // monthly and daily prices.
  const mixedUnits = totals.length > 1
  const stateKeys: TranslationKey[] = [
    draft ? 'supplierPoApprovalDraft' : 'supplierPoApprovalApproved',
    ...(po.status === 'closed' ? (['supplierPoStatusClosed'] as const) : []),
  ]
  const headerFacts: { key: TranslationKey; value: ReactNode }[] = [
    { key: 'supplierPoNumber', value: <bdi dir="ltr">{po.po_number}</bdi> },
    {
      key: 'supplierPoPrintIssueDate',
      value: <bdi dir="ltr">{formatDate(saudiDateKey(new Date().toISOString()))}</bdi>,
    },
    {
      key: 'supplierPoPrintStatus',
      value: stateKeys.map((key, index) => (
        <span key={key}>
          {index > 0 && ' · '}
          <Inline k={key} />
        </span>
      )),
    },
  ]
  // Under the parties: the PO's start, its approval and its closing.
  const facts: { key: TranslationKey; value: ReactNode }[] = [
    { key: 'supplierPoStartDate', value: <bdi dir="ltr">{formatDate(po.start_date)}</bdi> },
    ...(po.approved_at
      ? [
          {
            key: 'supplierPoApprovedAt' as const,
            value: <bdi dir="ltr">{formatSaudiDateTime(po.approved_at)}</bdi>,
          },
          { key: 'supplierPoApprovedBy' as const, value: approvedBy ?? '—' },
        ]
      : []),
    ...(po.closed_at
      ? [
          {
            key: 'supplierPoClosedAt' as const,
            value: <bdi dir="ltr">{formatSaudiDateTime(po.closed_at)}</bdi>,
          },
        ]
      : []),
  ]
  // The day the rent starts; an ended card adds its last day (no «مفتوح»).
  const startOf = (line: SupplierPoLineRow) => {
    if (!line.card) return '—'
    const from = formatDate(line.card.period_from)
    return line.card.period_to
      ? `${from} – ${formatDate(line.card.period_to)}`
      : from
  }
  const cell = 'border px-2 py-1.5 align-top'
  const rate = String(Math.round(SUPPLIER_PO_VAT_RATE * 100))
  const vatLabel: [string, string] = [
    ar('supplierPoPrintVat').replace('{rate}', rate),
    en('supplierPoPrintVat').replace('{rate}', rate),
  ]
  /** A totals row: the label, a light line, the amount. */
  const totalRow = (
    label: ReactNode,
    amount: ReactNode,
    className = '',
  ) => (
    <div className={`flex items-center gap-3 ${className}`}>
      <dt className="leading-tight">{label}</dt>
      <span aria-hidden="true" className="min-w-3 flex-1 border-b" />
      <dd className="m-0">{amount}</dd>
    </div>
  )

  return createPortal(
    <div
      className="po-print-sheet print-export hidden bg-bg text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      dir="rtl"
      lang="ar"
      aria-hidden="true"
    >
      {/* No page margin, so the browser prints no header (date, title) or
          footer (the link); the sheet's own padding is the margin, repeated
          on every page through box-decoration-break. */}
      <style>{'@page { size: A4 portrait; margin: 0; }'}</style>
      <div className="mx-auto max-w-[210mm] px-[10mm] py-[12mm] text-[12px] leading-snug [-webkit-box-decoration-break:clone] [box-decoration-break:clone]">
        <header className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b pb-3">
          <img
            ref={logoRef}
            onLoad={() => setLogoSettled(true)}
            onError={() => setLogoSettled(true)}
            src="/azzanco-logo.png"
            alt=""
            className="h-16 w-16 object-contain"
          />
          <div className="text-center">
            <h1 className="text-xl font-bold leading-tight">
              {ar('supplierPoPrintTitleAr')}
            </h1>
            <p className="text-sm font-semibold" dir="ltr">
              {en('supplierPoPrintTitleEn')}
            </p>
            <p className="mt-1">{project}</p>
          </div>
          <dl className="m-0 justify-self-end space-y-0.5 text-[11px]">
            {headerFacts.map((fact) => (
              <div key={fact.key} className="flex justify-end gap-1.5">
                <dt className="text-muted">
                  <Inline k={fact.key} />:
                </dt>
                <dd className="m-0 font-semibold">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        {/* The buyer on the start side (right), the supplier on the other. */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">
              <Inline k="supplierPoPrintBuyer" />
            </h2>
            <p className="font-semibold">
              <Stacked k="supplierPoPrintBuyerName" />
            </p>
          </section>
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">
              <Inline k="supplierPoSupplier" />
            </h2>
            <p className="font-semibold">
              {supplier.ar}
              {supplier.en && (
                <>
                  <br />
                  <En>{supplier.en}</En>
                </>
              )}
            </p>
          </section>
        </div>

        <dl className="mb-4 grid grid-cols-3 gap-x-6 gap-y-1.5">
          {facts.map((fact) => (
            <div key={fact.key} className="min-w-0">
              <dt className="text-[11px] text-muted">
                <Inline k={fact.key} />
              </dt>
              <dd className="m-0 break-words font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>

        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '40%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead className="[display:table-header-group]">
            <tr>
              <th scope="col" className={`${cell} bg-surface-hover text-start font-semibold`}>
                #
              </th>
              {(
                [
                  'supplierPoPrintUnitDescription',
                  'supplierPoStartDate',
                  'supplierPoPrintUnit',
                  'supplierPoPrice',
                ] as const
              ).map((key) => (
                <th
                  key={key}
                  scope="col"
                  className={`${cell} bg-surface-hover font-semibold ${key === 'supplierPoPrice' ? 'text-end' : 'text-start'}`}
                >
                  <Stacked k={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const unit = line.card?.equipment ?? null
              const identifier = unit ? plateOrChassis(unit) : null
              const unitKey = SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[supplierPoRateUnitOf(line.rate_unit)]
              return (
                <tr key={line.id} className="break-inside-avoid even:bg-surface">
                  <td className={`${cell} tabular-nums text-muted`}>{index + 1}</td>
                  <td className={`${cell} break-words`}>
                    {/* The code with the plate (or chassis) beside it, the
                        type under them. */}
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <bdi dir="ltr" className="font-semibold">
                        {unit?.code ?? '—'}
                      </bdi>
                      {identifier && (
                        <bdi dir="ltr" className="text-muted">
                          {identifier}
                        </bdi>
                      )}
                    </p>
                    {unit?.type && (
                      <p className="text-[11px] text-muted">{unit.type}</p>
                    )}
                  </td>
                  <td className={cell}>
                    <bdi dir="ltr">{startOf(line)}</bdi>
                  </td>
                  <td className={cell}>
                    <Stacked k={unitKey} />
                  </td>
                  <td className={`${cell} text-end font-medium`}>
                    {line.price === null ? (
                      <span className="text-muted">
                        <Stacked k="supplierPoNoPrice" />
                      </span>
                    ) : (
                      <Price value={line.price} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* The totals in their own box, at the end side. */}
        <div className="mt-3 flex break-inside-avoid justify-end">
          <dl className="m-0 w-full max-w-[80mm] space-y-2 rounded border p-3">
            {totalRow(
              <Stacked k="supplierPoPrintBeforeVat" />,
              <span className="font-semibold">
                <PricesByUnit parts={totals} alignEnd showUnit={mixedUnits} />
              </span>,
            )}
            {totalRow(
              <Stacked text={vatLabel} />,
              <span className="font-medium">
                <PricesByUnit parts={totals} amount={vatOf} alignEnd showUnit={mixedUnits} />
              </span>,
            )}
            {totalRow(
              <span className="font-semibold">
                <Stacked k="supplierPoPrintTotal" />
              </span>,
              <span className="font-bold">
                <PricesByUnit parts={totals} amount={withVat} alignEnd showUnit={mixedUnits} />
              </span>,
              'border-t pt-2',
            )}
            {unpriced > 0 && (
              <p className="text-[11px] text-muted">
                {unpriced} {ar('supplierPoUnpricedTotalNote')}{' '}
                <En>
                  {unpriced} {en('supplierPoUnpricedTotalNote')}
                </En>
              </p>
            )}
          </dl>
        </div>

        {po.notes && (
          <section className="mt-4 break-inside-avoid">
            <h2 className="mb-1 font-semibold">
              <Inline k="notes" />
            </h2>
            <p className="whitespace-pre-wrap break-words">{po.notes}</p>
          </section>
        )}

        {/* «الشروط والاحكام»: the Arabic terms, their English under them. */}
        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-1 font-semibold">
            <Inline k="supplierPoTermsTitle" />
          </h2>
          <ol className="m-0 list-decimal space-y-0.5 ps-5">
            {SUPPLIER_PO_TERMS_KEYS.map((key) => (
              <li key={key}>{ar(key)}</li>
            ))}
          </ol>
          <ol
            dir="ltr"
            className="m-0 mt-1.5 list-decimal space-y-px ps-[18px] text-start text-[10px] text-muted"
          >
            {SUPPLIER_PO_TERMS_KEYS.map((key) => (
              <li key={key}>{en(key)}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>,
    document.body,
  )
}
