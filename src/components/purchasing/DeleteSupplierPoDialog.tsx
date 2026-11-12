import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Dialog, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { supplierPoFormMessage } from '@/lib/purchasing'
import {
  deleteSupplierPo,
  type DeletedSupplierPo,
  type SupplierPoRow,
} from '@/lib/purchasingData'

/** Refusals that mean the page is stale: the caller refetches the PO. */
const STALE_TOKENS = ['po_approved_locked', 'po_number_issued', 'invalid_po']

/**
 * «حذف الامر» of a DRAFT supplier PO that still carries its draft
 * reference (migration 0193): a destructive confirm with the reference and
 * the number of units, no typing. Saves through `delete_supplier_po`, which
 * re-checks `purchasing.manage`, the draft state and that no official number
 * was issued. A refusal shows its mapped message, never the raw error; when
 * it means the page is stale the page refetches the PO.
 */
export function DeleteSupplierPoDialog({
  po,
  lineCount,
  open,
  onOpenChange,
  onDeleted,
  onStale,
}: {
  po: Pick<SupplierPoRow, 'id' | 'po_number'>
  lineCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: (result: DeletedSupplierPo | null) => void
  /** The PO changed under the page (approved, numbered or gone). */
  onStale?: () => void
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
    const result = await deleteSupplierPo(po.id)
    setSaving(false)
    if (result.error) {
      setMessage(supplierPoFormMessage(result.error))
      const text = `${result.error.message ?? ''} ${result.error.details ?? ''}`
      if (STALE_TOKENS.some((token) => text.includes(token))) onStale?.()
      return
    }
    onDeleted(result.data)
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
            {t('supplierPoDeleteTitle')} <bdi dir="ltr">{po.po_number}</bdi>
          </span>
        </span>
      }
      description={
        lineCount > 0
          ? t('supplierPoDeleteDesc').replace('{count}', String(lineCount))
          : t('supplierPoDeleteDescEmpty')
      }
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
            {t('supplierPoDelete')}
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
