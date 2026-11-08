import { useEffect, useRef, useState } from 'react'
import { CalendarX2, RotateCcw } from 'lucide-react'
import {
  Button,
  DatePicker,
  Dialog,
  Field,
  Notice,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  cardPricingReturnSchema,
  clearFieldErrors,
  endCardFormSchema,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  CARD_MONTH_NOTE_MAX,
  END_CARD_FIELD_ORDER,
  END_CARD_FIELD_RULES,
  cardEndErrorOutcome,
  cardEndFormMessage,
  type EndCardFormValues,
} from '@/lib/sales'
import { endEquipmentCard, reopenEquipmentCard } from '@/lib/salesData'
import { saudiDateKey } from '@/lib/saudiTime'

/** The card an end / reopen dialog acts on. */
export interface EndCardTarget {
  card_id: string
  equipment_code: string | null
  period_from: string
}

/**
 * «انهاء الكرت» (migration 0185, owner 2026-11-08 «انهاء الكرت خليه يدوي»):
 * the end day — from the card's first day to today in Saudi time, today by
 * default — and an optional note, saved through `end_equipment_card`
 * (sales.manage, re-checked there). The 0185 tokens come back as the field's
 * message (`invalid_period_to`, `card_has_later_months`) or one form-level
 * message (`card_already_ended`, `invalid_card`).
 */
export function EndCardDialog({
  card,
  open,
  onOpenChange,
  onEnded,
}: {
  card: EndCardTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  onEnded: (periodTo: string) => void
}) {
  const { t } = useI18n()
  const today = saudiDateKey()
  const [form, setForm] = useState<EndCardFormValues>({
    period_to: today,
    note: '',
  })
  const [errors, setErrors] = useState<FieldErrors<EndCardFormValues>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setForm({ period_to: saudiDateKey(), note: '' })
    setErrors({})
    setMessage(null)
    setSaving(false)
  }, [open])

  const update = (patch: Partial<EndCardFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof EndCardFormValues)[],
      ),
    )
  }

  const save = async () => {
    if (saving) return
    const invalid = validateWithSchema(endCardFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, END_CARD_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await endEquipmentCard({
      cardId: card.card_id,
      periodTo: form.period_to,
      note: form.note,
    })
    setSaving(false)
    if (!result.error) {
      onEnded(form.period_to)
      return
    }
    const outcome = cardEndErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, END_CARD_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, END_CARD_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
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
          {t('equipmentCardEnd')}{' '}
          <bdi dir="ltr">{card.equipment_code ?? '—'}</bdi>
        </span>
      }
      description={t('equipmentCardEndDesc')}
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
            icon={<CalendarX2 size={16} aria-hidden="true" />}
            onClick={save}
          >
            {t('equipmentCardEnd')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div ref={bodyRef} className="space-y-4">
          {message && (
            <Notice tone="danger" size="compact">
              {t(message)}
            </Notice>
          )}
          <Field
            label={t('equipmentCardEndDate')}
            name="period_to"
            required
            hint={t('equipmentCardEndDateHint')}
            error={errors.period_to && t(errors.period_to)}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={form.period_to}
                min={card.period_from}
                max={today}
                onChange={(value) => update({ period_to: value })}
              />
            )}
          </Field>
          <Field
            label={t('cardPricingReturnNote')}
            name="note"
            error={errors.note && t(errors.note)}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={CARD_MONTH_NOTE_MAX}
                value={form.note}
                onChange={(event) => update({ note: event.target.value })}
              />
            )}
          </Field>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * «اعادة فتح الكرت» (0185): a confirmation with an optional note, saved
 * through `reopen_equipment_card` (sales.manage); a later card of the same
 * unit refuses it (`card_overlap` → «المعدة لها كرت لاحق، لا يمكن اعادة
 * الفتح»).
 */
export function ReopenCardDialog({
  card,
  open,
  onOpenChange,
  onReopened,
}: {
  card: EndCardTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  onReopened: () => void
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

  const save = async () => {
    if (saving) return
    const invalid = validateWithSchema(cardPricingReturnSchema, { note })
    if (invalid.note) {
      setNoteError(invalid.note)
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await reopenEquipmentCard({ cardId: card.card_id, note })
    setSaving(false)
    if (!result.error) {
      onReopened()
      return
    }
    setMessage(cardEndFormMessage(result.error))
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
          {t('equipmentCardReopen')}{' '}
          <bdi dir="ltr">{card.equipment_code ?? '—'}</bdi>
        </span>
      }
      description={t('equipmentCardReopenDesc')}
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
            variant="primary"
            loading={saving}
            icon={<RotateCcw size={16} aria-hidden="true" />}
            onClick={save}
          >
            {t('equipmentCardReopen')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        <Field
          label={t('cardPricingReturnNote')}
          name="note"
          error={noteError ? t(noteError) : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={CARD_MONTH_NOTE_MAX}
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
                setNoteError(null)
              }}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}
