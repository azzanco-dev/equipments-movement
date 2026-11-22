import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  formatInstallmentAmount,
  INSTALLMENT_ERROR_KEYS,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  type InstallmentFrequency,
} from '@/lib/installments'
import {
  buildInstallmentPlan,
  planInputOf,
  type InstallmentContractFormValues,
} from '@/lib/installmentPlan'
import { installmentsWords } from '@/lib/installmentsView'
import { Money, PeriodRange } from './cells'

function Line({
  title,
  state,
  sub,
  amount,
}: {
  title: ReactNode
  state?: ReactNode
  sub?: ReactNode
  amount: number
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">
          <span className="min-w-0 break-words">{title}</span>
          {state}
        </p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      <Money value={amount} className="text-sm font-bold" />
    </li>
  )
}

/**
 * The body of «حسبة العقد» (owner 2026-11-22): what the database will store
 * for the typed values, as they are typed (`buildInstallmentPlan` mirrors
 * it) — the total with its VAT, each first payment with its state, what is
 * left to divide, the VAT row, then the installment, the last and the term.
 */
export function InstallmentPlanSummary({
  values,
}: {
  values: InstallmentContractFormValues
}) {
  const { t, lang } = useI18n()
  const planned = planInputOf(values)
  if (!planned)
    return <p className="text-sm text-muted">{t('instCalcEmpty')}</p>
  const { plan, error } = buildInstallmentPlan(planned.input)
  if (!plan)
    return (
      <p className="text-sm text-danger">{t(INSTALLMENT_ERROR_KEYS[error])}</p>
    )

  const exclusive = values.vat_mode === 'exclusive'
  const each = exclusive && values.vat_timing === 'each'
  const money = formatInstallmentAmount
  const split = (base: number, vat: number) =>
    exclusive
      ? [
          t('instBeforeVat').replace('{amount}', money(base)),
          ...(each ? [t('instVatPart').replace('{amount}', money(vat))] : []),
        ].join(' · ')
      : undefined
  const count = planned.input.installmentCount
  const last = plan.rows[plan.rows.length - 1]

  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-muted">
          {t(exclusive ? 'instCalcTotalWithVat' : 'instContractTotal')}
        </p>
        <Money value={plan.payable} className="text-2xl font-bold" />
        {exclusive && (
          <p className="text-xs text-muted">
            {t('instBeforeVat').replace('{amount}', money(plan.total))} ·{' '}
            {t('instVatPart').replace('{amount}', money(plan.vat))}
          </p>
        )}
      </div>
      <ul className="divide-y">
        {plan.prepaid > 0 && (
          <Line title={t('instDownPayment')} amount={plan.prepaid} />
        )}
        {plan.payments.map((payment, index) => {
          const row = values.payments[planned.rowIndexes[index]]
          const paid = row.settled || (row.paid && row.lockedAmount === null)
          return (
            <Line
              key={row.key}
              title={row.title || t('instFirstPayment')}
              amount={payment.amount}
              sub={split(payment.base, payment.vat)}
              state={
                paid ? (
                  <span className="text-xs font-normal text-success">
                    {t('instFpPaid')}
                  </span>
                ) : row.date ? (
                  <bdi dir="ltr" className="text-xs font-normal text-muted">
                    {formatDate(row.date)}
                  </bdi>
                ) : (
                  <span className="text-xs font-normal text-warning">
                    {t('instFpWaitsDate')}
                  </span>
                )
              }
            />
          )
        })}
        <Line
          title={t('instCalcLeft')}
          amount={plan.installments.amount}
          sub={split(plan.installments.base, plan.installments.vat)}
        />
        {exclusive && values.vat_timing === 'end' && (
          <Line
            title={t('instVatPayment')}
            amount={plan.vat}
            state={
              <span className="text-xs font-normal text-info">
                {t('instVatAtEndShort')}
              </span>
            }
            sub={
              values.vat_due_date ? (
                <bdi dir="ltr">{formatDate(values.vat_due_date)}</bdi>
              ) : (
                t('instWithLast')
              )
            }
          />
        )}
      </ul>
      <dl className="space-y-2 rounded-xl border p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted">
            {planned.input.frequencyMonths === 1
              ? t('instCalcOnMonths').replace('{count}', String(count))
              : `${t('instCalcOn').replace(
                  '{installments}',
                  installmentsWords(count, lang),
                )} · ${t(
                  INSTALLMENT_FREQUENCY_LABEL_KEYS[
                    planned.input.frequencyMonths as InstallmentFrequency
                  ],
                )}`}
          </dt>
          <dd>
            <Money value={plan.regular} className="text-base font-bold" />
          </dd>
        </div>
        {plan.lastRegular !== plan.regular && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">{t('instCalcLast')}</dt>
            <dd>
              <Money value={plan.lastRegular} />
            </dd>
          </div>
        )}
        {plan.balloon > 0 && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">{t('instBalloon')}</dt>
            <dd>
              <Money value={plan.balloon} />
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted">{t('instTerm')}</dt>
          <dd>
            {plan.rows[0].dueDate ? (
              <PeriodRange from={plan.rows[0].dueDate} to={last.dueDate} />
            ) : (
              <span className="text-warning">{t('instAwaitingFirstDue')}</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}
