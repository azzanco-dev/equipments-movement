import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Price, PricesByUnit } from '@/components/purchasing/Price'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { splitPlateForDisplay } from '@/lib/plate'
import { formatSaudiDateTime } from '@/lib/printExport'
import {
  SUPPLIER_PO_RATE_UNIT_LABEL_KEYS,
  SUPPLIER_PO_TERMS_KEYS,
  SUPPLIER_PO_VAT_RATE,
  supplierPoRateUnitOf,
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
  supplier: string
  project: string
  /** 0160: the approver's name (an approved PO). */
  approvedBy?: string
  /** The print dialog closed (or never opened): the sheet is unmounted. */
  onDone: () => void
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
 * The layout is the owner's (2026-10-29, two reviews): a header of three
 * parts — the logo alone on the start side, «امر شراء / Purchase Order» with
 * the project under it in the middle, and on the end side the PO number, the
 * issue date and the PO's state (a draft reads «مسودة - غير معتمد», also in
 * the file name; an approved PO «معتمد»); the buyer (Al-Azani) and the
 * supplier boxes side by side; the lines as # · «وصف المعدة» (code with the
 * plate or chassis beside it, the type under them) · «تاريخ البداية» ·
 * «الوحدة» · price; the totals in a box («قبل الضريبة», the VAT with its
 * rate, «الاجمالي»); then the terms. No browser header or footer: the page
 * has no margin and the sheet carries its own padding.
 */
