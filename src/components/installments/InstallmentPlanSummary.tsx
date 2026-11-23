import type { ReactNode } from 'react'
import { Badge } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  formatInstallmentAmount,
  INSTALLMENT_ERROR_KEYS,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  type InstallmentFrequency,
} from '@/lib/installments'
import {
  buildInstallmentPlan,
  firstPaymentPlanValue,
  planInputOf,
  rateBaseOf,
  type InstallmentContractFormValues,
} from '@/lib/installmentPlan'
import {
  installmentsWords,
  parseInstallmentAmount,
} from '@/lib/installmentsView'
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
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">
          <span className="min-w-0 break-words">{title}</span>
          {state}
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      <Money value={amount} className="text-sm font-bold" />
    </li>
  )
}

/**
 * The body of «حسبة العقد» (owner 2026-11-22, «يكفي في العرض الجانبي»): what
 * the database will store for the typed values, as they are typed
 * (`buildInstallmentPlan` mirrors it) — the one typed total with what of it
 * is VAT, each first payment, a VAT paid by itself, what is left to divide,
 * then the installment, the last and the term.
 */
export function InstallmentPlanSummary({
  values,
  vatSettled = false,
}: {
  values: InstallmentContractFormValues
  /** The stored VAT row is fully paid. */
  vatSettled?: boolean
}) {
  const { t, lang } = useI18n()
  if (!values.vat_mode)
    return (
      <p className="rounded-xl bg-surface p-3 text-xs text-muted">
        {t('instCalcPickVat')}
      </p>
    )
  const planned = planInputOf(values)
  if (!planned) {
    const badVat =
      values.vat_mode === 'separate' &&
      !!values.vat_amount.trim() &&
      parseInstallmentAmount(values.vat_amount) === null
    return (
      <p className={badVat ? 'text-sm text-danger' : 'text-sm text-muted'}>
        {t(badVat ? 'instErrVatAmount' : 'instCalcEmpty')}
      </p>
    )
  }
  const { plan, error } = buildInstallmentPlan(planned.input)
  if (!plan)
    return (
      <p className="text-sm text-danger">{t(INSTALLMENT_ERROR_KEYS[error])}</p>
    )

  const inside = values.vat_mode === 'inside'
  const separate = values.vat_mode === 'separate'
  const unspecified = values.vat_mode === 'unspecified'
  const money = formatInstallmentAmount
  const split = (base: number, vat: number) =>
    [
      t('instBeforeVat').replace('{amount}', money(base)),
      t('instVatPart').replace('{amount}', money(vat)),
    ].join(' · ')
  const rateBase = rateBaseOf(values)
  const count = planned.input.installmentCount
  const last = plan.rows[plan.rows.length - 1]

  return (
    <div className="space-y-3">
      {/* The total first, then what of it is before the VAT and the VAT,
          each on its own line (owner 2026-11-23). */}
      <div className="rounded-xl bg-surface p-3">
        <p className="text-xs text-muted">
          {t(unspecified ? 'instContractTotal' : 'instCalcTotal')}
        </p>
        <div className="mt-0.5">
          <Money value={plan.total} className="text-2xl font-bold" />
        </div>
        {plan.vat > 0 && (
          <dl className="mt-3 space-y-1.5 border-t pt-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">{t('instBeforeVatLabel')}</dt>
              <dd>
                <Money value={plan.beforeVat} className="font-semibold" />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">{t('instCalcVatLine')}</dt>
              <dd>
                <Money value={plan.vat} className="font-semibold" />
              </dd>
            </div>
          </dl>
        )}
      </div>
      <ul className="divide-y border-y">
        {plan.prepaid > 0 && (
          <Line title={t('instDownPayment')} amount={plan.prepaid} />
        )}
        {plan.payments.map((payment, index) => {
          const row = values.payments[planned.rowIndexes[index]]
          const paid = row.settled || (row.paid && row.lockedAmount === null)
          const rate = firstPaymentPlanValue(row, rateBase)?.rate ?? null
          const of =
            rate === null
              ? null
              : separate
                ? t('instRateOfBase')
                    .replace('{rate}', String(rate))
                    .replace('{amount}', money(rateBase))
                : t('instRateOfTotal').replace('{rate}', String(rate))
          return (
            <Line
              key={row.key}
              title={row.title || t('instFirstPayment')}
              amount={payment.amount}
              sub={
                (of || inside) && (
                  <>
                    {of && <span className="block">{of}</span>}
                    {inside && split(payment.base, payment.vat)}
                  </>
                )
              }
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
          sub={
            inside
              ? split(plan.installments.base, plan.installments.vat)
              : separate
                ? t('instNoVatOnIt')
                : undefined
          }
        />
        {separate && (
          <Line
            title={values.vat_title.trim() || t('instVatPayment')}
            amount={plan.vat}
            state={
              values.vat_paid || vatSettled ? (
                <span className="text-xs font-normal text-success">
                  {t('instFpPaid')}
                </span>
              ) : values.vat_due === 'last' ? (
                <span className="text-xs font-normal text-info">
                  {t('instWithLast')}
                </span>
              ) : plan.vatDueDate ? (
                <bdi dir="ltr" className="text-xs font-normal text-muted">
                  {formatDate(plan.vatDueDate)}
                </bdi>
              ) : (
                <span className="text-xs font-normal text-warning">
                  {t('instFpWaitsDate')}
                </span>
              )
            }
            sub={
              values.vat_paid && values.vat_paid_on ? (
                <>
                  {t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[values.vat_method])}
                  {' · '}
                  <bdi dir="ltr">{formatDate(values.vat_paid_on)}</bdi>
                </>
              ) : undefined
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
        {unspecified && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">{t('instVatLabel')}</dt>
            <dd>
              <Badge size="sm">{t('instVatUnspecified')}</Badge>
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}
