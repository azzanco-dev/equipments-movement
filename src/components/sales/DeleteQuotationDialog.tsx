import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Dialog, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { quotationErrorMessage, type QuotationRow } from '@/lib/quotations'
import { deleteQuotation } from '@/lib/quotationsData'

/**
 * «حذف العرض» of a DRAFT quotation that still carries its draft reference
 * (migration 0199): a destructive confirm, no typing. Saves through
 * `delete_quotation` (`sales.manage`; an approved quotation or one that
 * holds an official number is refused). After it the app opens the list; a
 * refusal shows its mapped message and asks the page to refetch.
 */
export function DeleteQuotationDialog({
  quotation,
  open,
  onOpenChange,
  onDeleted,
  onRefused,
}: {
  quotation: Pick<QuotationRow, 'id' | 'quote_number'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
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

  const remove = async () => {
    if (saving) return
    setSaving(true)
    setMessage(null)
    const result = await deleteQuotation(quotation.id)
    setSaving(false)
    if (result.error) {
      const key = quotationErrorMessage(result.error)
      setMessage(key)
      onRefused?.(key)
      return
    }
    onDeleted()
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
          <Trash2 size={18} aria-hidden="true" className="text-danger" />
          <span>
            {t('quotationDelete')} <bdi dir="ltr">{quotation.quote_number}</bdi>
          </span>
        </span>
      }
      description={t('quotationDeleteDesc')}
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
          <Button variant="danger" loading={saving} onClick={remove}>
            {t('quotationDelete')}
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
