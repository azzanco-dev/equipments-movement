import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Price, PricesByUnit } from '@/components/purchasing/Price'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { formatSaudiDateTime } from '@/lib/printExport'
import {
  SUPPLIER_PO_RATE_UNIT_LABEL_KEYS,
  supplierPoRateUnitOf,
  supplierPoTotalsByUnit,
  vatOf,
  withVat,
} from '@/lib/purchasing'
import type { SupplierPoLineRow, SupplierPoRow } from '@/lib/purchasingData'
import { saudiDateKey } from '@/lib/saudiTime'

/** If the browser never reports the dialog closed, the sheet leaves anyway. */
const AFTERPRINT_FALLBACK_MS = 120_000

export interface SupplierPoPrintSheetProps {
  po: SupplierPoRow
  /** The lines in the order the page shows them. */
  lines: readonly SupplierPoLineRow[]
  supplier: string
  project: string
  /** 0160: the approver's name (the PDF exists for an approved PO only). */
  approvedBy?: string
  /** The print dialog closed (or never opened): the sheet is unmounted. */
  onDone: () => void
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
 * the content; nothing is fetched or stored. Owner 2026-10-29: a DRAFT
 * (0160) exports too, marked «مسودة - غير معتمد» in the header and the file
 * name; an approved PO prints clean. Owner's review of the sheet the same
 * day: the buyer (Al-Azani, with the project only) on the start side and
 * the supplier on the other, no creator / creation time / issue time, no
 * status badge or watermark, the lines as unit · rent start · price unit ·
 * price (no note column, no «مفتوح», no «/ شهر»), and no browser header or
 * footer (the page has no margin; the sheet carries its own padding).
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
  // Owner 2026-10-29: no creator, creation time or company here; the
  // project sits in the buyer's box.
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
  const rentStartOf = (line: SupplierPoLineRow) => {
    if (!line.card) return '—'
    const from = formatDate(line.card.period_from)
    return line.card.period_to
      ? `${from} – ${formatDate(line.card.period_to)}`
      : from
  }
  const cell = 'border px-2 py-1.5 align-top'

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
        <header className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
          <div className="flex items-start gap-3">
            <img
              ref={logoRef}
              onLoad={() => setLogoSettled(true)}
              onError={() => setLogoSettled(true)}
              src="/azzanco-logo.png"
              alt=""
              className="h-14 w-14 shrink-0 object-contain"
            />
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs text-muted">{t('appName')}</p>
              <h1 className="text-lg font-bold leading-tight">
                {t('supplierPoPrintTitle')} <bdi dir="ltr">{po.po_number}</bdi>
              </h1>
            </div>
          </div>
          {/* A draft is still marked as one; an approved PO has nothing here. */}
          {draft && (
            <span className="shrink-0 rounded-full border-2 border-fg px-2 py-0.5 text-xs font-bold">
              {draftMark}
            </span>
          )}
        </header>

        {/* Owner 2026-10-29: the buyer on the start side (right in Arabic),
            the supplier on the other. */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">{t('supplierPoPrintBuyer')}</h2>
            <p className="text-base font-semibold">{t('supplierPoPrintBuyerName')}</p>
            <p className="mt-1">
              <span className="text-muted">{t('project')}:</span> {project}
            </p>
          </section>
          <section className="rounded border p-3">
            <h2 className="text-[11px] text-muted">{t('supplierPoSupplier')}</h2>
            <p className="text-base font-semibold">{supplier}</p>
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

        <h2 className="mb-1.5 text-sm font-semibold">
          {t('supplierPoEquipment')} ({lines.length})
        </h2>
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
                t('supplierPoEquipmentField'),
                t('supplierPoPrintRentStart'),
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
              return (
                <tr key={line.id} className="break-inside-avoid even:bg-surface">
                  <td className={`${cell} tabular-nums text-muted`}>{index + 1}</td>
                  <td className={`${cell} break-words`}>
                    <p className="font-semibold">
                      <bdi dir="ltr">{unit?.code ?? '—'}</bdi>
                    </p>
                    {unit && (unit.type || unit.plate_number) && (
                      <p className="text-[11px] text-muted">
                        {[unit.type, unit.plate_number].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className={cell}>
                    <bdi dir="ltr">{rentStartOf(line)}</bdi>
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

        <div className="mt-3 flex break-inside-avoid justify-end">
          <dl className="w-full max-w-xs space-y-1 border-t pt-2">
            <div className="flex items-center justify-between gap-3">
              <dt>{t('supplierPoSummaryTotal')}</dt>
              <dd className="m-0 font-semibold">
                <PricesByUnit parts={totals} alignEnd showUnit={mixedUnits} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>{t('supplierPoSummaryVat')}</dt>
              <dd className="m-0 font-medium">
                <PricesByUnit
                  parts={totals}
                  amount={vatOf}
                  alignEnd
                  showUnit={mixedUnits}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-1 text-sm">
              <dt className="font-semibold">{t('supplierPoSummaryTotalWithVat')}</dt>
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
      </div>
    </div>,
    document.body,
  )
}
