import { useEffect, useState } from 'react'
import { Button, Dialog, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { supplierPoFormMessage } from '@/lib/purchasing'
import { approveSupplierPo, type SupplierPoRow } from '@/lib/purchasingData'

/**
 * «اعتماد» (owner 2026-10-28, EM-107, migration 0160): approval locks the PO
 * (no unit, price or start-date change; notes and closing stay) and opens
 * its PDF, so the dialog says so before the call. Saves through
 * `approve_supplier_po`, which checks `purchasing.approve`, that the caller
 * did not create the PO, and that every line is priced; a refusal shows its
 * mapped message, never the raw error.
 */
export function ApproveSupplierPoDialog({
  po,
  open,
  onOpenChange,
  onApproved,
}: {
  po: Pick<SupplierPoRow, 'id' | 'po_number'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onApproved: () => void
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
    const result = await approveSupplierPo(po.id)
    setSaving(false)
    if (result.error) {
      setMessage(supplierPoFormMessage(result.error))
      return
    }
    onApproved()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={
        <span>
          {t('supplierPoApproveConfirmTitle')} <bdi dir="ltr">{po.po_number}</bdi>
        </span>
      }
      description={t('supplierPoApproveConfirmDesc')}
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
            {t('supplierPoApprove')}
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
