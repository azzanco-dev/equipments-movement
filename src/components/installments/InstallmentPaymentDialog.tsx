import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import {
  Button,
  DatePicker,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  installmentPaymentFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  allocatePayment,
  installmentErrorMessage,
  toHalalas,
  INSTALLMENT_PAYMENT_METHODS,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  INSTALLMENT_PAYMENT_NOTE_MAX,
  INSTALLMENT_PAYMENT_REFERENCE_MAX,
  type InstallmentPaymentMethod,
} from '@/lib/installments'
import {
  fetchInstallmentPaymentContext,
  loadActiveContractOptions,
  recordInstallmentPayment,
} from '@/lib/installmentsData'
import {
  amountInputText,
  amountOf,
  installmentErrorToken,
  installmentFieldError,
  parseInstallmentAmount,
  scheduleRemaining,
  INSTALLMENT_PAYMENT_FIELD_ORDER,
  INSTALLMENT_PAYMENT_TOKEN_FIELDS,
  INSTALLMENT_STALE_TOKENS,
  type InstallmentContractRow,
  type InstallmentPaymentFormValues,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import { AmountHint, Money, OptionalLabel, PreviewStat } from './cells'

type Errors = FieldErrors<InstallmentPaymentFormValues>

/** The contract a payment dialog opens on (a row's «تسديد», the contract
 *  page). */
export interface InstallmentPaymentTarget {
  id: string
  contract_number: string
  description: string
  financier_name: string
}

type ContextState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'gone' }
  | {
      status: 'ready'
      contract: InstallmentContractRow
      schedule: InstallmentScheduleItem[]
    }

/**
 * «تسجيل سداد» (the approved /ui-kit dialog on the real data): the contract
 * (picked here when the dialog was opened from the page header, by a
 * server-side search of the ACTIVE contracts), what it still owes, the
 * amount with its quick choices and the «يوزع على» preview (`allocatePayment`
 * mirrors the database's allocation to the oldest unpaid rows), the day (not
 * after the Saudi today), the method, a reference and a note. Saved through
 * `record_installment_payment` (`installments.manage`), which decides.
 */
