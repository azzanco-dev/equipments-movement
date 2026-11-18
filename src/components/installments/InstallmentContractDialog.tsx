import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Lock, Receipt, X } from 'lucide-react'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { AsyncMultiSelect } from '@/components/data-list/AsyncMultiSelect'
import {
  Badge,
  Button,
  DatePicker,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  installmentContractFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  addMonths,
  buildSchedule,
  checkInstallmentTerms,
  financedAmount,
  installmentErrorMessage,
  INSTALLMENT_DESCRIPTION_MAX,
  INSTALLMENT_ERROR_KEYS,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  INSTALLMENT_NOTES_MAX,
  type InstallmentFrequency,
} from '@/lib/installments'
import {
  fetchInstallmentFinanciers,
  loadInstallmentEquipmentOptions,
  saveInstallmentContract,
} from '@/lib/installmentsData'
import {
  amountInputText,
  amountOf,
  installmentErrorToken,
  installmentFieldError,
  installmentTermsOf,
  INSTALLMENT_CONTRACT_FIELD_ORDER,
  INSTALLMENT_CONTRACT_TOKEN_FIELDS,
  INSTALLMENT_STALE_TOKENS,
  type InstallmentContractFormValues,
  type InstallmentContractRow,
  type InstallmentFinancierRow,
  type InstallmentUnit,
} from '@/lib/installmentsView'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  AmountHint,
  Money,
  OptionalLabel,
  PeriodRange,
  PreviewStat,
} from './cells'

type Errors = FieldErrors<InstallmentContractFormValues>
type FinanciersState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; rows: InstallmentFinancierRow[] }

function initialValues(
  contract: InstallmentContractRow | null,
  units: readonly InstallmentUnit[],
  today: string,
): InstallmentContractFormValues {
  if (!contract)
    return {
      description: '',
      financier_id: '',
      total_amount: '',
      down_payment: '0',
      balloon_amount: '0',
      installment_count: '12',
      frequency_months: '1',
      first_due_date: addMonths(today, 1),
      notes: '',
      equipment: [],
    }
  return {
    description: contract.description,
    financier_id: contract.financier_id,
    total_amount: amountInputText(contract.total_amount),
    down_payment: amountInputText(contract.down_payment),
    balloon_amount: amountInputText(contract.balloon_amount),
    installment_count: String(contract.installment_count),
    frequency_months: String(contract.frequency_months),
    first_due_date: contract.first_due_date,
    notes: contract.notes ?? '',
    equipment: units.map((unit) => unit.equipment_id),
  }
}

/**
 * «عقد جديد» / «تعديل العقد» (the approved /ui-kit dialog on the real
 * data): the title, the financier, the money terms with the live preview of
 * the schedule the database will generate (`buildSchedule` mirrors
 * `generate_installment_schedule`), the optional units and the notes, saved
 * in ONE `save_installment_contract` call (`installments.manage`). A posted
 * payment locks the money terms (`contract_has_payments`): their fields are
 * disabled and the stored terms go back exactly as they are.
 */
