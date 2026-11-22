import { Plus, Trash2 } from 'lucide-react'
import {
  Button,
  DatePicker,
  IconButton,
  Input,
  Select,
  Switch,
  cn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { firstPaymentRowError } from '@/lib/formValidation'
import {
  fromHalalas,
  toHalalas,
  INSTALLMENT_PAYMENT_METHODS,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  type InstallmentPaymentMethod,
} from '@/lib/installments'
import {
  firstPaymentDefaultTitle,
  firstPaymentPlanValue,
  firstPaymentValue,
  newFirstPaymentRow,
  rateHalalas,
  withVatHalalas,
  INSTALLMENT_FIRST_PAYMENTS_MAX,
  INSTALLMENT_FIRST_PAYMENT_NOTE_MAX,
  INSTALLMENT_FIRST_PAYMENT_TITLE_MAX,
  type FirstPaymentFormRow,
  type FirstPaymentValueKind,
  type InstallmentVatTiming,
} from '@/lib/installmentPlan'
import { Money } from './cells'

/** What a row will ask for, with its VAT when it carries one. */
function rowAmount(
  row: FirstPaymentFormRow,
  total: number | null,
  timing: InstallmentVatTiming | null,
): number | null {
  if (row.lockedAmount !== null) return row.lockedAmount
  const value = firstPaymentValue(row)
  if (!value) return null
  if (value.rate !== null && !total) return null
  const base =
    value.rate !== null
      ? rateHalalas(toHalalas(total as number), value.rate)
      : toHalalas(value.amount as number)
  return fromHalalas(withVatHalalas(base, timing))
}

/**
 * «الدفعات الاولى» (owner 2026-11-22, «خليها نفس فكرة اضافة التسعيرات في
 * نموذج عروض الاسعار»): one bordered row per payment — its name, an amount
 * or a percentage, its day, a note, «مدفوعة» —, «اضافة دفعة» under them and
 * a bin on each. A row with money on it keeps its amount and stays.
 */
export function InstallmentFirstPayments({
  rows,
  onChange,
  total,
  timing,
  today,
  termsLocked,
  showErrors,
  disabled,
}: {
  rows: readonly FirstPaymentFormRow[]
  onChange: (rows: FirstPaymentFormRow[]) => void
  /** The typed contract total, for a percentage. */
  total: number | null
  timing: InstallmentVatTiming | null
  today: string
  /** An installment has money: what is divided is fixed. */
  termsLocked: boolean
  showErrors: boolean
  disabled?: boolean
}) {
  const { t } = useI18n()

  const patch = (key: string, values: Partial<FirstPaymentFormRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...values } : row)))

  const add = () => {
    const taken = new Set(rows.map((row) => row.title.trim()))
    let index = 0
    while (taken.has(firstPaymentDefaultTitle(index, t))) index += 1
    onChange([
      ...rows,
      newFirstPaymentRow(
        crypto.randomUUID(),
        firstPaymentDefaultTitle(index, t),
      ),
    ])
  }

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const hasMoney = row.lockedAmount !== null
            const valueFixed = disabled || hasMoney || termsLocked
            const paidNow = row.paid && !hasMoney
            const error = showErrors ? firstPaymentRowError(row, today) : null
            const amount = rowAmount(row, total, timing)
            // A paid percentage stays the amount it was paid as when the
            // total changes: the row then shows that amount.
            const kept = hasMoney ? firstPaymentPlanValue(row, total) : null
            const asAmount = row.kind === 'rate' && kept?.amount != null
            const kind = asAmount ? 'amount' : row.kind
            return (
              <li
                key={row.key}
                className={cn(
                  'relative space-y-2 rounded-xl border bg-bg p-3',
                  error && 'border-danger',
                )}
              >
                <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)] 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                  <label className="col-span-2 min-w-0 space-y-1 pe-11 sm:col-span-3 2xl:col-span-1 2xl:pe-0">
                    <span className="block text-xs text-muted">
                      {t('instFpTitle')}
                    </span>
                    <Input
                      disabled={disabled}
                      maxLength={INSTALLMENT_FIRST_PAYMENT_TITLE_MAX}
                      value={row.title}
                      onChange={(event) =>
                        patch(row.key, { title: event.target.value })
                      }
                    />
                  </label>
                  <div className="min-w-0 space-y-1">
                    <span className="block text-xs text-muted">
                      {t('instFpKind')}
                    </span>
                    <Select
                      aria-label={t('instFpKind')}
                      disabled={valueFixed}
                      value={kind}
                      onValueChange={(kind) =>
                        patch(row.key, {
                          kind: kind as FirstPaymentValueKind,
                          value: '',
                        })
                      }
                      options={[
                        { value: 'amount', label: t('instFpKindAmount') },
                        { value: 'rate', label: t('instFpKindRate') },
                      ]}
                    />
                  </div>
                  <label className="min-w-0 space-y-1">
                    <span className="block text-xs text-muted">
                      {t(kind === 'rate' ? 'instFpRate' : 'instAmount')}
                    </span>
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      disabled={valueFixed}
                      value={asAmount ? String(kept?.amount) : row.value}
                      onChange={(event) =>
                        patch(row.key, { value: event.target.value })
                      }
                    />
                  </label>
                  <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                    <span className="block text-xs text-muted">
                      {t(paidNow ? 'instPayDate' : 'instFpDate')}
                    </span>
                    <DatePicker
                      aria-label={t(paidNow ? 'instPayDate' : 'instFpDate')}
                      disabled={disabled || row.settled}
                      max={paidNow ? today : undefined}
                      placeholder={t('instFpNoDate')}
                      value={paidNow ? row.paidOn : row.date}
                      onChange={(day) =>
                        patch(row.key, paidNow ? { paidOn: day } : { date: day })
                      }
                    />
                  </div>
                  <IconButton
                    variant="ghost"
                    label={t('instFpRemove')}
                    className="absolute end-3 top-8 2xl:static"
                    icon={<Trash2 size={15} aria-hidden="true" />}
                    disabled={valueFixed}
                    onClick={() =>
                      onChange(rows.filter((other) => other.key !== row.key))
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Input
                    className="w-full sm:w-auto sm:min-w-40 sm:flex-1"
                    aria-label={t('instFpNote')}
                    placeholder={t('instFpNote')}
                    disabled={disabled}
                    maxLength={INSTALLMENT_FIRST_PAYMENT_NOTE_MAX}
                    value={row.note}
                    onChange={(event) =>
                      patch(row.key, { note: event.target.value })
                    }
                  />
                  {paidNow && (
                    <Select
                      className="w-auto min-w-28"
                      aria-label={t('instPayMethod')}
                      disabled={disabled}
                      value={row.method}
                      onValueChange={(method) =>
                        patch(row.key, {
                          method: method as InstallmentPaymentMethod,
                        })
                      }
                      options={INSTALLMENT_PAYMENT_METHODS.map((method) => ({
                        value: method,
                        label: t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[method]),
                      }))}
                    />
                  )}
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {t('instFpDue')}
                    {amount === null ? (
                      '—'
                    ) : (
                      <Money
                        value={amount}
                        className="text-sm font-bold text-fg"
                      />
                    )}
                  </span>
                  <span className="ms-auto">
                    <Switch
                      label={t(
                        hasMoney && !row.settled
                          ? 'instFpPartPaid'
                          : 'instFpPaid',
                      )}
                      disabled={disabled || hasMoney}
                      checked={hasMoney ? row.settled : row.paid}
                      onCheckedChange={(paid) =>
                        patch(row.key, {
                          paid,
                          // The day it was paid: the agreed day when that
                          // has come, else today. The agreed day stays.
                          paidOn: paid
                            ? row.date && row.date <= today
                              ? row.date
                              : today
                            : '',
                        })
                      }
                    />
                  </span>
                </div>
                {error && (
                  <p className="text-xs text-danger" role="alert">
                    {t(error)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!termsLocked && rows.length < INSTALLMENT_FIRST_PAYMENTS_MAX && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={add}
        >
          {t('instFpAdd')}
        </Button>
      )}
    </div>
  )
}
