import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronDown, Clock, FileText, Info, Lock, X } from 'lucide-react'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { AsyncMultiSelect } from '@/components/data-list/AsyncMultiSelect'
import { BankAccountFields } from '@/components/installments/BankAccountFields'
import {
  DraftContractFiles,
  EditContractFiles,
} from '@/components/installments/InstallmentContractFiles'
import { InstallmentFirstPayments } from '@/components/installments/InstallmentFirstPayments'
import { InstallmentPlanSummary } from '@/components/installments/InstallmentPlanSummary'
import { InstallmentVatRow } from '@/components/installments/InstallmentVatRow'
import {
  AmountHint,
  Money,
  OptionalLabel,
} from '@/components/installments/cells'
import { setInstallmentFlash } from '@/components/installments/flash'
import { useLoad } from '@/components/installments/useLoad'
import { useTabTitle } from '@/components/TabTitle'
import {
  Badge,
  Button,
  Card,
  DatePicker,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Notice,
  PRIMARY_ACTIVE_TRIGGER,
  PageHeader,
  PageTrailBar,
  RadioGroup,
  RadioGroupItem,
  SectionHeader,
  Select,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  ToastProvider,
  cn,
  useConfirm,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  installmentContractFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import type { DraftInstallmentFile } from '@/lib/installmentFiles'
import { uploadDraftInstallmentFiles } from '@/lib/installmentFilesData'
import {
  installmentErrorMessage,
  INSTALLMENT_DESCRIPTION_MAX,
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_FREQUENCY_LABEL_KEYS,
  INSTALLMENT_NOTES_MAX,
} from '@/lib/installments'
import {
  contractFormValues,
  emptyContractForm,
  firstPaymentsPayload,
  mergeStoredForm,
  planInputOf,
  rateBaseOf,
  vatPayload,
  INSTALLMENT_CONTRACT_FIELD_ORDER,
  INSTALLMENT_CONTRACT_TOKEN_FIELDS,
  INSTALLMENT_VAT_CHOICES,
  INSTALLMENT_VAT_HINT_KEYS,
  INSTALLMENT_VAT_LABEL_KEYS,
  type InstallmentContractFormValues,
  type InstallmentVatMode,
} from '@/lib/installmentPlan'
import {
  fetchInstallmentContractForEdit,
  fetchInstallmentFinanciers,
  loadInstallmentEquipmentOptions,
  saveInstallmentContract,
} from '@/lib/installmentsData'
import {
  amountOf,
  installmentErrorToken,
  installmentFieldError,
  isSchedulePaid,
  latinDigits,
  parseInstallmentAmount,
  type InstallmentContractRow,
  type InstallmentScheduleItem,
  type InstallmentUnit,
} from '@/lib/installmentsView'
import { formatIban } from '@/lib/partyFields'
import { saudiDateKey } from '@/lib/saudiTime'

type Values = InstallmentContractFormValues

interface StoredContract {
  contract: InstallmentContractRow
  schedule: InstallmentScheduleItem[]
  units: InstallmentUnit[]
  /** The version the edit is based on. */
  editKey: string
}

/** A card on a wider screen, plain sections on a phone (the drawing). */
const SECTION = 'space-y-3 p-4 max-sm:border-0 max-sm:p-0 max-sm:shadow-none'

export interface InstallmentContractFormScreenProps {
  /** null = a new contract. */
  contractId: string | null
  onBack: () => void
  /** The contract is saved: the app opens its page. */
  onSaved: (id: string) => void
}

/**
 * «عقد جديد» / «تعديل العقد» as a page of its own (owner 2026-11-22, «خلي
 * اضافة العقد في صفحة مستقلة»; Figma «الدفعات والضريبة / صفحة عقد جديد»;
 * migration 0209): the contract, its ONE typed total with the VAT in three
 * options (redrawn and approved the same day, «الضريبة المعدلة»), the first
 * payments, the installments — whose first date may wait —, the files, the
 * account, the units, beside «حسبة العقد» as it is typed. Saved in ONE
 * `save_installment_contract` call (`installments.manage`).
 */
export function InstallmentContractFormScreen(
  props: InstallmentContractFormScreenProps,
) {
  return (
    <ToastProvider>
      {props.contractId ? (
        <EditContract {...props} contractId={props.contractId} />
      ) : (
        <ContractForm stored={null} {...props} />
      )}
    </ToastProvider>
  )
}

function EditContract(
  props: InstallmentContractFormScreenProps & { contractId: string },
) {
  const { t } = useI18n()
  const { contractId, onBack } = props
  const loader = useCallback(
    (signal: AbortSignal) =>
      fetchInstallmentContractForEdit(contractId, signal),
    [contractId],
  )
  const load = useLoad(loader)
  const data = load.data
  useTabTitle(data?.contract.contract_number)

  if (data && data.contract.status !== 'cancelled')
    return <ContractForm key={contractId} {...props} stored={data} />
  return (
    <div className="space-y-4">
      <PageTrailBar onBack={onBack} fallbackLabel={t('installments')} />
      {load.status === 'failed' ? (
        <ErrorState
          description={t('instFormLoadError')}
          onRetry={load.reload}
        />
      ) : load.status === 'loading' ? (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <EmptyState
          icon={<FileText size={28} aria-hidden="true" />}
          title={t(data ? 'instFormCancelled' : 'instContractNotFound')}
        />
      )}
    </div>
  )
}

/** A labelled group of controls that is not one input. */
function Group({
  name,
  label,
  error,
  hint,
  children,
}: {
  name: keyof Values
  label: ReactNode
  error?: string
  hint?: ReactNode
  children: (labelId: string) => ReactNode
}) {
  const id = useId()
  return (
    <div data-field={name} className="min-w-0">
      <p id={id} className="label">
        {label}
        <span aria-hidden="true" className="ms-0.5 text-danger">
          *
        </span>
      </p>
      {children(id)}
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

function ContractForm({
  stored: initialStored,
  contractId,
  onBack,
  onSaved,
}: InstallmentContractFormScreenProps & { stored: StoredContract | null }) {
  const { t } = useI18n()
  const today = useMemo(() => saudiDateKey(), [])
  const formRef = useRef<HTMLDivElement>(null)
  // A save that ends after the user left never pulls them back.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const { confirm, confirmDialog } = useConfirm()

  // What is stored: the locks follow it, read again after a stale refusal.
  const [stored, setStored] = useState(initialStored)
  const [initial, setInitial] = useState<Values>(() =>
    initialStored
      ? contractFormValues(
          initialStored.contract,
          initialStored.schedule,
          initialStored.units,
        )
      : emptyContractForm(),
  )
  const [values, setValues] = useState<Values>(initial)
  const [unitOptions, setUnitOptions] = useState<AsyncSearchSelectOption[]>(
    () =>
      (initialStored?.units ?? []).map((unit) => ({
        value: unit.equipment_id,
        label: unit.code
          ? [unit.code, unit.type].filter(Boolean).join(' ')
          : t('instUnitHidden'),
      })),
  )
  const [drafts, setDrafts] = useState<DraftInstallmentFile[]>([])
  const [errors, setErrors] = useState<FieldErrors<Values>>({})
  const [checkRows, setCheckRows] = useState(false)
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [showCalc, setShowCalc] = useState(false)

  const financiersLoader = useCallback(
    (signal: AbortSignal) => fetchInstallmentFinanciers(signal),
    [],
  )
  const financiers = useLoad(financiersLoader)

  const contract = stored?.contract ?? null
  const termsLocked = contract?.installments_locked === true
  const vatRowPaid = !!stored?.schedule.some(
    (row) => row.kind === 'vat' && amountOf(row.paid_amount) > 0,
  )
  const storedSeparate = contract?.vat_mode === 'separate'
  // Its day may move until it is fully paid.
  const vatSettled = !!stored?.schedule.some(
    (row) => row.kind === 'vat' && isSchedulePaid(row),
  )

  const dirty = useMemo(
    () =>
      drafts.length > 0 || JSON.stringify(values) !== JSON.stringify(initial),
    [drafts, values, initial],
  )
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const confirmLeave = async () => {
    // A save under way finishes on this page.
    if (saving) return false
    return (
      !dirty ||
      confirm({
        title: t('unsavedChanges'),
        description: t('dialogDescUnsavedChanges'),
        tone: 'danger',
      })
    )
  }
  const leave = async () => {
    if (await confirmLeave()) onBack()
  }

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => clearFieldErrors(current, [key]))
    setFormError(null)
  }
  const errorOf = (key: keyof Values) => {
    const message = errors[key]
    return message ? t(message) : undefined
  }

  const financierOptions = useMemo(() => {
    const rows = financiers.data ?? []
    const options = rows.map((row) => ({ value: row.id, label: row.name }))
    // The edited contract's own financier always has its option.
    if (contract && !rows.some((row) => row.id === contract.financier_id))
      options.unshift({
        value: contract.financier_id,
        label: contract.financier_name,
      })
    return options
  }, [financiers.data, contract])
  // The chosen financier's own account, named in the section's hint.
  const financierAccount = financiers.data?.find(
    (row) => row.id === values.financier_id && (row.bank_name || row.iban),
  )

  const total = parseInstallmentAmount(values.total_amount)
  // What a percentage is of depends on the VAT: unknown until it is chosen.
  const rateBase = values.vat_mode ? rateBaseOf(values) : null
  const modes: readonly InstallmentVatMode[] =
    initial.vat_mode === 'unspecified'
      ? ['unspecified', ...INSTALLMENT_VAT_CHOICES]
      : INSTALLMENT_VAT_CHOICES
  // A paid VAT stays; a paid installment allows only what moves no amount.
  const modeBlocked = (mode: InstallmentVatMode) =>
    mode !== values.vat_mode &&
    (vatRowPaid || (termsLocked && (storedSeparate || mode === 'separate')))
  const chooseMode = (mode: string) => {
    set('vat_mode', mode as InstallmentVatMode)
    setErrors((current) =>
      clearFieldErrors(current, [
        'vat_amount',
        'vat_due_date',
        'vat_paid_on',
        'payments',
      ]),
    )
  }
  const setVat = (patch: Partial<Values>) => {
    setValues((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(current, [
        ...(Object.keys(patch) as (keyof Values)[]),
        // Choosing when it is due, or «مدفوعة», changes which day is asked.
        ...('vat_due' in patch || 'vat_paid' in patch
          ? (['vat_due_date', 'vat_paid_on'] as const)
          : []),
      ]),
    )
    setFormError(null)
  }

  /** `contract_changed`: what is stored takes the place of the terms on
   *  the page; the free fields the user changed stay. */
  const readStoredAgain = async () => {
    if (!contractId) return
    try {
      const next = await fetchInstallmentContractForEdit(contractId)
      if (!next) return
      const saved = contractFormValues(next.contract, next.schedule, next.units)
      setValues((current) => mergeStoredForm(current, initial, saved))
      setStored(next)
      setInitial(saved)
      setUnitOptions((current) => [
        ...current,
        ...next.units
          .filter(
            (unit) =>
              !current.some((option) => option.value === unit.equipment_id),
          )
          .map((unit) => ({
            value: unit.equipment_id,
            label: unit.code
              ? [unit.code, unit.type].filter(Boolean).join(' ')
              : t('instUnitHidden'),
          })),
      ])
      setErrors({})
      setCheckRows(false)
    } catch {
      // The refusal's message shows; the next save is refused and reads again.
    }
  }

  const submit = async () => {
    if (saving) return
    const found = validateWithSchema<Values>(
      installmentContractFormSchema(today),
      values,
    )
    setErrors(found)
    setFormError(null)
    setCheckRows(true)
    if (hasErrors(found)) {
      focusFirstError(found, INSTALLMENT_CONTRACT_FIELD_ORDER, {
        root: formRef.current,
      })
      return
    }
    const typed = planInputOf(values)
    if (!typed) return
    setSaving(true)
    const result = await saveInstallmentContract({
      id: contractId,
      description: values.description,
      financierId: values.financier_id,
      totalAmount: typed.input.totalAmount,
      downPayment: typed.input.prepaid,
      balloonAmount: typed.input.balloonAmount,
      installmentCount: typed.input.installmentCount,
      frequencyMonths: typed.input.frequencyMonths,
      firstDueDate: typed.input.firstDueDate,
      vat: vatPayload(values),
      firstPayments: firstPaymentsPayload(
        values.payments,
        rateBase,
      ),
      expectedKey: stored?.editKey ?? null,
      notes: values.notes,
      equipmentIds: values.equipment,
      bankName: values.bank_name,
      iban: values.iban,
    })
    if (result.error || !result.data) {
      setSaving(false)
      const attributed = installmentFieldError(
        result.error,
        INSTALLMENT_CONTRACT_TOKEN_FIELDS,
      )
      if (attributed) {
        const next: FieldErrors<Values> = { [attributed.field]: attributed.key }
        setErrors(next)
        focusFirstError(next, INSTALLMENT_CONTRACT_FIELD_ORDER, {
          root: formRef.current,
        })
      } else {
        setFormError(installmentErrorMessage(result.error))
        formRef.current?.scrollIntoView({ block: 'start' })
      }
      const token = installmentErrorToken(result.error)
      if (token === 'contract_changed') await readStoredAgain()
      return
    }
    // The contract is saved: its picked files go up now, and a failed one
    // never undoes it.
    let failed = 0
    if (!contractId && drafts.length > 0)
      failed = await uploadDraftInstallmentFiles(
        result.data,
        drafts,
        setUploading,
      )
    if (!mounted.current) return
    if (failed > 0) setInstallmentFlash('instToastSavedFileFailed', 'warning')
    else if (contractId) setInstallmentFlash('instToastContractSaved')
    else
      setInstallmentFlash(
        typed.input.firstDueDate
          ? 'instToastContractCreated'
          : 'instToastCreatedWaiting',
      )
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
        <span className="flex flex-col items-start gap-0.5">
          <AmountHint value={values[key]} />
          {hint && <span>{hint}</span>}
        </span>
      }
    >
      {(control) => (
        <Input
          {...control}
          dir="ltr"
          inputMode="decimal"
          disabled={termsLocked}
          value={values[key]}
          onChange={(event) => set(key, event.target.value)}
        />
      )}
    </Field>
  )

  const saveLabel =
    uploading > 0
      ? t('instFormUploading')
          .replace('{done}', String(uploading))
          .replace('{total}', String(drafts.length))
      : contractId
        ? t('save')
        : t('instContractCreate')
  const saveButton = (className?: string) => (
    <Button
      variant="primary"
      className={className}
      loading={saving}
      onClick={submit}
    >
      {saveLabel}
    </Button>
  )
  const cancelButton = (
    <Button variant="outline" disabled={saving} onClick={() => void leave()}>
      {t('instDialogCancel')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader
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
        description={t('instFormDesc')}
        onBack={() => void leave()}
        confirmLeave={confirmLeave}
        actions={
          <div className="hidden gap-2 sm:flex">
            {cancelButton}
            {saveButton()}
          </div>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_396px]">
        <div ref={formRef} className="min-w-0 space-y-4">
          {termsLocked && (
            <Notice tone="info" size="compact" icon={<Lock size={16} />}>
              {t('instContractLockedNotice')}
            </Notice>
          )}
          {formError && <Notice tone="danger">{t(formError)}</Notice>}

          <Card className={SECTION}>
            <SectionHeader title={t('instFactsTitle')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="description"
                label={t('instContractTitle')}
                required
                error={errorOf('description')}
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
                        onClick={financiers.reload}
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
            </div>
          </Card>

          <Card className={SECTION}>
            <SectionHeader
              title={t('instFormTermsSection')}
              action={
                values.vat_mode === 'unspecified' ? (
                  <Badge size="sm">{t('instVatUnspecified')}</Badge>
                ) : undefined
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {amountField(
                'total_amount',
                t('instContractTotal'),
              )}
              {/* «مدفوع قبل التسجيل» is gone from the form (owner
                  2026-11-23): a first payment marked paid takes its place.
                  An older contract that carries one still shows it. */}
              {(contract?.down_payment ?? 0) > 0 &&
                amountField(
                  'down_payment',
                  <OptionalLabel text={t('instDownPayment')} />,
                )}
            </div>
            <Group
              name="vat_mode"
              label={t('instVatLabel')}
              error={errorOf('vat_mode')}
              hint={
                values.vat_mode
                  ? t(INSTALLMENT_VAT_HINT_KEYS[values.vat_mode])
                  : undefined
              }
            >
              {(labelId) => (
                <>
                  <Tabs
                    className="hidden sm:block"
                    value={values.vat_mode}
                    onValueChange={chooseMode}
                    // Nothing is chosen on a new contract: a click chooses.
                    activationMode="manual"
                  >
                    <TabsList
                      variant="segmented"
                      aria-labelledby={labelId}
                      className="w-full"
                    >
                      {modes.map((mode) => (
                        <TabsTrigger
                          key={mode}
                          value={mode}
                          disabled={modeBlocked(mode)}
                          className={cn(
                            'justify-center',
                            // Each takes the room its words need (English is long).
                            'flex-auto',
                            PRIMARY_ACTIVE_TRIGGER,
                          )}
                        >
                          {t(INSTALLMENT_VAT_LABEL_KEYS[mode])}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  {/* On a phone the whole labels, one under the other. */}
                  <RadioGroup
                    aria-labelledby={labelId}
                    className="sm:hidden"
                    value={values.vat_mode}
                    onValueChange={chooseMode}
                  >
                    {modes.map((mode) => (
                      <label
                        key={mode}
                        className={cn(
                          'flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                          values.vat_mode === mode
                            ? 'border-primary bg-surface font-semibold'
                            : 'bg-bg',
                          modeBlocked(mode) && 'opacity-50',
                        )}
                      >
                        <RadioGroupItem
                          value={mode}
                          disabled={modeBlocked(mode)}
                        />
                        {t(INSTALLMENT_VAT_LABEL_KEYS[mode])}
                      </label>
                    ))}
                  </RadioGroup>
                </>
              )}
            </Group>
            {(vatRowPaid || (termsLocked && !storedSeparate)) && (
              <Notice tone="info" size="compact" icon={<Info size={16} />}>
                {t(vatRowPaid ? 'instVatPaidHint' : 'instVatLockedHint')}
              </Notice>
            )}
            {values.vat_mode === 'separate' && (
              <InstallmentVatRow
                values={values}
                onChange={setVat}
                errors={errors}
                today={today}
                amountFixed={vatRowPaid || (termsLocked && storedSeparate)}
                hasMoney={vatRowPaid}
                settled={vatSettled}
                disabled={saving}
              />
            )}
          </Card>

          <Card className={SECTION}>
            <SectionHeader
              title={t('instFirstPayments')}
              description={t(
                values.vat_mode === 'separate'
                  ? 'instFirstPaymentsHintSeparate'
                  : 'instFirstPaymentsHint',
              )}
            />
            <div data-field="payments" className="space-y-2">
              <InstallmentFirstPayments
                rows={values.payments}
                onChange={(rows) => set('payments', rows)}
                rateBase={rateBase}
                today={today}
                termsLocked={termsLocked}
                showErrors={checkRows}
                disabled={saving}
              />
              {errors.payments && (
                <p className="text-xs text-danger" role="alert">
                  {t(errors.payments)}
                </p>
              )}
            </div>
          </Card>

          <Card className={SECTION}>
            <SectionHeader title={t('instInstallments')} />
            <div className="grid gap-4 sm:grid-cols-2">
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
                    disabled={termsLocked}
                    value={values.installment_count}
                    onChange={(event) =>
                      set(
                        'installment_count',
                        latinDigits(event.target.value).replace(/\D/g, ''),
                      )
                    }
                  />
                )}
              </Field>
              <Field
                name="frequency_months"
                label={t('instRepeat')}
                required
                error={errorOf('frequency_months')}
              >
                {(control) => (
                  <Select
                    {...control}
                    disabled={termsLocked}
                    value={values.frequency_months}
                    onValueChange={(value) => set('frequency_months', value)}
                    options={INSTALLMENT_FREQUENCIES.map((months) => ({
                      value: String(months),
                      label: t(INSTALLMENT_FREQUENCY_LABEL_KEYS[months]),
                    }))}
                  />
                )}
              </Field>
              <Field
                name="first_due_date"
                label={<OptionalLabel text={t('instFirstDueDate')} />}
                error={errorOf('first_due_date')}
              >
                {(control) => (
                  <DatePicker
                    {...control}
                    disabled={termsLocked}
                    placeholder={t('instDateUnknown')}
                    value={values.first_due_date}
                    onChange={(value) => set('first_due_date', value)}
                  />
                )}
              </Field>
              {amountField(
                'balloon_amount',
                <OptionalLabel text={t('instBalloon')} />,
              )}
            </div>
            {!values.first_due_date && (
              <Notice tone="warning" size="compact" icon={<Clock size={16} />}>
                {t('instAwaitingSaveNotice')}
              </Notice>
            )}
          </Card>

          {contractId ? (
            <EditContractFiles contractId={contractId} />
          ) : (
            <Card className={SECTION}>
              <SectionHeader
                title={t('instFilesTitle')}
                description={t('instFilesDraftHint')}
              />
              <DraftContractFiles
                files={drafts}
                onChange={setDrafts}
                disabled={saving}
              />
            </Card>
          )}

          <Card className={SECTION}>
            <SectionHeader
              title={t('instAccountOwn')}
              description={
                financierAccount
                  ? t('instContractAccountHintWith').replace(
                      '{account}',
                      [
                        financierAccount.bank_name,
                        financierAccount.iban &&
                          formatIban(financierAccount.iban),
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    )
                  : t('instFormAccountHint')
              }
            />
            <BankAccountFields
              bankName={values.bank_name}
              iban={values.iban}
              onBankName={(value) => set('bank_name', value)}
              onIban={(value) => set('iban', value)}
              bankError={errors.bank_name ?? null}
              ibanError={errors.iban ?? null}
            />
          </Card>

          <Card className={SECTION}>
            <SectionHeader title={t('instFormExtraSection')} />
            <div className="grid gap-4 sm:grid-cols-2">
              {/* The optional link: a contract may be tied to no unit. */}
              <Field
                name="equipment"
                label={<OptionalLabel text={t('instLinkedUnits')} />}
                error={errorOf('equipment')}
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
                                  values.equipment.filter((item) => item !== id),
                                )
                                setUnitOptions((current) =>
                                  current.filter(
                                    (option) => option.value !== id,
                                  ),
                                )
                              }}
                              className="inline-flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-xs transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span>
                                {unitOptions.find(
                                  (option) => option.value === id,
                                )?.label ?? t('instUnitHidden')}
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
          </Card>

          <div className="hidden justify-end gap-2 xl:flex">
            {cancelButton}
            {saveButton()}
          </div>
        </div>

        <Card className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] space-y-3 overflow-y-auto p-4 xl:block">
          <h2 className="text-sm font-semibold">{t('instCalcTitle')}</h2>
          <InstallmentPlanSummary values={values} vatSettled={vatSettled} />
        </Card>
      </div>

      {/* Below xl the breakdown lives in the bar: its total, and all of it
          on a press. */}
      <div
        className="sticky bottom-0 z-10 -mx-4 border-t bg-bg p-3 xl:hidden"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {showCalc && (
          <div className="mb-3 max-h-[55dvh] overflow-y-auto border-b pb-3">
            <InstallmentPlanSummary values={values} vatSettled={vatSettled} />
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-expanded={showCalc}
            onClick={() => setShowCalc((current) => !current)}
            className="flex min-h-11 min-w-0 flex-col items-start justify-center rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <span className="flex items-center gap-1 text-xs text-muted">
              {t('instCalcTitle')}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={cn('transition-transform', showCalc && 'rotate-180')}
              />
            </span>
            {total === null ? (
              <span className="text-base font-bold">—</span>
            ) : (
              <Money value={total} className="text-base font-bold" />
            )}
          </button>
          {saveButton('h-11 min-w-36')}
        </div>
      </div>

      {confirmDialog}
    </div>
  )
}
