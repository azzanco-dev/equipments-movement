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
  installmentErrorMessage,
  toHalalas,
  INSTALLMENT_PAYMENT_METHODS,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  INSTALLMENT_PAYMENT_NOTE_MAX,
  INSTALLMENT_PAYMENT_REFERENCE_MAX,
  type InstallmentPaymentMethod,
} from '@/lib/installments'
import { allocateToRows } from '@/lib/installmentPlan'
import {
  fetchInstallmentPaymentContext,
  loadActiveContractOptions,
  recordInstallmentPayment,
} from '@/lib/installmentsData'
import {
  amountInputText,
  amountOf,
  installmentAccountOf,
  installmentErrorToken,
  installmentFieldError,
  isAwaitingFirstDue,
  parseInstallmentAmount,
  payableRowLabel,
  scheduleRemaining,
  INSTALLMENT_PAYMENT_FIELD_ORDER,
  INSTALLMENT_PAYMENT_TOKEN_FIELDS,
  INSTALLMENT_STALE_TOKENS,
  type InstallmentContractRow,
  type InstallmentPaymentFormValues,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { BankAccountLine } from './BankAccountFields'
import { saudiDateKey } from '@/lib/saudiTime'
import { attachInstallmentReceipt, InstallmentReceiptError } from '@/lib/installmentReceiptsData'
import { AmountHint, Money, OptionalLabel, PreviewStat } from './cells'
import { ReceiptPicker } from './InstallmentReceipt'

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
 * amount with its quick choices and the «يوزع على» preview (`allocateToRows`
 * mirrors the database's allocation: the chosen row — a first payment, the
 * VAT, 0209 —, then the oldest unpaid rows), the day (not
 * after the Saudi today), the method, a reference and a note. Saved through
 * `record_installment_payment` (`installments.manage`), which decides.
 */
export function InstallmentPaymentDialog({
  open,
  onOpenChange,
  contract = null,
  initialAmount,
  targetId,
  onSaved,
  onStale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The contract paid; null = the user picks one. */
  contract?: InstallmentPaymentTarget | null
  /** The amount the dialog opens with (a row's remaining, the overdue). */
  initialAmount?: number
  /** The row paid first: a first payment or the VAT row (0209). */
  targetId?: string
  /** The payment is saved; `receiptError` names why its receipt (when one
   *  was picked) could not be attached — the payment stays, and the receipt
   *  can be attached later from its card. */
  onSaved: (outcome: { receiptError: TranslationKey | null }) => void
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
  const [target, setTarget] = useState<string | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<File | null>(null)
  const [receiptError, setReceiptError] = useState<TranslationKey | null>(null)

  // A fresh form each time the dialog opens.
  useEffect(() => {
    if (!open) return
    amountTouched.current = initialAmount !== undefined
    setTarget(targetId ?? null)
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
    setReceipt(null)
    setReceiptError(null)
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
  // Before the division only the rows that exist can be paid.
  const awaiting = !!ready && isAwaitingFirstDue(ready.contract)
  const openRows = (ready?.schedule ?? []).filter(
    (row) => scheduleRemaining(row) > 0,
  )
  const chosen = target ? openRows.find((row) => row.id === target) : undefined
  // The row the dialog was opened on is no longer open: nothing is paid in
  // its place unless the user picks another amount button.
  const targetGone = !!ready && !!target && !chosen

  const parsed = parseInstallmentAmount(values.amount)
  const allocations =
    ready && parsed
      ? allocateToRows(ready.schedule, parsed, target)
      : null

  const nextRow = openRows.find((row) => row.id === ready?.contract.next_due_id)
  // The row the dialog opened on, the next due, and the payments without a
  // day: each by its name.
  const rowChoices = [
    ...(chosen ? [chosen] : nextRow ? [nextRow] : []),
    ...(awaiting || !nextRow
      ? openRows.filter((row) => row.kind === 'first_payment' && !row.due_date)
      : []),
  ].filter((row, index, rows) => rows.indexOf(row) === index)
  const quick: {
    key: string
    label: string
    value: number
    target: string | null
  }[] = [
    ...rowChoices.map((row) => ({
      key: row.id,
      label:
        row.kind === 'installment'
          ? t('instPayQuickNext')
          : payableRowLabel(row, t),
      value: scheduleRemaining(row),
      target: row.kind === 'installment' ? null : row.id,
    })),
    ...(overdue > 0
      ? [
          {
            key: 'overdue',
            label: t('instPayQuickOverdue'),
            value: overdue,
            target: null,
          },
        ]
      : []),
    ...(!awaiting && remaining > 0
      ? [
          {
            key: 'remaining',
            label: t('instPayQuickRemaining'),
            value: remaining,
            target: null,
          },
        ]
      : []),
  ]

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
    if (receiptError) return
    // Never before the rows are known, never on a row that is gone.
    if (!ready || targetGone) return
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
      scheduleId: target,
    })
    if (result.error) {
      setSaving(false)
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
    // The payment is saved: its receipt goes up now. A failed upload never
    // undoes the payment.
    let failed: TranslationKey | null = null
    if (receipt && result.data) {
      try {
        await attachInstallmentReceipt(values.contract_id, result.data, receipt)
      } catch (error) {
        failed =
          error instanceof InstallmentReceiptError
            ? error.key
            : 'instReceiptSaveFailed'
      }
    }
    setSaving(false)
    onSaved({ receiptError: failed })
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
          <Button
            variant="primary"
            loading={saving}
            disabled={targetGone || (!!values.contract_id && !ready)}
            onClick={submit}
          >
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
                  setTarget(null)
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
            {overdue > 0 ? (
              <PreviewStat
                label={t('instOverdueAmount')}
                value={<Money value={overdue} className="text-danger" />}
              />
            ) : (
              <PreviewStat
                label={t('instNextDue')}
                value={nextDue === null ? '—' : <Money value={nextDue} />}
              />
            )}
          </div>
        )}
        {/* 0208: where the money goes, with a copy button, so the IBAN is
            never typed by hand. */}
        {ready && (
          <div className="space-y-1 rounded-xl border bg-surface p-3">
            <p className="text-xs text-muted">{t('instPayToAccount')}</p>
            <BankAccountLine account={installmentAccountOf(ready.contract)} />
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
                onClick={() => {
                  setTarget(item.target)
                  setAmount(amountInputText(item.value))
                }}
              >
                {item.label} <Money value={item.value} />
              </Button>
            ))}
          </div>
        )}
        {/* What the amount covers: the chosen row, then the oldest. */}
        {targetGone && (
          <Notice tone="warning" size="compact">
            {t('instErrScheduleRow')}
          </Notice>
        )}
        {!targetGone && allocations && allocations.length > 0 && (
          <div className="rounded-lg border bg-surface p-3 text-xs">
            <p className="mb-1 font-medium">{t('instPayAllocatesTo')}</p>
            <ul className="space-y-0.5 text-muted">
              {allocations.slice(0, 6).map(({ row, amount }) => {
                const full =
                  toHalalas(amount) === toHalalas(scheduleRemaining(row))
                return (
                  <li key={row.id} className="flex justify-between gap-2">
                    <span>
                      {payableRowLabel(row, t)}
                      {row.due_date && (
                        <>
                          {' · '}
                          <bdi dir="ltr">{formatDate(row.due_date)}</bdi>
                        </>
                      )}
                      {full ? '' : ` · ${t('instPartlyPaid')}`}
                    </span>
                    <Money value={amount} />
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
        {ready && !targetGone && parsed !== null && parsed > 0 && allocations === null && (
          <p className="text-xs text-danger">
            {t(
              awaiting && parsed <= remaining
                ? 'instErrNotScheduled'
                : 'instErrPaymentExceedsBalance',
            )}
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
        <ReceiptPicker
          file={receipt}
          disabled={saving}
          error={receiptError ? t(receiptError) : undefined}
          onChange={(file, error) => {
            setReceipt(file)
            setReceiptError(error)
          }}
        />
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
