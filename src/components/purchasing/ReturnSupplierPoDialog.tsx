import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  SUPPLIER_PO_LINE_NOTE_MAX,
  supplierPoReturnSchema,
  validateWithSchema,
} from '@/lib/formValidation'
import { supplierPoFormMessage } from '@/lib/purchasing'
import {
  returnSupplierPoApproval,
  type SupplierPoRow,
} from '@/lib/purchasingData'

/**
 * «رجوع للتعديل» of an APPROVED supplier PO (owner 2026-11-11, migration
 * 0189): a PO is never closed any more, so this is the way to change an
 * approved one — it goes back to draft (units, prices and the start date
 * editable again) with an optional note kept in the PO's timeline, until it
 * is approved again. Saves through `return_supplier_po_approval`, which
 * checks `purchasing.approve`; a refusal shows its mapped message, never the
 * raw error.
 */
export function ReturnSupplierPoDialog({
  po,
  open,
  onOpenChange,
  onReturned,
}: {
  po: Pick<SupplierPoRow, 'id' | 'po_number'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onReturned: () => void
}) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<TranslationKey | null>(null)
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setNote('')
    setNoteError(null)
    setMessage(null)
    setSaving(false)
  }, [open])

  const submit = async () => {
    if (saving) return
    const errors = validateWithSchema(supplierPoReturnSchema, { note })
    if (errors.note) {
      setNoteError(errors.note)
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await returnSupplierPoApproval({ poId: po.id, note })
    setSaving(false)
    if (result.error) {
      setMessage(supplierPoFormMessage(result.error))
      return
    }
    onReturned()
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
          <RotateCcw size={18} aria-hidden="true" className="text-warning" />
          <span>
            {t('supplierPoReturnConfirmTitle')}{' '}
            <bdi dir="ltr">{po.po_number}</bdi>
          </span>
        </span>
      }
      description={t('supplierPoReturnConfirmDesc')}
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
          <Button variant="primary" loading={saving} onClick={submit}>
            {t('supplierPoReturnConfirmButton')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={t('supplierPoReturnNote')}
          error={noteError ? t(noteError) : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={SUPPLIER_PO_LINE_NOTE_MAX}
              value={note}
              onChange={(event) => {
                setNoteError(null)
                setNote(event.target.value)
              }}
            />
          )}
        </Field>
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}
