import { useEffect, useState } from 'react'
import { Eraser, MessageSquareReply } from 'lucide-react'
import {
  Button,
  Dialog,
  Field,
  Notice,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { QUOTATION_LINE_NOTE_MAX } from '@/lib/formValidation'
import {
  quotationErrorMessage,
  type QuotationOutcome,
  type QuotationRow,
} from '@/lib/quotations'
import { setQuotationOutcome } from '@/lib/quotationsData'

type OutcomeTarget = Pick<
  QuotationRow,
  'id' | 'quote_number' | 'outcome' | 'outcome_note'
>

/**
 * «تسجيل رد العميل» of an approved quotation (migration 0199): مقبول or
 * مرفوض with an optional note (500 characters at most). An answer already
 * recorded opens selected, so it can be changed. Saves through
 * `set_quotation_outcome` (`sales.manage`); a refusal shows its mapped
 * message and asks the page to refetch.
 */
export function QuotationOutcomeDialog({
  quotation,
  open,
  onOpenChange,
  onSaved,
  onRefused,
}: {
  quotation: OutcomeTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  /** Refused: the mapped message (the page closes the dialog
   *  and shows it itself when the quotation changed meanwhile). */
  onRefused?: (message: TranslationKey) => void
}) {
  const { t } = useI18n()
  const [outcome, setOutcome] = useState<QuotationOutcome | ''>('')
  const [note, setNote] = useState('')
  const [outcomeError, setOutcomeError] = useState<TranslationKey | null>(null)
  const [noteError, setNoteError] = useState<TranslationKey | null>(null)
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setOutcome(quotation.outcome ?? '')
    setNote(quotation.outcome_note ?? '')
    setOutcomeError(null)
    setNoteError(null)
    setMessage(null)
    setSaving(false)
    // The quotation is read only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    if (saving) return
    if (!outcome) {
      setOutcomeError('quotationErrInvalidOutcome')
      return
    }
    if (note.trim().length > QUOTATION_LINE_NOTE_MAX) {
      setNoteError('quotationErrNoteTooLong')
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await setQuotationOutcome({
      id: quotation.id,
      outcome,
      note,
    })
    setSaving(false)
    if (result.error) {
      const key = quotationErrorMessage(result.error)
      if (key === 'quotationErrNoteTooLong') setNoteError(key)
      else if (key === 'quotationErrInvalidOutcome') setOutcomeError(key)
      else {
        setMessage(key)
        onRefused?.(key)
      }
      return
    }
    onSaved()
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
          <MessageSquareReply
            size={18}
            aria-hidden="true"
            className="text-muted"
          />
          <span>
            {t('quotationOutcomeTitle')}{' '}
            <bdi dir="ltr">{quotation.quote_number}</bdi>
          </span>
        </span>
      }
      description={t('quotationOutcomeDesc')}
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
            {t('quotationOutcomeSave')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={t('quotationOutcomeTitle')}
          required
          error={outcomeError ? t(outcomeError) : undefined}
        >
          {(control) => (
            <RadioGroup
              {...control}
              value={outcome}
              onValueChange={(value) => {
                setOutcomeError(null)
                setOutcome(value as QuotationOutcome)
              }}
            >
              <RadioGroupItem
                value="accepted"
                label={t('quotationStateAccepted')}
              />
              <RadioGroupItem
                value="rejected"
                label={t('quotationStateRejected')}
              />
            </RadioGroup>
          )}
        </Field>
        <Field
          label={t('quotationOutcomeNoteLabel')}
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

/**
 * «مسح رد العميل»: a small confirm; the quotation stays approved without an
 * answer (`set_quotation_outcome` with NULL, `sales.manage`).
 */
export function ClearQuotationOutcomeDialog({
  quotation,
  open,
  onOpenChange,
  onCleared,
  onRefused,
}: {
  quotation: Pick<QuotationRow, 'id' | 'quote_number'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onCleared: () => void
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

  const clear = async () => {
    if (saving) return
    setSaving(true)
    setMessage(null)
    const result = await setQuotationOutcome({
      id: quotation.id,
      outcome: null,
      note: '',
    })
    setSaving(false)
    if (result.error) {
      const key = quotationErrorMessage(result.error)
      setMessage(key)
      onRefused?.(key)
      return
    }
    onCleared()
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
          <Eraser size={18} aria-hidden="true" className="text-muted" />
          <span>
            {t('quotationClearOutcome')}{' '}
            <bdi dir="ltr">{quotation.quote_number}</bdi>
          </span>
        </span>
      }
      description={t('quotationClearOutcomeDesc')}
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
          <Button variant="primary" loading={saving} onClick={clear}>
            {t('quotationClearOutcomeConfirm')}
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
