import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileX, Printer, X } from 'lucide-react'
import { Button, EmptyState, Spinner } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  formatSaudiDateTime,
  printColumnShares,
  takePrintPayload,
  type PrintExportPayload,
} from '@/lib/printExport'
import { saudiDateKey } from '@/lib/saudiTime'

type PrintState =
  | { status: 'reading' }
  | { status: 'missing' }
  | { status: 'ready'; payload: PrintExportPayload }

/** Landscape once the table is wider than a portrait page reads well. */
const LANDSCAPE_FROM_COLUMNS = 7

/**
 * This tab's session storage and the opener's (the /logs tab that exported):
 * the export writes the payload into both, so it is found whichever way the
 * browser shares session storage with a new tab. A storage that throws
 * (blocked site data, a closed opener) counts as empty.
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

export interface PrintExportProps {
  /** The `key` query value the export dialog opened this tab with. */
  payloadKey: string | null
}

/**
 * wave-15-export: the print page behind the PDF export (`/print/export`).
 *
 * Rendered by the signed-in client app without the layout chrome. It reads
 * the payload the export dialog stored for it once, deletes it, and never
 * fetches anything: every cell is display text already. Once the fonts are
 * ready and the rows are on the page it opens the browser's print dialog,
 * whose «Save as PDF» renders Arabic with the app's own font. A reload, or a
 * link opened directly, finds no payload and says so with a way back to
 * `/logs`, never a blank page.
 */
export function PrintExport({ payloadKey }: PrintExportProps) {
  const { t } = useI18n()
  const router = useRouter()
  const [state, setState] = useState<PrintState>({ status: 'reading' })
  const printed = useRef(false)
  const logoRef = useRef<HTMLImageElement>(null)
  // The logo is part of the printed header: print once it has loaded (or
  // failed), so the first print preview does not miss it.
  const [logoSettled, setLogoSettled] = useState(false)

  useEffect(() => {
    const payload = takePrintPayload(payloadStores(), payloadKey)
    setState(payload ? { status: 'ready', payload } : { status: 'missing' })
  }, [payloadKey])

  const payload = state.status === 'ready' ? state.payload : null

  useEffect(() => {
    if (!payload) return
    // The suggested PDF file name follows the document title.
    document.title = `${payload.title} ${saudiDateKey(payload.generatedAt)}`
    // Once per page: the ref survives React's development double-mount.
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
    // A tab the export opened can close itself; otherwise go back to /logs.
    window.close()
    router.push('/logs')
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
          description={t('printMissingDesc')}
          action={
            <Button variant="primary" onClick={() => router.push('/logs')}>
              {t('printBackToLogs')}
            </Button>
          }
        />
      </div>
    )

  const shares = printColumnShares(payload.columns)
  const landscape = payload.columns.length >= LANDSCAPE_FROM_COLUMNS
  const countLine = payload.capped
    ? t('printRecordCapped')
        .replace('{count}', String(payload.rows.length))
        .replace('{total}', String(payload.total))
    : t('exportCountValue').replace('{count}', String(payload.rows.length))

  return (
    <div
      className="print-export min-h-[100dvh] bg-bg px-4 py-4 text-fg [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:min-h-0 print:p-0"
      dir={payload.lang === 'ar' ? 'rtl' : 'ltr'}
      lang={payload.lang}
    >
      <style>{`@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm 10mm; }`}</style>

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

      <header className="mb-3 flex items-start gap-3 border-b pb-3">
        <img
          ref={logoRef}
          onLoad={() => setLogoSettled(true)}
          onError={() => setLogoSettled(true)}
          src="/azzanco-logo.png"
          alt=""
          aria-hidden="true"
          className="h-12 w-12 shrink-0 object-contain"
        />
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-muted">{t('appName')}</p>
          <h1 className="text-lg font-bold leading-tight">{payload.title}</h1>
          <p className="text-xs text-muted">
            {t('printGeneratedAt').replace(
              '{date}',
              formatSaudiDateTime(payload.generatedAt),
            )}
          </p>
          <p className="text-xs">{payload.summary}</p>
          <p className="text-xs font-medium">{countLine}</p>
        </div>
      </header>

      <table className="w-full table-fixed border-collapse text-[11px] leading-snug">
        <colgroup>
          {shares.map((share, index) => (
            <col key={index} style={{ width: `${share}%` }} />
          ))}
        </colgroup>
        <thead className="[display:table-header-group]">
          <tr>
            {payload.columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className="border bg-surface-hover px-1.5 py-1 text-start align-bottom font-semibold"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="break-inside-avoid even:bg-surface">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="break-words border px-1.5 py-1 text-start align-top"
                >
                  {payload.columns[cellIndex]?.type === 'date' ? (
                    <span dir="ltr">{cell}</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
