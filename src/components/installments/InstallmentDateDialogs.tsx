import { useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import {
  Badge,
  Button,
  DatePicker,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  installmentErrorMessage,
  INSTALLMENT_ERROR_KEYS,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  type InstallmentFrequency,
} from '@/lib/installments'
import { planDivision } from '@/lib/installmentPlan'
import {
  setInstallmentFirstDueDate,
  setInstallmentPaymentDate,
} from '@/lib/installmentsData'
import {
  installmentErrorToken,
  installmentsWords,
  latinDigits,
  payableRowLabel,
  INSTALLMENT_STALE_TOKENS,
  type InstallmentContractRow,
  type InstallmentScheduleItem,
} from '@/lib/installmentsView'
import { Money } from './cells'

/** The preview names this many of the first installments, then the last. */
const PREVIEW_HEAD = 2

/**
 * «تحديد تاريخ اول قسط» (migration 0209, owner 2026-11-22: «تصير تقسم
 * القسط لما احط تاريخ اول قسط»): the date with the count and the frequency,
 * the division the database will make (`planDivision`), saved through
 * `set_installment_first_due_date`. The first payments and what was paid on
 * them stay as they are.
 */
export function SetFirstDueDateDialog({
  contract,
  onOpenChange,
  onDone,
  onStale,
}: {
  /** The contract; null = closed. */
  contract: InstallmentContractRow | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
  onStale?: () => void
}) {
  const { t, lang } = useI18n()
  const [date, setDate] = useState('')
  const [count, setCount] = useState('')
  const [frequency, setFrequency] = useState('1')
  const [error, setError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  const contractId = contract?.id
  useEffect(() => {
    if (!contract) return
    setDate(contract.first_due_date ?? '')
    setCount(String(contract.installment_count))
    setFrequency(String(contract.frequency_months))
    setError(null)
    setSaving(false)
    // Another contract, or the opening, resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId])

  const division = useMemo(
    () =>
      contract && /^\d+$/.test(count)
        ? planDivision(contract, date || null, Number(count), Number(frequency))
        : null,
    [contract, date, count, frequency],
  )
  const plan = division?.plan ?? null
  const planError = division?.error
    ? INSTALLMENT_ERROR_KEYS[division.error]
    : null
  const frequencyLabel = (months: number) =>
    t(
      INSTALLMENT_FREQUENCY_LABEL_KEYS[months as InstallmentFrequency] ??
        'instFrequencyMonthly',
    )

  const submit = async () => {
    if (!contract || saving) return
    if (!date) return setError('instErrFirstDueDate')
    if (!plan) return setError(planError ?? 'instErrInstallmentCount')
    setError(null)
    setSaving(true)
    const result = await setInstallmentFirstDueDate({
      contractId: contract.id,
      firstDueDate: date,
      installmentCount: Number(count),
      frequencyMonths: Number(frequency),
    })
    setSaving(false)
    if (result.error) {
      setError(installmentErrorMessage(result.error))
      const token = installmentErrorToken(result.error)
      if (token && INSTALLMENT_STALE_TOKENS.has(token)) onStale?.()
      return
    }
    onDone()
  }

  const rows = plan?.rows ?? []
  const folded = rows.length > PREVIEW_HEAD + 2
  const shown = folded ? rows.slice(0, PREVIEW_HEAD) : rows
  const last = folded ? rows[rows.length - 1] : null

  return (
    <Dialog
      open={contract !== null}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={
        contract?.first_due_date
          ? t('instChangeFirstDue')
          : t('instSetFirstDue')
      }
      description={t('instSetFirstDueDesc')}
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
            {t('instDivConfirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('instFirstDueDate')}
          required
          error={error === 'instErrFirstDueDate' ? t(error) : undefined}
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('instInstallmentCount')}
            required
            error={planError ? t(planError) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="numeric"
                value={count}
                onChange={(event) => {
                  setCount(latinDigits(event.target.value).replace(/\D/g, ''))
                  setError(null)
                }}
              />
            )}
          </Field>
          <Field label={t('instRepeat')} required>
            {(control) => (
              <Select
                {...control}
                value={frequency}
                onValueChange={(value) => {
                  setFrequency(value)
                  setError(null)
                }}
                options={INSTALLMENT_FREQUENCIES.map((months) => ({
                  value: String(months),
                  label: frequencyLabel(months),
                }))}
              />
            )}
          </Field>
        </div>
        {plan && (
          <dl className="space-y-1.5 rounded-xl border bg-surface p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-xs text-muted">{t('instDivAmount')}</dt>
              <dd className="font-bold">
                <Money value={plan.installments.amount} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-xs text-muted">
                {frequency === '1'
                  ? t('instDivMonthly')
                  : t('instPreviewInstallment').replace(
                      '{frequency}',
                      frequencyLabel(Number(frequency)),
                    )}
              </dt>
              <dd className="font-bold">
                <Money value={plan.regular} />
              </dd>
            </div>
          </dl>
        )}
        {plan && date && (
          <ol className="divide-y rounded-lg border text-sm">
            {[...shown, ...(last ? [null, last] : [])].map((row) =>
              row === null ? (
                <li
                  key="gap"
                  className="px-3 py-1 text-center text-xs text-muted"
                >
                  {t('instDivMore').replace(
                    '{installments}',
                    installmentsWords(rows.length - PREVIEW_HEAD - 1, lang),
                  )}
                </li>
              ) : (
                <li
                  key={row.seq}
                  className="flex items-center justify-between gap-3 px-3 py-1.5"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-6 tabular-nums text-muted">
                      {row.seq}
                    </span>
                    <bdi dir="ltr">{formatDate(row.dueDate as string)}</bdi>
                    {row.isBalloon && (
                      <Badge size="sm" tone="info">
                        {t('instBalloonBadge')}
                      </Badge>
                    )}
                  </span>
                  <Money value={row.amount} />
                </li>
              ),
            )}
            {contract?.vat_mode === 'separate' &&
              !contract.vat_settled &&
              plan.vatDueDate && (
              <li className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <bdi dir="ltr">{formatDate(plan.vatDueDate)}</bdi>
                  <Badge size="sm" tone="info">
                    {t('instVatPayment')}
                  </Badge>
                </span>
                <Money value={contract.vat_amount} />
              </li>
            )}
          </ol>
        )}
        {error && error !== 'instErrFirstDueDate' && (
          <Notice tone="danger" size="compact">
            {t(error)}
          </Notice>
        )}
        {(contract?.first_payments_count ?? 0) > 0 && (
          <Notice tone="info" size="compact" icon={<Info size={16} />}>
            {t('instDivKeepsPayments')}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}

/** «تحديد تاريخ الدفعة الثانية»: dates a first payment or a separate VAT. */
export function SetPaymentDateDialog({
  row,
  onOpenChange,
  onDone,
  onStale,
}: {
  /** The first payment or the VAT row; null = closed. */
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
    if (!date) return setError('instErrFirstPaymentDate')
    setError(null)
    setSaving(true)
    const result = await setInstallmentPaymentDate(row.id, date)
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
      title={t('instPaymentDateTitle').replace(
        '{title}',
        () => (row ? payableRowLabel(row, t) : ''),
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
          <Button variant="primary" loading={saving} onClick={submit}>
            {t('instPaymentDateSave')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-surface p-3">
          <span className="text-xs text-muted">
            {t('instPaymentDateAmount')}
          </span>
          <Money value={row?.amount} className="font-bold" />
        </div>
        <Field
          label={t('instPaymentDateLabel')}
          required
          error={error ? t(error) : undefined}
          hint={t('instPaymentDateHint')}
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
