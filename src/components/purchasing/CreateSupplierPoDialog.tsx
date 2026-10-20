import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { useMovementFormOptions } from '@/components/movement/useMovementFormOptions'
import { Price, PricePreview } from '@/components/purchasing/Price'
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Notice,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { EquipmentIdentifierTag } from '@/components/data-list/EquipmentIdentifierTag'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  supplierPoFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  SUPPLIER_PO_CREATE_FIELD_RULES,
  SUPPLIER_PO_FIELD_ORDER,
  isValidSupplierPoPrice,
  partyFromOptionValue,
  supplierPoErrorOutcome,
  type SupplierPoCreateLine,
  type SupplierPoFormValues,
} from '@/lib/purchasing'
import {
  createSupplierPo,
  fetchPartyOpenVisits,
  partyOptionLoader,
  staticOptionLoader,
  supplierPoParty,
  visitCompanyOptions,
  visitProjectOptions,
  type PartyOpenVisit,
} from '@/lib/purchasingData'
import { saudiDateKey } from '@/lib/saudiTime'

const EMPTY_FORM: SupplierPoFormValues = {
  lessor_id: '',
  owner_class: '',
  company_id: '',
  project_id: '',
  start_date: '',
  notes: '',
}

type Picked = Record<string, { price: string; note: string }>

/**
 * «امر شراء جديد» (owner review 2026-10-20): the party first (a supplier
 * from the list or one of the fixed owners), then only the companies and
 * projects where that party has units right now, then those units ticked
 * with an optional price each, the start date suggested from the earliest
 * entry among the ticked units, and notes. Saved in ONE call
 * (`create_supplier_po` with `p_equipment`): the PO and its lines, or
 * nothing.
 */
