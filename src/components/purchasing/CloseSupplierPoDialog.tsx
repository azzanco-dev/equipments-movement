import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Input, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { supplierPoFormMessage } from '@/lib/purchasing'
import { closeSupplierPo, type SupplierPoRow } from '@/lib/purchasingData'

/** The typed number matches the PO's, whatever the case or spaces. */
export function closeConfirmationMatches(typed: string, poNumber: string): boolean {
  return typed.replace(/\s+/g, '').toUpperCase() === poNumber.trim().toUpperCase()
}

/**
 * «اغلاق الامر» (owner 2026-10-22, task 9): closing is final (no further
 * line or price change), so the dialog asks for the PO NUMBER to be typed
 * and keeps the danger button disabled until it matches. Saves through
 * `close_supplier_po` (0136), which re-checks `purchasing.manage`.
 */
export function CloseSupplierPoDialog({
  po,
  open,
  onOpenChange,
  onClosed,
}: {
  po: Pick<SupplierPoRow, 'id' | 'po_number'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
}) {
  const { t } = useI18n()
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const matches = closeConfirmationMatches(typed, po.po_number)

  useEffect(() => {
    if (!open) return
    setTyped('')
    setMessage(null)
    setSaving(false)
  }, [open])

  const close = async () => {
    if (!matches || saving) return
    setSaving(true)
    setMessage(null)
    const result = await closeSupplierPo(po.id)
    setSaving(false)
    if (result.error) {
      setMessage(supplierPoFormMessage(result.error))
      return
    }
    onClosed()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={t('supplierPoCloseConfirmTitle')}
      description={t('supplierPoCloseConfirmDesc')}
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
          <Button
            variant="danger"
            loading={saving}
            disabled={!matches}
            onClick={close}
          >
            {t('supplierPoClose')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void close()
        }}
      >
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        <Field
          label={t('supplierPoCloseTypeNumber')}
          name="po_number"
          required
          hint={
            <span>
              {t('supplierPoCloseTypeNumberHint')}{' '}
              <bdi dir="ltr" className="font-semibold text-fg">
                {po.po_number}
              </bdi>
            </span>
          }
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder={po.po_number}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}
