import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileX, Printer, X } from 'lucide-react'
import { Price } from '@/components/purchasing/Price'
import { Button, EmptyState, Spinner } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { formatSaudiDateTime, takePrintPayloadText } from '@/lib/printExport'
import {
  decodeSupplierPoPrintPayload,
  supplierPoPrintTotals,
  type SupplierPoPrintLine,
  type SupplierPoPrintPayload,
} from '@/lib/printSupplierPo'
import { SUPPLIER_PO_STATUS_BADGE, vatOf, withVat } from '@/lib/purchasing'
import { saudiDateKey } from '@/lib/saudiTime'

type PrintState =
  | { status: 'reading' }
  | { status: 'missing' }
  | { status: 'ready'; payload: SupplierPoPrintPayload }

/** The list the «close» button returns to when the tab cannot close itself. */
const BACK_PATH = '/purchasing/orders'

/**
 * This tab's session storage and the opener's (the PO page that exported):
 * the export writes the payload into both, so it is found whichever way the
 * browser shares session storage with a new tab (same as `PrintExport`).
 */
function payloadStores(): (Storage | null)[] {
  const read = (pick: () => Storage | null | undefined) => {
    try {
      return pick() ?? null
    } catch {
      return null
    }
  }
  return [
    read(() => window.sessionStorage),
    read(() => (window.opener as Window | null)?.sessionStorage),
  ]
}

export interface SupplierPoPrintProps {
  /** The `key` query value the PO page opened this tab with. */
  payloadKey: string | null
}

/**
 * The print page behind «تصدير PDF» of a supplier PO (`/print/po`, owner
 * 2026-10-22). Rendered by the signed-in client app without the layout
 * chrome, for a holder of `purchasing.view`. It reads the payload the PO
 * page stored for it once, deletes it and fetches nothing; once the fonts
 * and the logo are ready it opens the browser's print dialog. A reload, or
 * a link opened directly, finds no payload and says so with a way back to
 * the PO list, never a blank page.
 */
export function SupplierPoPrint({ payloadKey }: SupplierPoPrintProps) {
  const { t } = useI18n()
  const router = useRouter()
  const [state, setState] = useState<PrintState>({ status: 'reading' })
  const printed = useRef(false)
  const logoRef = useRef<HTMLImageElement>(null)
  const [logoSettled, setLogoSettled] = useState(false)

  useEffect(() => {
    const payload = takePrintPayloadText(
      payloadStores(),
      payloadKey,
      decodeSupplierPoPrintPayload,
    )
    setState(payload ? { status: 'ready', payload } : { status: 'missing' })
  }, [payloadKey])

  const payload = state.status === 'ready' ? state.payload : null

  useEffect(() => {
    if (!payload) return
    // The suggested PDF file name: the PO number and the day.
    document.title = `${payload.poNumber} ${saudiDateKey(payload.generatedAt)}`
    if (printed.current) return
    if (!logoSettled && !logoRef.current?.complete) return
    printed.current = true
    const fontsReady =
      typeof document.fonts?.ready?.then === 'function'
        ? document.fonts.ready
        : Promise.resolve()
    void fontsReady.then(() =>
      window.requestAnimationFrame(() => window.print()),
    )
  }, [payload, logoSettled])

  const close = () => {
    window.close()
    router.push(BACK_PATH)
  }

  if (state.status === 'reading')
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )

  if (!payload)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4">
        <EmptyState
          className="w-full max-w-md"
          icon={<FileX size={28} aria-hidden="true" />}
          title={t('printMissingTitle')}
          description={t('supplierPoPrintMissingDesc')}
          action={
            <Button variant="primary" onClick={() => router.push(BACK_PATH)}>
              {t('supplierPoBackToList')}
            </Button>
          }
        />
      </div>
    )

  const { total, unpriced } = supplierPoPrintTotals(payload.lines)
  const facts: { label: string; value: string; ltr?: boolean }[] = [
    { label: t('supplierPoSupplier'), value: payload.supplier },
    { label: t('company'), value: payload.company },
    { label: t('project'), value: payload.project },
    {
      label: t('supplierPoStartDate'),
      value: formatDate(payload.startDate),
      ltr: true,
    },
    { label: t('supplierPoCreatedBy'), value: payload.createdBy },
    {
      label: t('supplierPoCreatedAt'),
      value: formatSaudiDateTime(payload.createdAt),
      ltr: true,
    },
    ...(payload.closedAt
      ? [
          {
            label: t('supplierPoClosedAt'),
            value: formatSaudiDateTime(payload.closedAt),
            ltr: true,
          },
        ]
      : []),
  ]
  const periodOf = (line: SupplierPoPrintLine) => {
    if (!line.periodFrom) return '—'
    const to = line.periodTo
      ? formatDate(line.periodTo)
      : t('equipmentPurchasingOpenEnd')
    return `${formatDate(line.periodFrom)} – ${to}`
  }
  const cell = 'border px-2 py-1.5 align-top'

  return (
    <div
      className="print-export min-h-[100dvh] bg-bg px-4 py-4 text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:min-h-0 print:p-0"
      dir={payload.lang === 'ar' ? 'rtl' : 'ltr'}
      lang={payload.lang}
    >
      <style>{'@page { size: A4 portrait; margin: 12mm 10mm; }'}</style>

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" />
          {t('printAction')}
        </Button>
        <Button variant="outline" onClick={close}>
          <X size={16} aria-hidden="true" />
          {t('close')}
        </Button>
      </div>

      <div className="mx-auto max-w-[190mm] text-[12px] leading-snug">
        <header className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
          <div className="flex items-start gap-3">
            <img
              ref={logoRef}
              onLoad={() => setLogoSettled(true)}
              onError={() => setLogoSettled(true)}
              src="/azzanco-logo.png"
              alt=""
              aria-hidden="true"
              className="h-14 w-14 shrink-0 object-contain"
            />
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs text-muted">{t('appName')}</p>
              <h1 className="text-lg font-bold leading-tight">
                {t('supplierPoPrintTitle')} <bdi dir="ltr">{payload.poNumber}</bdi>
              </h1>
              <p className="text-base font-semibold">{payload.supplier}</p>
            </div>
          </div>
          <div className="shrink-0 space-y-1 text-end text-xs">
            <p>
              <span className="inline-block rounded-full border px-2 py-0.5 font-medium">
                {t(SUPPLIER_PO_STATUS_BADGE[payload.status].key)}
              </span>
            </p>
            <p className="text-muted">
              {t('printGeneratedAt').replace(
                '{date}',
                formatSaudiDateTime(payload.generatedAt),
              )}
            </p>
          </div>
        </header>

        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
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
          {t('supplierPoEquipment')} ({payload.lines.length})
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
                  className={`${cell} bg-surface-hover text-start font-semibold ${index === 4 ? 'text-end' : ''}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.lines.map((line, index) => (
              <tr key={index} className="break-inside-avoid even:bg-surface">
                <td className={`${cell} tabular-nums text-muted`}>{index + 1}</td>
                <td className={`${cell} break-words`}>
                  <p className="font-semibold">
                    <bdi dir="ltr">{line.code}</bdi>
                  </p>
                  {(line.type || line.plate) && (
                    <p className="text-[11px] text-muted">
                      {[line.type, line.plate].filter(Boolean).join(' · ')}
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
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-end break-inside-avoid">
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

        {payload.notes && (
          <section className="mt-4 break-inside-avoid">
            <h2 className="mb-1 text-sm font-semibold">{t('notes')}</h2>
            <p className="whitespace-pre-wrap break-words">{payload.notes}</p>
          </section>
        )}
      </div>
    </div>
  )
}