export function InstallmentContractDialog({
  open,
  onOpenChange,
  contract = null,
  units = [],
  locked = false,
  onSaved,
  onStale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The contract edited; null = a new contract. */
  contract?: InstallmentContractRow | null
  /** The edited contract's linked units. */
  units?: readonly InstallmentUnit[]
  /** The contract has a posted payment: its money terms are locked. */
  locked?: boolean
  onSaved: (id: string) => void
  /** A refusal that means the contract changed meanwhile: the page
   *  refetches. */
  onStale?: () => void
}) {
  const { t } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const formRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<InstallmentContractFormValues>(() =>
    initialValues(contract, units, today),
  )
  const [unitOptions, setUnitOptions] = useState<AsyncSearchSelectOption[]>([])
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [financiers, setFinanciers] = useState<FinanciersState>({
    status: 'loading',
  })
  const [financiersKey, setFinanciersKey] = useState(0)

  // A fresh form each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setValues(initialValues(contract, units, today))
    setUnitOptions(
      units.map((unit) => ({
        value: unit.equipment_id,
        label: unit.code
          ? [unit.code, unit.type].filter(Boolean).join(' ')
          : t('instUnitHidden'),
      })),
    )
    setErrors({})
    setFormError(null)
    setSaving(false)
    // Only the opening resets the form: a refetch behind an open dialog
    // must not drop what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setFinanciers({ status: 'loading' })
    fetchInstallmentFinanciers(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setFinanciers({ status: 'ready', rows })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFinanciers({ status: 'failed' })
      })
    return () => controller.abort()
  }, [open, financiersKey])

  const set = <K extends keyof InstallmentContractFormValues>(
    key: K,
    value: InstallmentContractFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => clearFieldErrors(current, [key]))
  }
  const errorOf = (key: keyof InstallmentContractFormValues) => {
    const message = errors[key]
    return message ? t(message) : undefined
  }

  const terms = installmentTermsOf(values)
  const termsError = terms ? checkInstallmentTerms(terms) : null
  const preview = terms && !termsError ? buildSchedule(terms) : []
  const regular = preview.find((row) => !row.isBalloon)

  const financierOptions = useMemo(() => {
    const rows = financiers.status === 'ready' ? financiers.rows : []
    const options = rows.map((row) => ({ value: row.id, label: row.name }))
    // The edited contract's own financier always has its option.
    if (contract && !rows.some((row) => row.id === contract.financier_id))
      options.unshift({
        value: contract.financier_id,
        label: contract.financier_name,
      })
    return options
  }, [financiers, contract])

  const submit = async () => {
    if (saving) return
    const found = validateWithSchema<InstallmentContractFormValues>(
      installmentContractFormSchema,
      values,
    )
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) {
      focusFirstError(found, INSTALLMENT_CONTRACT_FIELD_ORDER, {
        root: formRef.current,
      })
      return
    }
    const typed = installmentTermsOf(values)
    if (!typed) return
    setSaving(true)
    const result = await saveInstallmentContract({
      id: contract?.id ?? null,
      description: values.description,
      financierId: values.financier_id,
      // The locked terms go back exactly as they are stored.
      ...(locked && contract
        ? {
            totalAmount: amountOf(contract.total_amount),
            downPayment: amountOf(contract.down_payment),
            balloonAmount: amountOf(contract.balloon_amount),
            installmentCount: contract.installment_count,
            frequencyMonths: contract.frequency_months,
            firstDueDate: contract.first_due_date,
          }
        : {
            totalAmount: typed.totalAmount,
            downPayment: typed.downPayment,
            balloonAmount: typed.balloonAmount,
            installmentCount: typed.installmentCount,
            frequencyMonths: typed.frequencyMonths,
            firstDueDate: typed.firstDueDate,
          }),
      notes: values.notes,
      equipmentIds: values.equipment,
    })
    setSaving(false)
    if (result.error || !result.data) {
      const attributed = installmentFieldError(
        result.error,
        INSTALLMENT_CONTRACT_TOKEN_FIELDS,
      )
      if (attributed) {
        const next: Errors = { [attributed.field]: attributed.key }
        setErrors(next)
        focusFirstError(next, INSTALLMENT_CONTRACT_FIELD_ORDER, {
          root: formRef.current,
        })
      } else setFormError(installmentErrorMessage(result.error))
      // The contract changed meanwhile (a payment was posted, it was
      // cancelled): the page reads it again.
      const token = installmentErrorToken(result.error)
      if (token && INSTALLMENT_STALE_TOKENS.has(token)) onStale?.()
      return
    }
    onSaved(result.data)
  }

  const amountField = (
    key: 'total_amount' | 'down_payment' | 'balloon_amount',
    label: ReactNode,
    hint?: string,
  ) => (
    <Field
      name={key}
      label={label}
      required={key === 'total_amount'}
      error={errorOf(key)}
      hint={
        hint ? (
          <span className="flex flex-col gap-0.5">
            <AmountHint value={values[key]} />
            <span>{hint}</span>
          </span>
        ) : (
          <AmountHint value={values[key]} />
        )
      }
    >
      {(control) => (
        <Input
          {...control}
          dir="ltr"
          inputMode="decimal"
          disabled={locked}
          value={values[key]}
          onChange={(event) => set(key, event.target.value)}
        />
      )}
    </Field>
  )

  const frequencyLabel = (months: number) =>
    t(
      INSTALLMENT_FREQUENCY_LABEL_KEYS[months as InstallmentFrequency] ??
        'instFrequencyMonthly',
    )

  return (
    <Dialog
      open={open}
      size="lg"
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={
        contract ? (
          <span>
            {t('instContractEdit')}{' '}
            <bdi dir="ltr">{contract.contract_number}</bdi>
          </span>
        ) : (
          t('instContractNew')
        )
      }
      description={t('instContractDialogDesc')}
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
            {contract ? t('save') : t('instContractCreate')}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="space-y-5">
        {locked && (
          <Notice tone="info" size="compact" icon={<Lock size={16} />}>
            {t('instContractLockedNotice')}
          </Notice>
        )}
        {formError && <Notice tone="danger">{t(formError)}</Notice>}

        <section className="grid gap-4 sm:grid-cols-3">
          <Field
            name="description"
            label={t('instContractTitle')}
            required
            error={errorOf('description')}
            hint={t('instContractTitleHint')}
            className="sm:col-span-2"
          >
            {(control) => (
              <Input
                {...control}
                maxLength={INSTALLMENT_DESCRIPTION_MAX}
                value={values.description}
                onChange={(event) => set('description', event.target.value)}
              />
            )}
          </Field>
          <Field
            name="financier_id"
            label={t('instFinancier')}
            required
            error={
              financiers.status === 'failed' ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {t('instFinanciersLoadError')}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFinanciersKey((key) => key + 1)}
                  >
                    {t('retry')}
                  </Button>
                </span>
              ) : (
                errorOf('financier_id')
              )
            }
            hint={
              financiers.status === 'ready' && financierOptions.length === 0
                ? t('instNoFinanciersHint')
                : undefined
            }
          >
            {(control) => (
              <Select
                {...control}
                placeholder={
                  financiers.status === 'loading'
                    ? t('loading')
                    : t('instFinancierPick')
                }
                disabled={financiers.status === 'loading'}
                value={values.financier_id}
                onValueChange={(value) => set('financier_id', value)}
                options={financierOptions}
              />
            )}
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t('instAmountsSection')}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {amountField('total_amount', t('instTotalAmount'))}
            {amountField(
              'down_payment',
              <OptionalLabel text={t('instDownPayment')} />,
              t('instDownPaymentHint'),
            )}
            {amountField(
              'balloon_amount',
              <OptionalLabel text={t('instBalloon')} />,
              t('instBalloonHint'),
            )}
            <Field
              name="installment_count"
              label={t('instInstallmentCount')}
              required
              error={errorOf('installment_count')}
            >
              {(control) => (
                <Input
                  {...control}
                  dir="ltr"
                  inputMode="numeric"
                  disabled={locked}
                  value={values.installment_count}
                  onChange={(event) =>
                    set(
                      'installment_count',
                      event.target.value.replace(/\D/g, ''),
                    )
                  }
                />
              )}
            </Field>
            <Field
              name="frequency_months"
              label={t('instFrequency')}
              required
              error={errorOf('frequency_months')}
            >
              {(control) => (
                <Select
                  {...control}
                  disabled={locked}
                  value={values.frequency_months}
                  onValueChange={(value) => set('frequency_months', value)}
                  options={INSTALLMENT_FREQUENCIES.map((months) => ({
                    value: String(months),
                    label: frequencyLabel(months),
                  }))}
                />
              )}
            </Field>
            <Field
              name="first_due_date"
              label={t('instFirstDueDate')}
              required
              error={errorOf('first_due_date')}
            >
              {(control) => (
                <DatePicker
                  {...control}
                  disabled={locked}
                  value={values.first_due_date}
                  onChange={(value) => set('first_due_date', value)}
                />
              )}
            </Field>
          </div>
        </section>

        {/* The live preview: what generate_installment_schedule will build. */}
        <section className="space-y-2 rounded-xl border bg-surface p-3 sm:p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Receipt size={16} aria-hidden="true" />
            {t('instPreviewTitle')}
          </h3>
          {!terms || termsError || preview.length === 0 ? (
            <p className="text-sm text-muted">
              {termsError
                ? t(INSTALLMENT_ERROR_KEYS[termsError])
                : t('instPreviewEmpty')}
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                <Money value={terms.totalAmount} />
                {terms.downPayment > 0 && (
                  <>
                    − <Money value={terms.downPayment} />
                  </>
                )}
                {' = '}
                <span className="font-semibold text-fg">
                  {t('instFinanced')} <Money value={financedAmount(terms)} />
                </span>
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <PreviewStat
                  label={t('instPreviewInstallment').replace(
                    '{frequency}',
                    frequencyLabel(terms.frequencyMonths),
                  )}
                  value={<Money value={regular?.amount} />}
                />
                <PreviewStat
                  label={t('instPeriod')}
                  value={
                    <PeriodRange
                      from={preview[0].dueDate}
                      to={preview[preview.length - 1].dueDate}
                    />
                  }
                />
                {terms.balloonAmount > 0 && (
                  <PreviewStat
                    label={t('instBalloon')}
                    value={<Money value={terms.balloonAmount} />}
                  />
                )}
              </div>
              <ol className="divide-y rounded-lg border bg-bg text-sm">
                {(preview.length > 6
                  ? [...preview.slice(0, 3), null, ...preview.slice(-2)]
                  : preview
                ).map((row, index) =>
                  row === null ? (
                    <li
                      key={`gap-${index}`}
                      className="px-3 py-1 text-center text-xs text-muted"
                    >
                      {t('instMoreRows').replace(
                        '{count}',
                        String(preview.length - 5),
                      )}
                    </li>
                  ) : (
                    <li
                      key={row.seq}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-muted">
                          {row.seq}
                        </span>
                        <bdi dir="ltr">{formatDate(row.dueDate)}</bdi>
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
              </ol>
            </>
          )}
        </section>

        {/* The optional link: a contract may be tied to no unit at all. */}
        <Field
          name="equipment"
          label={<OptionalLabel text={t('instLinkedUnits')} />}
          error={errorOf('equipment')}
          hint={t('instLinkedUnitsHint')}
        >
          {(control) => (
            <div className="space-y-1.5">
              <AsyncMultiSelect
                {...control}
                value={values.equipment}
                selectedOptions={unitOptions}
                onValueChange={(ids, options) => {
                  set('equipment', ids)
                  setUnitOptions(options)
                }}
                loadOptions={loadInstallmentEquipmentOptions}
                allLabel={t('instNoUnitLink')}
              />
              {values.equipment.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {values.equipment.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => {
                          set(
                            'equipment',
                            values.equipment.filter((entry) => entry !== id),
                          )
                          setUnitOptions((current) =>
                            current.filter((option) => option.value !== id),
                          )
                        }}
                        className="inline-flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-xs transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span>
                          {unitOptions.find((option) => option.value === id)
                            ?.label ?? t('instUnitHidden')}
                        </span>
                        <X
                          size={12}
                          aria-hidden="true"
                          className="text-muted"
                        />
                        <span className="sr-only">
                          {t('multiSelectRemove')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>

        <Field
          name="notes"
          label={<OptionalLabel text={t('notes')} />}
          error={errorOf('notes')}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={INSTALLMENT_NOTES_MAX}
              value={values.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
