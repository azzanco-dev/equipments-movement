import { useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Paperclip, RefreshCw, Trash2, X } from 'lucide-react'
import { Button, IconButton, Lightbox, cn, useConfirm } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  INSTALLMENT_RECEIPT_ACCEPT,
  isImageReceipt,
  receiptFileError,
  type InstallmentReceipt,
} from '@/lib/installmentReceipts'
import {
  InstallmentReceiptError,
  attachInstallmentReceipt,
  installmentReceiptUrl,
  removeInstallmentReceipt,
} from '@/lib/installmentReceiptsData'
import { formatDocumentSize } from '@/lib/partyDocuments'

const errorKeyOf = (error: unknown): TranslationKey =>
  error instanceof InstallmentReceiptError ? error.key : 'instReceiptSaveFailed'

/**
 * The file field of «تسجيل سداد»: one optional PDF or image, checked here
 * (type, size) and uploaded only after the payment is saved.
 */
export function ReceiptPicker({
  file,
  onChange,
  error,
  disabled,
}: {
  file: File | null
  onChange: (file: File | null, error: TranslationKey | null) => void
  error?: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const pick = (picked: File | undefined) => {
    if (!picked) return
    onChange(picked, receiptFileError(picked))
  }
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium">
        {t('instReceiptLabel')}{' '}
        <span className="text-xs font-normal text-muted">({t('instOptional')})</span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={INSTALLMENT_RECEIPT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          pick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {file ? (
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border bg-surface px-3 py-2',
            error && 'border-danger',
          )}
        >
          <ReceiptIcon image={file.type.startsWith('image/')} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm" dir="auto">
              {file.name}
            </span>
            <span className="block text-xs text-muted">
              {formatDocumentSize(file.size, t)}
            </span>
          </span>
          <IconButton
            size="sm"
            variant="ghost"
            label={t('instReceiptClear')}
            icon={<X size={14} />}
            disabled={disabled}
            onClick={() => onChange(null, null)}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            pick(event.dataTransfer.files?.[0])
          }}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed bg-bg px-3 py-3 text-start transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60"
        >
          <Paperclip size={18} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block text-sm">{t('instReceiptPick')}</span>
            <span className="block text-xs text-muted">{t('instReceiptLimits')}</span>
          </span>
        </button>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function ReceiptIcon({ image }: { image: boolean }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-hover text-muted">
      {image ? (
        <ImageIcon size={16} aria-hidden="true" />
      ) : (
        <FileText size={16} aria-hidden="true" />
      )}
    </span>
  )
}

/**
 * The receipt line of a payment card: the file with «عرض» for every
 * reader, «استبدال» / «حذف» (or «ارفاق ملف الحوالة» when none) for
 * `installments.manage` on a POSTED payment. A voided payment keeps its file
 * for viewing only.
 */
export function PaymentReceiptLine({
  contractId,
  paymentId,
  receipt,
  canManage,
  onChanged,
}: {
  contractId: string
  paymentId: string
  receipt: InstallmentReceipt | null
  /** installments.manage and a posted payment. */
  canManage: boolean
  onChanged: () => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const { confirm, confirmDialog } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null)

  if (!receipt && !canManage) return null

  const view = async () => {
    if (!receipt) return
    setError(null)
    // A PDF opens in a tab opened by the click itself, so no pop-up blocker
    // stops it; the link arrives a moment later.
    const tab = isImageReceipt(receipt) ? null : window.open('', '_blank')
    setBusy(true)
    try {
      const url = await installmentReceiptUrl(receipt)
      if (isImageReceipt(receipt)) setPreview({ src: url, alt: receipt.fileName })
      else if (tab) {
        tab.opener = null
        tab.location.href = url
      } else window.open(url, '_blank', 'noopener')
    } catch (failure) {
      tab?.close()
      setError(errorKeyOf(failure))
    }
    setBusy(false)
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    const invalid = receiptFileError(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await attachInstallmentReceipt(contractId, paymentId, file)
      onChanged()
    } catch (failure) {
      setError(errorKeyOf(failure))
    }
    setBusy(false)
  }

  const remove = async () => {
    const ok = await confirm({
      title: t('instReceiptDeleteTitle'),
      description: t('instReceiptDeleteQuestion'),
      confirmLabel: t('instReceiptDelete'),
      tone: 'danger',
    })
    if (!ok) return
    setError(null)
    setBusy(true)
    try {
      await removeInstallmentReceipt(paymentId)
      onChanged()
    } catch (failure) {
      setError(errorKeyOf(failure))
    }
    setBusy(false)
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept={INSTALLMENT_RECEIPT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {receipt ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5">
          <Paperclip size={14} aria-hidden="true" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-xs">
            <span className="font-medium text-fg">{t('instReceiptLabel')}</span>
            {' · '}
            <span className="text-muted" dir="auto">
              {receipt.fileName}
            </span>
            {receipt.sizeBytes > 0 && (
              <span className="text-muted"> · {formatDocumentSize(receipt.sizeBytes, t)}</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={busy} onClick={view}>
              {t('instReceiptView')}
            </Button>
            {canManage && (
              <>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={t('instReceiptReplace')}
                  icon={<RefreshCw size={14} />}
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={t('instReceiptDelete')}
                  icon={<Trash2 size={14} />}
                  disabled={busy}
                  onClick={remove}
                />
              </>
            )}
          </span>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          icon={<Paperclip size={14} aria-hidden="true" />}
          loading={busy}
          onClick={() => inputRef.current?.click()}
        >
          {t('instReceiptAttach')}
        </Button>
      )}
      {error && <p className="text-xs text-danger">{t(error)}</p>}
      <Lightbox
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        items={preview ? [{ id: 'receipt', src: preview.src, alt: preview.alt }] : []}
        index={0}
        onIndexChange={() => {}}
      />
      {confirmDialog}
    </div>
  )
}
