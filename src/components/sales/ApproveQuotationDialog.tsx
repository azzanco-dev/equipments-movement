import { useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { Button, Dialog, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  isQuotationDraftRef,
  quotationErrorMessage,
  type QuotationRow,
} from '@/lib/quotations'
import { approveQuotation } from '@/lib/quotationsData'

/**
 * «اعتماد» of a draft quotation (migration 0199): the first approval issues
 * the official number `QT-YYYYMM####`, so the dialog says so; after it the
 * quotation changes only once returned to draft. Saves through
 * `approve_quotation`, which checks `sales.quotations.approve` (the approver
 * may be the creator) and that the quotation has lines. A refusal shows its
 * mapped message and asks the page to refetch.
 */
export function ApproveQuotationDialog({
  quotation,
  open,
  onOpenChange,
  onApproved,
  onRefused,
}: {
  quotation: Pick<QuotationRow, 'id' | 'quote_number'>
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The number the quotation carries after the approval. */
  onApproved: (number: string) => void
  /** Refused: the mapped message (the page closes the dialog
   *  and shows it itself when the quotation changed meanwhile). */
  onRefused?: (message: TranslationKey) => void
}) {
  const { t } = useI18n()
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setMessage(null)
    setSaving(false)
  }, [open])

  const approve = async () => {
    if (saving) return
    setSaving(true)
    setMessage(null)
    const result = await approveQuotation(quotation.id)
    setSaving(false)
    if (result.error) {
      const key = quotationErrorMessage(result.error)
      setMessage(key)
      onRefused?.(key)
      return
    }
    onApproved(result.data || quotation.quote_number)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <BadgeCheck size={18} aria-hidden="true" className="text-info" />
          <span>
            {t('quotationApproveTitle')}{' '}
            <bdi dir="ltr">{quotation.quote_number}</bdi>
          </span>
        </span>
      }
      description={t(
        isQuotationDraftRef(quotation.quote_number)
          ? 'quotationApproveDescDraftRef'
          : 'quotationApproveDescNumbered',
      )}
      size="sm"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={approve}>
            {t('quotationApprove')}
          </Button>
        </>
      }
    >
      {message && (
        <Notice tone="danger" size="compact">
          {t(message)}
        </Notice>
      )}
    </Dialog>
  )
}