export function SupplierPoPrintSheet({
  po,
  lines,
  supplier,
  project,
  approvedBy,
  onDone,
}: SupplierPoPrintSheetProps) {
  const { t, lang } = useI18n()
  const logoRef = useRef<HTMLImageElement>(null)
  const [logoSettled, setLogoSettled] = useState(false)
  const printed = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const poNumber = po.po_number
  const draft = po.approval_status !== 'approved'
  const draftMark = t('supplierPoDraftWatermark')

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
      draft ? draftMark : null,
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
  }, [logoSettled, poNumber, draft, draftMark])

  // 0157: one total per price unit (a month and a day are never added).
  const { parts: totals, unpriced } = supplierPoTotalsByUnit(lines)
  // The unit column says the unit; the totals name it only when a PO mixes
  // monthly and daily prices.
  const mixedUnits = totals.length > 1
  // The PO's state on the end side of the header.
  const state = [
    draft ? draftMark : t('supplierPoApprovalApproved'),
    po.status === 'closed' ? t('supplierPoStatusClosed') : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const headerFacts: { label: string; value: string; ltr?: boolean }[] = [
    { label: t('supplierPoNumber'), value: po.po_number, ltr: true },
    {
      label: t('supplierPoPrintIssueDate'),
      value: formatDate(saudiDateKey(new Date().toISOString())),
      ltr: true,
    },
    { label: t('supplierPoPrintStatus'), value: state },
  ]
  // Under the parties: the PO's start, its approval and its closing.
  const facts: { label: string; value: string; ltr?: boolean }[] = [
    { label: t('supplierPoStartDate'), value: formatDate(po.start_date), ltr: true },
    ...(po.approved_at
      ? [
          {
            label: t('supplierPoApprovedAt'),
            value: formatSaudiDateTime(po.approved_at),
            ltr: true,
          },
          { label: t('supplierPoApprovedBy'), value: approvedBy ?? '—' },
        ]
      : []),
    ...(po.closed_at
      ? [
          {
            label: t('supplierPoClosedAt'),
            value: formatSaudiDateTime(po.closed_at),
            ltr: true,
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
  const vatLabel = t('supplierPoPrintVat').replace(
    '{rate}',
    String(Math.round(SUPPLIER_PO_VAT_RATE * 100)),
  )

  return createPortal(
    <div
      className="po-print-sheet print-export hidden bg-bg text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
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
              {t('supplierPoPrintTitleAr')}
            </h1>
            <p className="text-sm font-semibold" dir="ltr">
              {t('supplierPoPrintTitleEn')}
            </p>
            <p className="mt-1 text-sm">{project}</p>
          </div>
          <dl className="m-0 justify-self-end space-y-0.5 text-[11px]">
            {headerFacts.map((fact) => (
              <div key={fact.label} className="flex justify-end gap-1.5">
                <dt className="text-muted">{fact.label}:</dt>
                <dd className="m-0 font-semibold">
                  {fact.ltr ? <bdi dir="ltr">{fact.value}</bdi> : fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        {/* Owner 2026-10-29: the buyer on the start side (right in Arabic),
            the supplier on the other. */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">{t('supplierPoPrintBuyer')}</h2>
            <p className="text-sm font-semibold">{t('supplierPoPrintBuyerName')}</p>
          </section>
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">{t('supplierPoSupplier')}</h2>
            <p className="text-sm font-semibold">{supplier}</p>
          </section>
        </div>

        <dl className="mb-4 grid grid-cols-3 gap-x-6 gap-y-1.5">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[11px] text-muted">{fact.label}</dt>
              <dd className="m-0 break-words font-medium">
                {fact.ltr ? <bdi dir="ltr">{fact.value}</bdi> : fact.value}
              </dd>
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
              {[
                '#',
                t('supplierPoPrintUnitDescription'),
                t('supplierPoStartDate'),
                t('supplierPoPrintUnit'),
                t('supplierPoPrice'),
              ].map((header, index) => (
                <th
                  key={index}
                  scope="col"
                  className={`${cell} bg-surface-hover font-semibold ${index === 4 ? 'text-end' : 'text-start'}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const unit = line.card?.equipment ?? null
              const identifier = unit ? plateOrChassis(unit) : null
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
                    {t(SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[supplierPoRateUnitOf(line.rate_unit)])}
                  </td>
                  <td className={`${cell} text-end font-medium`}>
                    {line.price === null ? (
                      <span className="text-muted">{t('supplierPoNoPrice')}</span>
                    ) : (
                      <Price value={line.price} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* The totals in their own box, at the end side (owner 2026-10-29). */}
        <div className="mt-3 flex break-inside-avoid justify-end">
          <dl className="m-0 w-full max-w-[80mm] space-y-1.5 rounded border p-3">
            <div className="flex items-center justify-between gap-3">
              <dt>{t('supplierPoPrintBeforeVat')}</dt>
              <dd className="m-0 font-semibold">
                <PricesByUnit parts={totals} alignEnd showUnit={mixedUnits} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>{vatLabel}</dt>
              <dd className="m-0 font-medium">
                <PricesByUnit
                  parts={totals}
                  amount={vatOf}
                  alignEnd
                  showUnit={mixedUnits}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-1.5 text-sm">
              <dt className="font-semibold">{t('supplierPoPrintTotal')}</dt>
              <dd className="m-0 font-bold">
                <PricesByUnit
                  parts={totals}
                  amount={withVat}
                  alignEnd
                  showUnit={mixedUnits}
                />
              </dd>
            </div>
            {unpriced > 0 && (
              <p className="text-[11px] text-muted">
                {unpriced} {t('supplierPoUnpricedTotalNote')}
              </p>
            )}
          </dl>
        </div>

        {po.notes && (
          <section className="mt-4 break-inside-avoid">
            <h2 className="mb-1 text-sm font-semibold">{t('notes')}</h2>
            <p className="whitespace-pre-wrap break-words">{po.notes}</p>
          </section>
        )}

        {/* «الشروط والاحكام» under the table (owner 2026-10-29). */}
        <section className="mt-4 break-inside-avoid">
          <h2 className="mb-1 text-sm font-semibold">{t('supplierPoTermsTitle')}</h2>
          <ol className="m-0 list-decimal space-y-0.5 ps-5">
            {SUPPLIER_PO_TERMS_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>,
    document.body,
  )
}
