import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Price } from '@/components/purchasing/Price'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { formatSaudiDateTime } from '@/lib/printExport'
import { SUPPLIER_PO_STATUS_BADGE, vatOf, withVat } from '@/lib/purchasing'
import {
  supplierPoTotal,
  type SupplierPoLineRow,
  type SupplierPoRow,
} from '@/lib/purchasingData'
import { saudiDateKey } from '@/lib/saudiTime'

/** If the browser never reports the dialog closed, the sheet leaves anyway. */
const AFTERPRINT_FALLBACK_MS = 120_000

export interface SupplierPoPrintSheetProps {
  po: SupplierPoRow
  /** The lines in the order the page shows them. */
  lines: readonly SupplierPoLineRow[]
  supplier: string
  company: string
  project: string
  createdBy: string
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
 * the content; nothing is fetched or stored.
 */
export function SupplierPoPrintSheet({
  po,
  lines,
  supplier,
  company,
  project,
  createdBy,
  onDone,
}: SupplierPoPrintSheetProps) {
  const { t, lang } = useI18n()
  const logoRef = useRef<HTMLImageElement>(null)
  const [logoSettled, setLogoSettled] = useState(false)
  const printed = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const poNumber = po.po_number

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
    // The suggested PDF file name: the PO number and the day.
    document.title = `${poNumber} ${saudiDateKey(new Date().toISOString())}`
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
  }, [logoSettled, poNumber])

  const { total, unpriced } = supplierPoTotal(lines)
  const facts: { label: string; value: string; ltr?: boolean }[] = [
    { label: t('supplierPoSupplier'), value: supplier },
    { label: t('company'), value: company },
    { label: t('project'), value: project },
    { label: t('supplierPoStartDate'), value: formatDate(po.start_date), ltr: true },
    { label: t('supplierPoCreatedBy'), value: createdBy },
    {
      label: t('supplierPoCreatedAt'),
      value: formatSaudiDateTime(po.created_at),
      ltr: true,
    },
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
  const periodOf = (line: SupplierPoLineRow) => {
    if (!line.card) return '—'
    const to = line.card.period_to
      ? formatDate(line.card.period_to)
      : t('equipmentPurchasingOpenEnd')
    return `${formatDate(line.card.period_from)} – ${to}`
  }
  const cell = 'border px-2 py-1.5 align-top'

  return createPortal(
    <div
      className="po-print-sheet print-export hidden bg-bg text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      aria-hidden="true"
    >
      <style>{'@page { size: A4 portrait; margin: 12mm 10mm; }'}</style>
      <div className="mx-auto max-w-[190mm] text-[12px] leading-snug">
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
              <p className="text-base font-semibold">{supplier}</p>
            </div>
          </div>
          <div className="shrink-0 space-y-1 text-end text-xs">
            <p>
              <span className="inline-block rounded-full border px-2 py-0.5 font-medium">
                {t(SUPPLIER_PO_STATUS_BADGE[po.status].key)}
              </span>
            </p>
            <p className="text-muted">
              {t('printGeneratedAt').replace(
                '{date}',
                formatSaudiDateTime(new Date()),
              )}
            </p>
          </div>
        </header>

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
            <col style={{ width: '30%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead className="[display:table-header-group]">
            <tr>
              {[
                '#',
                t('supplierPoEquipmentField'),
                t('equipmentPurchasingPeriod'),
                t('supplierPoLineNote'),
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
                    <bdi dir="ltr">{periodOf(line)}</bdi>
                  </td>
                  <td className={`${cell} break-words`}>{line.note ?? '—'}</td>
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
                <Price value={total} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>{t('supplierPoSummaryVat')}</dt>
              <dd className="m-0 font-medium">
                <Price value={vatOf(total)} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-1 text-sm">
              <dt className="font-semibold">{t('supplierPoSummaryTotalWithVat')}</dt>
              <dd className="m-0 font-bold">
                <Price value={withVat(total)} />
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
