import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { QUOTATION_LINE_NOTE_MAX } from '@/lib/formValidation'
import { quotationErrorMessage, type QuotationRow } from '@/lib/quotations'
import { returnQuotationApproval } from '@/lib/quotationsData'

/**
 * «رجوع للتعديل» of an APPROVED quotation (migration 0199): back to draft
 * with an optional note (500 characters at most); the official number stays
 * and the client's answer is cleared. Saves through
 * `return_quotation_approval` (`sales.quotations.approve`); a refusal shows
 * its mapped message and asks the page to refetch.
 */
export function ReturnQuotationDialog({
  quotation,
  open,
  onOpenChange,
  onReturned,
  onRefused,
}: {
  quotation: Pick<QuotationRow, 'id' | 'quote_number'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onReturned: () => void
  /** Refused: the mapped message (the page closes the dialog
   *  and shows it itself when the quotation changed meanwhile). */
  onRefused?: (message: TranslationKey) => void
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
    if (note.trim().length > QUOTATION_LINE_NOTE_MAX) {
      setNoteError('quotationErrNoteTooLong')
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await returnQuotationApproval({ id: quotation.id, note })
    setSaving(false)
    if (result.error) {
      const key = quotationErrorMessage(result.error)
      if (key === 'quotationErrNoteTooLong') setNoteError(key)
      else {
        setMessage(key)
        onRefused?.(key)
      }
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
            {t('quotationReturnTitle')}{' '}
            <bdi dir="ltr">{quotation.quote_number}</bdi>
          </span>
        </span>
      }
      description={t('quotationReturnDesc')}
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
            {t('quotationReturn')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={t('quotationReturnNote')}
          error={noteError ? t(noteError) : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={QUOTATION_LINE_NOTE_MAX}
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
