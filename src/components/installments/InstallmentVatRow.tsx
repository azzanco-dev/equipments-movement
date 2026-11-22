import { useState } from 'react'
import { DatePicker, Input, Select, Switch, cn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import type { FieldErrors } from '@/lib/formValidation'
import {
  fromHalalas,
  toHalalas,
  INSTALLMENT_PAYMENT_METHODS,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  type InstallmentPaymentMethod,
} from '@/lib/installments'
import {
  vatInsideHalalas,
  INSTALLMENT_FIRST_PAYMENT_NOTE_MAX,
  INSTALLMENT_FIRST_PAYMENT_TITLE_MAX,
  INSTALLMENT_VAT_DUES,
  INSTALLMENT_VAT_DUE_LABEL_KEYS,
  type InstallmentContractFormValues,
  type InstallmentVatDue,
} from '@/lib/installmentPlan'
import {
  amountInputText,
  parseInstallmentAmount,
} from '@/lib/installmentsView'

type Values = InstallmentContractFormValues

/**
 * The row of «دفعة لحالها» (owner 2026-11-22, the approved drawing «سطر
 * دفعة الضريبة»): a row like the first payments, without a bin — its name,
 * its amount worked out of the typed total until it is changed, when it is
 * due, a note and «مدفوعة», which hides the planned day and asks the day and
 * the method of the payment.
 */
export function InstallmentVatRow({
  values,
  onChange,
  errors,
  today,
  amountFixed,
  hasMoney,
  settled,
  disabled,
}: {
  values: Values
  onChange: (patch: Partial<Values>) => void
  errors: FieldErrors<Values>
  today: string
  /** Money on an installment or on this row: the amount stays. */
  amountFixed: boolean
  hasMoney: boolean
  /** Fully paid: its day stays too. */
  settled: boolean
  disabled?: boolean
}) {
  const { t } = useI18n()
  // While they are typed: an emptied field must stay empty.
  const [title, setTitle] = useState<string | null>(null)
  const [amount, setAmount] = useState<string | null>(null)

  const total = parseInstallmentAmount(values.total_amount)
  const automatic = total
    ? amountInputText(fromHalalas(vatInsideHalalas(toHalalas(total))))
    : ''
  const usualTitle = t('instVatPayment')
  const paidNow = values.vat_paid && !hasMoney
  const showDue = !paidNow && !settled
  const showDate = showDue && values.vat_due === 'date'
  const error: TranslationKey | undefined =
    errors.vat_amount ?? errors.vat_due_date ?? errors.vat_paid_on
  const label = (key: TranslationKey) => (
    <span className="block text-xs text-muted">{t(key)}</span>
  )

  return (
    <div
      className={cn(
        'space-y-2 rounded-xl border bg-bg p-3',
        error && 'border-danger',
      )}
    >
      <div
        className={cn(
          'grid grid-cols-2 items-end gap-2 sm:grid-cols-3',
          paidNow || showDate
            ? '2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]'
            : '2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)]',
        )}
      >
        <label className="min-w-0 space-y-1 sm:col-span-3 2xl:col-span-1">
          {label('instFpTitle')}
          <Input
            disabled={disabled}
            maxLength={INSTALLMENT_FIRST_PAYMENT_TITLE_MAX}
            value={title ?? (values.vat_title || usualTitle)}
            onFocus={() => setTitle(values.vat_title || usualTitle)}
            onBlur={() => setTitle(null)}
            onChange={(event) => {
              const text = event.target.value
              setTitle(text)
              onChange({ vat_title: text === usualTitle ? '' : text })
            }}
          />
        </label>
        <label data-field="vat_amount" className="min-w-0 space-y-1">
          {label('instAmount')}
          <Input
            dir="ltr"
            inputMode="decimal"
            disabled={disabled || amountFixed}
            invalid={!!errors.vat_amount}
            value={amount ?? (values.vat_amount || automatic)}
            onFocus={() => setAmount(values.vat_amount || automatic)}
            onBlur={() => setAmount(null)}
            onChange={(event) => {
              const text = event.target.value
              setAmount(text)
              // The worked-out amount again, however it is written, = follows
              // the total again.
              const typed = parseInstallmentAmount(text)
              const same =
                typed !== null &&
                !!automatic &&
                toHalalas(typed) === toHalalas(Number(automatic))
              onChange({ vat_amount: same ? '' : text })
            }}
          />
        </label>
        {showDue && (
          <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
            {label('instVatDueLabel')}
            <Select
              aria-label={t('instVatDueLabel')}
              disabled={disabled}
              value={values.vat_due}
              onValueChange={(due) =>
                onChange({ vat_due: due as InstallmentVatDue })
              }
              options={INSTALLMENT_VAT_DUES.map((due) => ({
                value: due,
                label: t(INSTALLMENT_VAT_DUE_LABEL_KEYS[due]),
              }))}
            />
          </div>
        )}
        {showDate && (
          <div
            data-field="vat_due_date"
            className="col-span-2 min-w-0 space-y-1 sm:col-span-1"
          >
            {label('instVatDateShort')}
            <DatePicker
              aria-label={t('instVatDateShort')}
              disabled={disabled}
              invalid={!!errors.vat_due_date}
              value={values.vat_due_date}
              onChange={(day) => onChange({ vat_due_date: day })}
            />
          </div>
        )}
        {paidNow && (
          <>
            <div data-field="vat_paid_on" className="min-w-0 space-y-1">
              {label('instPayDate')}
              <DatePicker
                aria-label={t('instPayDate')}
                disabled={disabled}
                max={today}
                invalid={!!errors.vat_paid_on}
                value={values.vat_paid_on}
                onChange={(day) => onChange({ vat_paid_on: day })}
              />
            </div>
            <div className="min-w-0 space-y-1">
              {label('instVatMethod')}
              <Select
                aria-label={t('instPayMethod')}
                disabled={disabled}
                value={values.vat_method}
                onValueChange={(method) =>
                  onChange({ vat_method: method as InstallmentPaymentMethod })
                }
                options={INSTALLMENT_PAYMENT_METHODS.map((method) => ({
                  value: method,
                  label: t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[method]),
                }))}
              />
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          className="w-full sm:w-auto sm:min-w-40 sm:flex-1"
          aria-label={t('instFpNote')}
          placeholder={t('instFpNote')}
          disabled={disabled}
          maxLength={INSTALLMENT_FIRST_PAYMENT_NOTE_MAX}
          value={values.vat_note}
          onChange={(event) => onChange({ vat_note: event.target.value })}
        />
        <span className="ms-auto">
          <Switch
            label={t(hasMoney && !settled ? 'instFpPartPaid' : 'instFpPaid')}
            disabled={disabled || hasMoney}
            checked={hasMoney ? settled : values.vat_paid}
            onCheckedChange={(paid) =>
              onChange({
                vat_paid: paid,
                // The planned day is hidden, never lost.
                vat_paid_on: paid
                  ? values.vat_due === 'date' &&
                    values.vat_due_date &&
                    values.vat_due_date <= today
                    ? values.vat_due_date
                    : today
                  : '',
              })
            }
          />
        </span>
      </div>
      {!amountFixed && (
        <p className="text-xs text-muted">{t('instVatRowHint')}</p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  )
}