export function CreateSupplierPoDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (poId: string) => void
}) {
  const { t, lang } = useI18n()
  const { loadLessors } = useMovementFormOptions()
  const [form, setForm] = useState<SupplierPoFormValues>(EMPTY_FORM)
  const [party, setParty] = useState<AsyncSearchSelectOption | null>(null)
  const [visits, setVisits] = useState<PartyOpenVisit[]>([])
  const [visitsState, setVisitsState] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle',
  )
  const [picked, setPicked] = useState<Picked>({})
  const [errors, setErrors] = useState<FieldErrors<SupplierPoFormValues>>({})
  const [lineErrors, setLineErrors] = useState<Record<string, TranslationKey>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [dateTouched, setDateTouched] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const loadParties = useMemo(
    () => partyOptionLoader(loadLessors, t),
    [loadLessors, t],
  )
  const companyOptions = useMemo(
    () => visitCompanyOptions(visits, lang),
    [visits, lang],
  )
  const projectOptions = useMemo(
    () => visitProjectOptions(visits, form.company_id, lang),
    [visits, form.company_id, lang],
  )
  const loadCompanies = useMemo(
    () => staticOptionLoader(companyOptions),
    [companyOptions],
  )
  const loadProjects = useMemo(
    () => staticOptionLoader(projectOptions),
    [projectOptions],
  )
  const unitsAtProject = useMemo(
    () =>
      form.company_id && form.project_id
        ? visits.filter(
            (visit) =>
              visit.company_id === form.company_id &&
              visit.project_id === form.project_id,
          )
        : [],
    [visits, form.company_id, form.project_id],
  )
  const pickedCount = Object.keys(picked).length

  useEffect(() => {
    if (!open) return
    setForm({ ...EMPTY_FORM, start_date: saudiDateKey() })
    setParty(null)
    setVisits([])
    setVisitsState('idle')
    setPicked({})
    setErrors({})
    setLineErrors({})
    setMessage(null)
    setSaving(false)
    setDateTouched(false)
  }, [open])

  // The party's open visits drive the company, project and unit choices.
  const partyKey = `${form.lessor_id}|${form.owner_class}`
  useEffect(() => {
    const current = supplierPoParty({
      lessor_id: form.lessor_id || null,
      owner_class: form.owner_class || null,
    })
    if (!current) {
      setVisits([])
      setVisitsState('idle')
      return
    }
    let cancelled = false
    setVisitsState('loading')
    fetchPartyOpenVisits(current)
      .then((rows) => {
        if (cancelled) return
        setVisits(rows)
        setVisitsState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setVisits([])
        setVisitsState('error')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyKey])

  const update = (patch: Partial<SupplierPoFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof SupplierPoFormValues)[],
      ),
    )
  }

  /** The start date follows the earliest entry of the ticked units until the
   *  user edits it by hand. */
  const suggestStartDate = (next: Picked) => {
    if (dateTouched) return
    const dates = unitsAtProject
      .filter((visit) => next[visit.equipment_id])
      .map((visit) => saudiDateKey(visit.entry_at))
    if (dates.length === 0) return
    update({ start_date: dates.sort()[0] })
  }

  const toggle = (visit: PartyOpenVisit, checked: boolean) => {
    setPicked((current) => {
      const next = { ...current }
      if (checked) next[visit.equipment_id] = { price: '', note: '' }
      else delete next[visit.equipment_id]
      suggestStartDate(next)
      return next
    })
    setLineErrors((current) => {
      const next = { ...current }
      delete next[visit.equipment_id]
      return next
    })
  }

  const setLinePrice = (equipmentId: string, price: string) => {
    setPicked((current) => ({
      ...current,
      [equipmentId]: { ...current[equipmentId], price },
    }))
    setLineErrors((current) => {
      const next = { ...current }
      delete next[equipmentId]
      return next
    })
  }

  const save = async () => {
    const invalid = validateWithSchema(supplierPoFormSchema, form)
    const badLines: Record<string, TranslationKey> = {}
    for (const [equipmentId, line] of Object.entries(picked))
      if (line.price.trim() && !isValidSupplierPoPrice(line.price))
        badLines[equipmentId] = 'supplierPoPriceInvalid'
    if (hasErrors(invalid) || Object.keys(badLines).length) {
      setErrors(invalid)
      setLineErrors(badLines)
      setMessage(null)
      focusFirstError(invalid, SUPPLIER_PO_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const lines: SupplierPoCreateLine[] = unitsAtProject
      .filter((visit) => picked[visit.equipment_id])
      .map((visit) => ({
        equipment_id: visit.equipment_id,
        price: picked[visit.equipment_id].price,
        note: picked[visit.equipment_id].note,
      }))
    const result = await createSupplierPo(form, lines)
    setSaving(false)
    if (!result.error && result.data) {
      onCreated(result.data)
      return
    }
    const outcome = supplierPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, SUPPLIER_PO_CREATE_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, SUPPLIER_PO_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  const hasParty = Boolean(form.lessor_id || form.owner_class)

  /** ArrowDown / ArrowUp in a price field moves to the price field of the
   *  unit below / above (owner 2026-10-20), so a column of prices is typed
   *  without the mouse. */
  const movePriceFocus = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const inputs = [
      ...(bodyRef.current?.querySelectorAll<HTMLInputElement>(
        'input[data-price-input]',
      ) ?? []),
    ]
    const index = inputs.indexOf(event.currentTarget)
    if (index < 0) return
    const next = inputs[index + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    next.select()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('supplierPoNew')}
      description={t('supplierPoCreateDesc')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('supplierPoCreate')}
            {pickedCount > 0 ? ` (${pickedCount})` : ''}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
        <Field
          label={t('supplierPoParty')}
          name="lessor_id"
          required
          hint={t('supplierPoPartyHint')}
          error={errors.lessor_id && t(errors.lessor_id)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={party?.value ?? ''}
              selectedOption={party}
              placeholder={t('supplierPoPartyPlaceholder')}
              loadOptions={loadParties}
              onChange={(value, option) => {
                setParty(option)
                // A new party resets the places and the units.
                update({
                  ...partyFromOptionValue(value),
                  company_id: '',
                  project_id: '',
                })
                setPicked({})
              }}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('company')}
            name="company_id"
            required
            error={errors.company_id && t(errors.company_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.company_id}
                selectedOption={
                  companyOptions.find((option) => option.value === form.company_id) ??
                  null
                }
                placeholder={t('supplierPoCompanyPlaceholder')}
                loadOptions={loadCompanies}
                disabled={!hasParty || visitsState !== 'ready'}
                onChange={(value) => {
                  update({ company_id: value, project_id: '' })
                  setPicked({})
                }}
              />
            )}
          </Field>
          <Field
            label={t('project')}
            name="project_id"
            required
            error={errors.project_id && t(errors.project_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.project_id}
                selectedOption={
                  projectOptions.find((option) => option.value === form.project_id) ??
                  null
                }
                placeholder={t('supplierPoProjectPlaceholder')}
                loadOptions={loadProjects}
                disabled={!form.company_id}
                onChange={(value) => {
                  update({ project_id: value })
                  setPicked({})
                }}
              />
            )}
          </Field>
        </div>

        {/* The party's units inside the chosen project, ticked with a price. */}
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">{t('supplierPoCreateEquipment')}</p>
            <p className="text-xs text-muted">{t('supplierPoCreateEquipmentDesc')}</p>
          </div>
          {visitsState === 'error' ? (
            <ErrorState description={t('supplierPoListLoadError')} className="p-4" />
          ) : visitsState === 'loading' ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : !form.project_id ? (
            <p className="rounded-xl border border-dashed p-3 text-sm text-muted">
              {t('supplierPoPickProjectFirst')}
            </p>
          ) : unitsAtProject.length === 0 ? (
            <EmptyState title={t('supplierPoNoUnitsAtProject')} className="p-4" />
          ) : (
            <ul className="space-y-2">
              {unitsAtProject.map((visit) => {
                const line = picked[visit.equipment_id]
                const id = `po-unit-${visit.equipment_id}`
                return (
                  <li
                    key={visit.equipment_id}
                    className="rounded-xl border bg-bg p-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <label
                        htmlFor={id}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                      >
                        <Checkbox
                          id={id}
                          checked={Boolean(line)}
                          onCheckedChange={(checked) => toggle(visit, checked === true)}
                        />
                        <span className="flex min-w-0 flex-col text-start">
                          <span className="flex flex-wrap items-baseline gap-x-1.5">
                            <bdi dir="ltr" className="font-semibold">
                              {visit.equipment_code}
                            </bdi>
                            <EquipmentIdentifierTag
                              row={{
                                equipment_plate_number: visit.equipment_plate_number,
                              }}
                            />
                          </span>
                          <span className="text-xs text-muted">
                            {visit.equipment_type ?? '—'} · {t('supplierPoEntryDate')}{' '}
                            <bdi dir="ltr">{formatDate(visit.entry_at)}</bdi>
                          </span>
                        </span>
                      </label>
                      {line && (
                        <div className="w-full sm:w-44">
                          <Input
                            dir="ltr"
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label={`${t('supplierPoPrice')} ${visit.equipment_code}`}
                            value={line.price}
                            invalid={Boolean(lineErrors[visit.equipment_id])}
                            data-price-input=""
                            onChange={(event) =>
                              setLinePrice(visit.equipment_id, event.target.value)
                            }
                            onKeyDown={movePriceFocus}
                          />
                          {/* Under the LTR field, at its own start (left),
                              like the digits above it (owner 2026-10-20). */}
                          <p dir="ltr" className="mt-1 min-h-4 text-start text-xs text-muted">
                            {lineErrors[visit.equipment_id] ? (
                              <span className="text-danger">
                                {t(lineErrors[visit.equipment_id])}
                              </span>
                            ) : line.price.trim() ? (
                              <PricePreview value={line.price} />
                            ) : (
                              t('supplierPoNoPrice')
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {pickedCount > 0 && (
            <p className="text-xs text-muted">
              {t('supplierPoSelectedCount')}: {pickedCount}
            </p>
          )}
        </div>

        <Field
          label={t('supplierPoStartDate')}
          name="start_date"
          required
          hint={t('supplierPoStartDateHint')}
          error={errors.start_date && t(errors.start_date)}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={form.start_date}
              onChange={(value) => {
                setDateTouched(true)
                update({ start_date: value })
              }}
            />
          )}
        </Field>
        <Field
          label={t('notes')}
          name="notes"
          error={errors.notes && t(errors.notes)}
        >
          {(control) => (
            <Textarea
              {...control}
              value={form.notes}
              placeholder={t('notesPlaceholder')}
              onChange={(event) => update({ notes: event.target.value })}
            />
          )}
        </Field>
        {pickedCount > 0 && (
          <p className="text-xs text-muted">
            {t('supplierPoSummaryTotal')}:{' '}
            <Price
              value={Object.values(picked).reduce(
                (sum, line) =>
                  sum + (isValidSupplierPoPrice(line.price) ? Number(line.price) : 0),
                0,
              )}
            />
          </p>
        )}
      </div>
    </Dialog>
  )
}