export function InstallmentPaymentDialog({
  open,
  onOpenChange,
  contract = null,
  initialAmount,
  onSaved,
  onStale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The contract paid; null = the user picks one. */
  contract?: InstallmentPaymentTarget | null
  /** The amount the dialog opens with (a row's remaining, the overdue). */
  initialAmount?: number
  onSaved: () => void
  /** A refusal that means the contract changed meanwhile: the page
   *  refetches. */
  onStale?: () => void
}) {
  const { t } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const formRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<InstallmentPaymentFormValues>({
    contract_id: '',
    amount: '',
    paid_on: today,
    method: 'transfer',
    reference: '',
    note: '',
  })
  const [picked, setPicked] = useState<AsyncSearchSelectOption | null>(null)
  const [context, setContext] = useState<ContextState>({ status: 'idle' })
  const [contextKey, setContextKey] = useState(0)
  // The amount follows the contract's next installment until the user
  // types one (or the dialog was opened with one).
  const amountTouched = useRef(false)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  // A fresh form each time the dialog opens.
  useEffect(() => {
    if (!open) return
    amountTouched.current = initialAmount !== undefined
    setValues({
      contract_id: contract?.id ?? '',
      amount: initialAmount !== undefined ? amountInputText(initialAmount) : '',
      paid_on: today,
      method: 'transfer',
      reference: '',
      note: '',
    })
    setPicked(null)
    setContext({ status: 'idle' })
    setErrors({})
    setFormError(null)
    setSaving(false)
    // Only the opening resets the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const contractId = values.contract_id
  useEffect(() => {
    if (!open || !contractId) return
    const controller = new AbortController()
    setContext({ status: 'loading' })
    fetchInstallmentPaymentContext(contractId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        if (!data) {
          setContext({ status: 'gone' })
          return
        }
        setContext({ status: 'ready', ...data })
        if (!amountTouched.current)
          setValues((current) => ({
            ...current,
            amount: amountInputText(data.contract.next_due_amount),
          }))
      })
      .catch(() => {
        if (!controller.signal.aborted) setContext({ status: 'failed' })
      })
    return () => controller.abort()
  }, [open, contractId, contextKey])

  const set = <K extends keyof InstallmentPaymentFormValues>(
    key: K,
    value: InstallmentPaymentFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => clearFieldErrors(current, [key]))
  }
  const errorOf = (key: keyof InstallmentPaymentFormValues) => {
    const message = errors[key]
    return message ? t(message) : undefined
  }
  const setAmount = (value: string) => {
    amountTouched.current = true
    set('amount', value)
  }

  const ready = context.status === 'ready' ? context : null
  const remaining = ready ? amountOf(ready.contract.remaining_total) : 0
  // The view counts the late rows of a closed contract too.
  const overdue =
    ready && ready.contract.status === 'active'
      ? amountOf(ready.contract.overdue_amount)
      : 0
  const nextDue = ready ? ready.contract.next_due_amount : null

  const parsed = parseInstallmentAmount(values.amount)
  const allocations =
    ready && parsed
      ? allocatePayment(
          ready.schedule.map((row) => ({
            id: row.id,
            seq: row.seq,
            dueDate: row.due_date,
            amount: amountOf(row.amount),
            paidAmount: amountOf(row.paid_amount),
          })),
          parsed,
        )
      : null
  const rowOf = new Map(ready?.schedule.map((row) => [row.id, row]))

  const quick: { key: string; label: string; value: number }[] = ready
    ? [
        ...(nextDue !== null && amountOf(nextDue) > 0
          ? [
              {
                key: 'next',
                label: t('instPayQuickNext'),
                value: amountOf(nextDue),
              },
            ]
          : []),
        ...(overdue > 0
          ? [
              {
                key: 'overdue',
                label: t('instPayQuickOverdue'),
                value: overdue,
              },
            ]
          : []),
        ...(remaining > 0
          ? [
              {
                key: 'remaining',
                label: t('instPayQuickRemaining'),
                value: remaining,
              },
            ]
          : []),
      ]
    : []

  const submit = async () => {
    if (saving) return
    const found = validateWithSchema<InstallmentPaymentFormValues>(
      installmentPaymentFormSchema(today),
      values,
    )
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) {
      focusFirstError(found, INSTALLMENT_PAYMENT_FIELD_ORDER, {
        root: formRef.current,
      })
      return
    }
    const amount = parseInstallmentAmount(values.amount)
    if (amount === null) return
    setSaving(true)
    const result = await recordInstallmentPayment({
      contractId: values.contract_id,
      paidOn: values.paid_on,
      amount,
      method: values.method as InstallmentPaymentMethod,
      reference: values.reference,
      note: values.note,
    })
    setSaving(false)
    if (result.error) {
      const attributed = installmentFieldError(
        result.error,
        INSTALLMENT_PAYMENT_TOKEN_FIELDS,
      )
      if (attributed) {
        const next: Errors = { [attributed.field]: attributed.key }
        setErrors(next)
        focusFirstError(next, INSTALLMENT_PAYMENT_FIELD_ORDER, {
          root: formRef.current,
        })
      } else setFormError(installmentErrorMessage(result.error))
      const token = installmentErrorToken(result.error)
      if (
        token &&
        (token === 'payment_exceeds_balance' ||
          INSTALLMENT_STALE_TOKENS.has(token))
      ) {
        // What the dialog shows is out of date: read the contract again.
        setContextKey((key) => key + 1)
        onStale?.()
      }
      return
    }
    onSaved()
  }

  const title = ready?.contract ?? contract
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={t('instPayTitle')}
      description={
        title ? (
          <span>
            <bdi dir="ltr">{title.contract_number}</bdi> · {title.description} ·{' '}
            {title.financier_name}
          </span>
        ) : (
          t('instPayPickHint')
        )
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
          <Button variant="primary" loading={saving} onClick={submit}>
            {t('instPaySave')}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="space-y-4">
        {formError && <Notice tone="danger">{t(formError)}</Notice>}
        {!contract && (
          <Field
            name="contract_id"
            label={t('instContract')}
            required
            error={errorOf('contract_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                size="md"
                placeholder={t('instPayPickContract')}
                value={values.contract_id}
                selectedOption={picked}
                onChange={(value, option) => {
                  amountTouched.current = false
                  setPicked(option)
                  setContext({ status: 'idle' })
                  setValues((current) => ({
                    ...current,
                    contract_id: value,
                    amount: '',
                  }))
                  setErrors({})
                }}
                loadOptions={loadActiveContractOptions}
              />
            )}
          </Field>
        )}
        {context.status === 'loading' && (
          <div className="grid grid-cols-2 gap-2" aria-busy="true">
            <span className="sr-only" role="status">
              {t('loading')}
            </span>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}
        {context.status === 'failed' && (
          <Notice
            tone="danger"
            size="compact"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setContextKey((key) => key + 1)}
              >
                {t('retry')}
              </Button>
            }
          >
            {t('instPayContextLoadError')}
          </Notice>
        )}
        {context.status === 'gone' && (
          <Notice tone="danger" size="compact">
            {t('instErrContract')}
          </Notice>
        )}
        {ready && ready.contract.status !== 'active' && (
          <Notice tone="warning" size="compact">
            {t('instErrContractNotActive')}
          </Notice>
        )}
        {ready && (
          <div className="grid grid-cols-2 gap-2">
            <PreviewStat
              label={t('instRemaining')}
              value={<Money value={remaining} />}
            />
            <PreviewStat
              label={t('instOverdueAmount')}
              value={
                <Money
                  value={overdue}
                  className={overdue > 0 ? 'text-danger' : undefined}
                />
              }
            />
          </div>
        )}
        <Field
          name="amount"
          label={t('instPayAmount')}
          required
          error={errorOf('amount')}
          hint={<AmountHint value={values.amount} />}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="decimal"
              value={values.amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quick.map((item) => (
              <Button
                key={item.key}
                size="sm"
                variant="outline"
                onClick={() => setAmount(amountInputText(item.value))}
              >
                {item.label} <Money value={item.value} />
              </Button>
            ))}
          </div>
        )}
        {/* Which installments the amount covers, the oldest first. */}
        {allocations && allocations.length > 0 && (
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <p className="mb-1 font-medium">{t('instPayAllocatesTo')}</p>
            <ul className="space-y-0.5 text-muted">
              {allocations.slice(0, 6).map((item) => {
                const row = rowOf.get(item.id)
                const full =
                  row &&
                  toHalalas(item.amount) === toHalalas(scheduleRemaining(row))
                return (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>
                      {t('instInstallmentN').replace(
                        '{seq}',
                        String(row?.seq ?? ''),
                      )}{' '}
                      ·{' '}
                      <bdi dir="ltr">{row ? formatDate(row.due_date) : ''}</bdi>
                      {full ? '' : ` · ${t('instPartlyPaid')}`}
                    </span>
                    <Money value={item.amount} />
                  </li>
                )
              })}
              {allocations.length > 6 && (
                <li>
                  {t('instMoreRows').replace(
                    '{count}',
                    String(allocations.length - 6),
                  )}
                </li>
              )}
            </ul>
          </div>
        )}
        {ready && parsed !== null && parsed > 0 && allocations === null && (
          <p className="text-xs text-danger">
            {t('instErrPaymentExceedsBalance')}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="paid_on"
            label={t('instPayDate')}
            required
            error={errorOf('paid_on')}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={values.paid_on}
                max={today}
                onChange={(value) => set('paid_on', value)}
              />
            )}
          </Field>
          <Field
            name="method"
            label={t('instPayMethod')}
            required
            error={errorOf('method')}
          >
            {(control) => (
              <Select
                {...control}
                value={values.method}
                onValueChange={(value) => set('method', value)}
                options={INSTALLMENT_PAYMENT_METHODS.map((value) => ({
                  value,
                  label: t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[value]),
                }))}
              />
            )}
          </Field>
        </div>
        <Field
          name="reference"
          label={<OptionalLabel text={t('instPayReference')} />}
          error={errorOf('reference')}
          hint={t('instPayReferenceHint')}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              maxLength={INSTALLMENT_PAYMENT_REFERENCE_MAX}
              value={values.reference}
              onChange={(event) => set('reference', event.target.value)}
            />
          )}
        </Field>
        <Field
          name="note"
          label={<OptionalLabel text={t('instPayNote')} />}
          error={errorOf('note')}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={INSTALLMENT_PAYMENT_NOTE_MAX}
              value={values.note}
              onChange={(event) => set('note', event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
