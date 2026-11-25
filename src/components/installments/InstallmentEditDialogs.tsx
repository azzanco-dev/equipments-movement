import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import {
  Button,
  DatePicker,
  Dialog,
  Field,
  Input,
  Notice,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  installmentErrorMessage,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
} from '@/lib/installments'
import {
  setInstallmentDueDate,
  updateInstallmentPayment,
} from '@/lib/installmentsData'
import {
  amountInputText,
  amountOf,
  installmentErrorToken,
  INSTALLMENT_STALE_TOKENS,
  parseInstallmentAmount,
  payableRowLabel,
  type InstallmentPaymentRow,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import { AmountHint, Money } from './cells'

/** The tokens of `update_installment_payment` that belong to a field. */
const PAYMENT_DATE_TOKENS = new Set(['invalid_paid_on'])
const PAYMENT_AMOUNT_TOKENS = new Set([
  'invalid_payment_amount',
  'payment_exceeds_balance',
  'installments_not_scheduled',
])

/**
 * «تعديل السداد» (migration 0213, owner 2026-11-25: «تعديل تاريخ الحوالة»,
 * «تعديل مبلغ … مبلغ السداد نفسه»): the transfer day (up to today) and the
 * amount of a posted payment. A new amount is allocated again by the
 * database — the row it covered first, then the oldest due —, never past
 * what is open.
 */
export function EditInstallmentPaymentDialog({
  payment,
  onOpenChange,
  onDone,
  onStale,
}: {
  /** The posted payment; null = closed. */
  payment: InstallmentPaymentRow | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
  onStale?: () => void
}) {
  const { t } = useI18n()
  const [today] = useState(() => saudiDateKey())
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [dateError, setDateError] = useState<TranslationKey | null>(null)
  const [amountError, setAmountError] = useState<TranslationKey | null>(null)
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  const paymentId = payment?.id
  useEffect(() => {
    if (!payment) return
    setDate(payment.paid_on)
    setAmount(amountInputText(payment.amount))
    setDateError(null)
    setAmountError(null)
    setFormError(null)
    setSaving(false)
    // Another payment, or the opening, resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId])

  const parsed = parseInstallmentAmount(amount)
  const unchanged =
    payment !== null &&
    date === payment.paid_on &&
    parsed !== null &&
    parsed === amountOf(payment.amount)

  const submit = async () => {
    if (!payment || saving) return
    let failed = false
    if (!date || date > today) {
      setDateError('instErrPaidOn')
      failed = true
    }
    if (parsed === null || parsed <= 0) {
      setAmountError('instErrPaymentAmount')
      failed = true
    }
    if (failed || parsed === null) return
    setFormError(null)
    setSaving(true)
    const result = await updateInstallmentPayment(payment.id, date, parsed)
    setSaving(false)
    if (result.error) {
      const token = installmentErrorToken(result.error)
      const message = installmentErrorMessage(result.error)
      if (token && PAYMENT_DATE_TOKENS.has(token)) setDateError(message)
      else if (token && PAYMENT_AMOUNT_TOKENS.has(token))
        setAmountError(message)
      else setFormError(message)
      if (token && INSTALLMENT_STALE_TOKENS.has(token)) onStale?.()
      return
    }
    onDone()
  }

  return (
    <Dialog
      open={payment !== null}
      size="sm"
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={t('instEditPaymentTitle')}
      description={
        payment
          ? `${formatDate(payment.paid_on)} · ${t(
              INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[payment.method],
            )}`
          : undefined
      }
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('instDialogCancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={unchanged}
            onClick={submit}
          >
            {t('instEditPaymentSave')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('instEditPaymentDate')}
          required
          error={dateError ? t(dateError) : undefined}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={date}
              max={today}
              onChange={(value) => {
                setDate(value)
                setDateError(null)
              }}
            />
          )}
        </Field>
        <Field
          label={t('instEditPaymentAmount')}
          required
          error={amountError ? t(amountError) : undefined}
          hint={<AmountHint value={amount} />}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setAmountError(null)
              }}
            />
          )}
        </Field>
        {payment && parsed !== null && parsed !== amountOf(payment.amount) && (
          <Notice tone="info" size="compact" icon={<Info size={16} />}>
            {t('instEditPaymentReallocate')}
          </Notice>
        )}
        {formError && (
          <p role="alert" className="text-xs text-danger">
            {t(formError)}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/**
 * «تعديل تاريخ الاستحقاق» (migration 0213, owner 2026-11-25: «تاريخ
 * الاستحقاق بالطريقة الي ذكرتها انت»): the due day of an installment that is
 * not fully paid; the dues, the lateness and the reminder follow it. A
 * rebuild of the schedule (a change of the terms) drops it.
 */
export function SetInstallmentDueDateDialog({
  row,
  onOpenChange,
  onDone,
  onStale,
}: {
  /** The installment row; null = closed. */
  row: InstallmentScheduleItem | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
  onStale?: () => void
}) {
  const { t } = useI18n()
  const [date, setDate] = useState('')
  const [error, setError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  const rowId = row?.id
  useEffect(() => {
    if (!row) return
    setDate(row.due_date ?? '')
    setError(null)
    setSaving(false)
    // Another row, or the opening, resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId])

  const submit = async () => {
    if (!row || saving) return
    if (!date) return setError('instErrDueDate')
    setError(null)
    setSaving(true)
    const result = await setInstallmentDueDate(row.id, date)
    setSaving(false)
    if (result.error) {
      setError(installmentErrorMessage(result.error))
      const token = installmentErrorToken(result.error)
      if (token && INSTALLMENT_STALE_TOKENS.has(token)) onStale?.()
      return
    }
    onDone()
  }

  return (
    <Dialog
      open={row !== null}
      size="sm"
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={t('instDueDateTitle').replace('{title}', () =>
        row ? payableRowLabel(row, t) : '',
      )}
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('instDialogCancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!row || date === (row.due_date ?? '')}
            onClick={submit}
          >
            {t('instPaymentDateSave')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-surface p-3">
          <span className="text-xs text-muted">
            {t('instInstallmentAmount')}
          </span>
          <Money value={row?.amount} className="font-bold" />
        </div>
        <Field
          label={t('instDueDate')}
          required
          error={error ? t(error) : undefined}
          hint={t('instDueDateHint')}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={date}
              onChange={(value) => {
                setDate(value)
                setError(null)
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
