import { useEffect, useRef, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { SalePrice } from '@/components/sales/SalePrice'
import {
  Button,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  cardMonthFormSchema,
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  CARD_MONTH_FIELD_ORDER,
  CARD_MONTH_FIELD_RULES,
  cardMonthErrorOutcome,
  cardMonthFigures,
  cardMonthFormMessage,
  monthLabel,
  monthShortLabel,
  parseCardMonthHours,
  type CardMonthFormValues,
  type CardMonthSides,
  type CardMonthState,
  type MonthKey,
} from '@/lib/sales'
import {
  deleteEquipmentCardMonth,
  recordEquipmentCardMonth,
} from '@/lib/salesData'

/** The card the dialog records a month of: its id, code, standard hours
 *  and both PO lines (the live due hint). */
export type RecordCardMonthCard = CardMonthSides & {
  card_id: string
  equipment_code: string | null
  standard_hours: number
}

/** A recorded month being edited (prefilled, the month locked). */
export interface RecordCardMonthEditing {
  month: MonthKey
  hours: number | string
  note: string | null
}

const EMPTY_FORM: CardMonthFormValues = { month: '', hours: '', note: '' }

/**
 * «تسجيل شهر» of the card page (the approved mockup, owner 2026-11-04): a
 * month of the card without a record (newest first; the running month is
 * marked), or the recorded month being edited (locked), the hours with the
 * live «مستحق العميل» under them — the same rule as `card_month_due` —, a
 * note; «حذف» for a recorded month, confirmed inline. Saves through
 * `record_equipment_card_month` (an upsert: the same call records and
 * edits) and deletes through `delete_equipment_card_month`; the database
 * checks `sales.manage`, the period and the current month again.
 */
export function RecordCardMonthDialog({
  open,
  onOpenChange,
  card,
  openMonths,
  editing,
  initialMonth = null,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  card: RecordCardMonthCard
  /** The months of the card without a record, newest first. */
  openMonths: readonly { month: MonthKey; state: CardMonthState }[]
  /** The recorded month being edited; null records a new month. */
  editing: RecordCardMonthEditing | null
  /** The month preselected for a new record (a pending row's «+»). */
  initialMonth?: MonthKey | null
  onSaved: (month: MonthKey) => void
  onDeleted: (month: MonthKey) => void
}) {
  const { t, lang } = useI18n()
  const [form, setForm] = useState<CardMonthFormValues>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors<CardMonthFormValues>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const editingMonth = editing?.month ?? null
  const editingHours = editing?.hours
  const editingNote = editing?.note
  const firstOpenMonth = openMonths[0]?.month ?? ''

  useEffect(() => {
    if (!open) return
    setForm({
      month: editingMonth ?? initialMonth ?? firstOpenMonth,
      hours:
        editingHours === undefined || editingHours === null
          ? ''
          : String(editingHours),
      note: editingNote ?? '',
    })
    setErrors({})
    setMessage(null)
    setSaving(false)
    setDeleting(false)
    setConfirmDelete(false)
  }, [
    open,
    editingMonth,
    editingHours,
    editingNote,
    initialMonth,
    firstOpenMonth,
  ])

  const update = (patch: Partial<CardMonthFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof CardMonthFormValues)[],
      ),
    )
  }

  const parsed = parseCardMonthHours(form.hours)
  const figures = cardMonthFigures(card, parsed)
  const dueHint =
    parsed === null ? (
      t('cardMonthHoursHint')
    ) : figures.client.value !== null ? (
      <span className="inline-flex items-baseline gap-1">
        {t('cardMonthClientDueHint')}{' '}
        <SalePrice value={figures.client.value} className="text-fg" />
      </span>
    ) : figures.client.blocker === 'daily' ? (
      t('cardMonthDailyHint')
    ) : figures.client.blocker === 'unpriced' ? (
      t('cardMonthUnpricedHint')
    ) : (
      t('cardMonthNoLineHint')
    )

  const save = async () => {
    const invalid = validateWithSchema(cardMonthFormSchema, form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setMessage(null)
      focusFirstError(invalid, CARD_MONTH_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await recordEquipmentCardMonth({
      cardId: card.card_id,
      month: form.month,
      hours: Number(form.hours.trim()),
      note: form.note,
    })
    setSaving(false)
    if (!result.error) {
      onSaved(form.month)
      return
    }
    const outcome = cardMonthErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, CARD_MONTH_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, CARD_MONTH_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  const remove = async () => {
    if (!editing) return
    setDeleting(true)
    setMessage(null)
    const result = await deleteEquipmentCardMonth({
      cardId: card.card_id,
      month: editing.month,
    })
    setDeleting(false)
    if (!result.error) {
      onDeleted(editing.month)
      return
    }
    setConfirmDelete(false)
    setMessage(cardMonthFormMessage(result.error))
  }

  const monthOptions = editing
    ? [{ value: editing.month, label: monthLabel(editing.month, lang) }]
    : openMonths.map((row) => ({
        value: row.month,
        label: monthLabel(row.month, lang),
        description:
          row.state === 'running' ? t('cardMonthStateRunning') : undefined,
      }))
  const title = editing
    ? t('cardMonthEdit').replace(
        '{month}',
        monthShortLabel(editing.month, lang),
      )
    : t('cardMonthRecord')

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        <>
          <bdi dir="ltr">{card.equipment_code ?? '—'}</bdi> ·{' '}
          {t('cardMonthRecordDesc')}
        </>
      }
      size="sm"
      footer={
        confirmDelete && editing ? (
          /* The inline confirmation of «حذف»: the question, then the
             destructive confirm and a way back. */
          <>
            <span className="me-auto text-sm text-danger">
              {t('cardMonthDeleteConfirm').replace(
                '{month}',
                monthShortLabel(editing.month, lang),
              )}
            </span>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              {t('cancel')}
            </Button>
            <Button variant="danger" loading={deleting} onClick={remove}>
              {t('cardMonthDeleteConfirmYes')}
            </Button>
          </>
        ) : (
          <>
            {editing && (
              <Button
                variant="ghost"
                className="me-auto text-danger hover:text-danger"
                icon={<Trash2 size={16} aria-hidden="true" />}
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                {t('delete')}
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              icon={<Save size={16} aria-hidden="true" />}
              onClick={save}
              disabled={!editing && openMonths.length === 0}
            >
              {t('save')}
            </Button>
          </>
        )
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        <Field
          label={t('cardMonthsMonth')}
          name="month"
          required
          error={errors.month ? t(errors.month) : undefined}
          hint={
            editing
              ? t('cardMonthMonthLocked')
              : openMonths.length === 0
                ? t('cardMonthAllRecorded')
                : undefined
          }
        >
          {(control) => (
            <Select
              {...control}
              value={form.month}
              onValueChange={(month) => update({ month })}
              disabled={!!editing || openMonths.length === 0}
              placeholder={t('cardMonthMonthRequired')}
              options={monthOptions}
            />
          )}
        </Field>
        <Field
          label={t('cardMonthHours')}
          name="hours"
          required
          error={errors.hours ? t(errors.hours) : undefined}
          hint={dueHint}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              min={0}
              max={9999}
              step={1}
              value={form.hours}
              onChange={(event) => update({ hours: event.target.value })}
              placeholder={String(
                card.due_standard_hours ?? card.standard_hours,
              )}
              className="tabular-nums"
              autoFocus
            />
          )}
        </Field>
        <Field
          label={t('cardMonthNote')}
          name="note"
          error={errors.note ? t(errors.note) : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={form.note}
              onChange={(event) => update({ note: event.target.value })}
              placeholder={t('cardMonthNotePlaceholder')}
              maxLength={500}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
