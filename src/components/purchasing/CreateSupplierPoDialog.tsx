import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { useMovementFormOptions } from '@/components/movement/useMovementFormOptions'
import { PricePreview, PricesByUnit } from '@/components/purchasing/Price'
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
  Select,
  Skeleton,
  Textarea,
  cn,
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
  SUPPLIER_PO_OWNER_CLASSES,
  SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS,
  isValidSupplierPoPrice,
  SUPPLIER_PO_DEFAULT_RATE_UNIT,
  SUPPLIER_PO_RATE_UNIT_LABEL_KEYS,
  SUPPLIER_PO_RATE_UNITS,
  supplierPoRateUnitOf,
  supplierPoTotalsByUnit,
  type SupplierPoRateUnit,
  supplierPoErrorOutcome,
  type SupplierPoCreateLine,
  type SupplierPoFormValues,
  type SupplierPoOwnerClass,
} from '@/lib/purchasing'
import {
  createSupplierPo,
  fetchPartyOpenVisits,
  staticOptionLoader,
  supplierPoParty,
  visitCompanyOptions,
  visitEntryDay,
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

type Picked = Record<
  string,
  { price: string; note: string; rate_unit: SupplierPoRateUnit }
>

/**
 * «المعدات في المشاريع» (2026-10-24): a new PO for one unit with no PO and
 * no open PO of its party there. The dialog opens on the unit's party,
 * company and project with the unit ticked and the start date at its entry;
 * the user can still change everything.
 */
export interface CreateSupplierPoPreset {
  /** One of the fixed owners, or null for a lessor party. */
  ownerClass: SupplierPoOwnerClass | null
  /** The lessor party (id + name for the select), or null for an owner. */
  lessor: AsyncSearchSelectOption | null
  companyId: string
  projectId: string
  equipmentId: string
  /** yyyy-mm-dd (Saudi day) of the unit's open entry. */
  startDate: string
}

/** The owner select: one of the four fixed owners, or «مورد خارجي». */
const EXTERNAL = 'external_supplier'
type OwnerChoice = '' | SupplierPoOwnerClass | typeof EXTERNAL

/**
 * «امر شراء جديد» (owner review 2026-10-20): the party first (a supplier
 * from the list or one of the fixed owners), then only the companies and
 * projects where that party has units right now, then those units ticked
 * with an optional price each, and notes. 0148 (owner 2026-10-25): every
 * unit of one PO entered on the same Saudi day, the start date — once a unit
 * is ticked only the units of its entry day stay selectable and the start
 * date is that day (locked while units are ticked). Saved in ONE call
 * (`create_supplier_po` with `p_equipment`): the PO and its lines, or
 * nothing.
 */
export function CreateSupplierPoDialog({
  open,
  onOpenChange,
  onCreated,
  preset = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (poId: string) => void
  preset?: CreateSupplierPoPreset | null
}) {
  const { t, lang } = useI18n()
  const { loadLessors } = useMovementFormOptions()
  const [form, setForm] = useState<SupplierPoFormValues>(EMPTY_FORM)
  const [owner, setOwner] = useState<OwnerChoice>('')
  const [supplier, setSupplier] = useState<AsyncSearchSelectOption | null>(null)
  const external = owner === EXTERNAL
  const ownerOptions = useMemo(
    () => [
      ...SUPPLIER_PO_OWNER_CLASSES.map((owner) => ({
        value: owner,
        label: t(SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS[owner]),
      })),
      { value: EXTERNAL, label: t('supplierPoOwnerExternal') },
    ],
    [t],
  )
  const [visits, setVisits] = useState<PartyOpenVisit[]>([])
  const [visitsState, setVisitsState] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle',
  )
  const [picked, setPicked] = useState<Picked>({})
  // 0157 (owner 2026-10-28): the unit a newly ticked unit's price takes;
  // each unit can still be changed next to its price.
  const [defaultUnit, setDefaultUnit] = useState<SupplierPoRateUnit>(
    SUPPLIER_PO_DEFAULT_RATE_UNIT,
  )
  const [errors, setErrors] = useState<FieldErrors<SupplierPoFormValues>>({})
  const [lineErrors, setLineErrors] = useState<Record<string, TranslationKey>>({})
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

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
  const rateUnitOptions = useMemo(
    () =>
      SUPPLIER_PO_RATE_UNITS.map((unit) => ({
        value: unit,
        label: t(SUPPLIER_PO_RATE_UNIT_LABEL_KEYS[unit]),
      })),
    [t],
  )
  /** 0148: the entry day of the ticked units (they all share it), or null
   *  while none is ticked. */
  const pickedDay = useMemo(() => {
    const first = unitsAtProject.find((visit) => picked[visit.equipment_id])
    return first ? visitEntryDay(first) : null
  }, [unitsAtProject, picked])

  useEffect(() => {
    if (!open) return
    setForm(
      preset
        ? {
            ...EMPTY_FORM,
            lessor_id: preset.lessor?.value ?? '',
            owner_class: preset.ownerClass ?? '',
            company_id: preset.companyId,
            project_id: preset.projectId,
            start_date: preset.startDate,
          }
        : { ...EMPTY_FORM, start_date: saudiDateKey() },
    )
    setOwner(preset ? (preset.ownerClass ?? EXTERNAL) : '')
    setSupplier(preset?.lessor ?? null)
    setVisits([])
    setVisitsState('idle')
    setDefaultUnit(SUPPLIER_PO_DEFAULT_RATE_UNIT)
    setPicked(
      preset
        ? {
            [preset.equipmentId]: {
              price: '',
              note: '',
              rate_unit: SUPPLIER_PO_DEFAULT_RATE_UNIT,
            },
          }
        : {},
    )
    setErrors({})
    setLineErrors({})
    setMessage(null)
    setSaving(false)
    // The preset is read only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 0148: the start date is the entry day of the ticked units.
  useEffect(() => {
    if (!pickedDay) return
    setForm((current) =>
      current.start_date === pickedDay
        ? current
        : { ...current, start_date: pickedDay },
    )
    setErrors((current) => clearFieldErrors(current, ['start_date']))
  }, [pickedDay])

  const toggle = (visit: PartyOpenVisit, checked: boolean) => {
    setPicked((current) => {
      const next = { ...current }
      if (checked)
        next[visit.equipment_id] = { price: '', note: '', rate_unit: defaultUnit }
      else delete next[visit.equipment_id]
      return next
    })
    setLineErrors((current) => {
      const next = { ...current }
      delete next[visit.equipment_id]
      return next
    })
  }

  const setLineUnit = (equipmentId: string, rateUnit: SupplierPoRateUnit) => {
    setPicked((current) => ({
      ...current,
      [equipmentId]: { ...current[equipmentId], rate_unit: rateUnit },
    }))
  }

  /** A new default also moves the ticked units still on the old one; a unit
   *  changed by hand keeps its own. */
  const changeDefaultUnit = (next: SupplierPoRateUnit) => {
    const previous = defaultUnit
    setDefaultUnit(next)
    setPicked((current) =>
      Object.fromEntries(
        Object.entries(current).map(([equipmentId, line]) => [
          equipmentId,
          line.rate_unit === previous ? { ...line, rate_unit: next } : line,
        ]),
      ),
    )
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
        rate_unit: picked[visit.equipment_id].rate_unit,
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
        {/* The owner first, like the log's owner filter (owner 2026-10-21):
            the four fixed owners or «مورد خارجي»; the supplier field slides
            in under it only for an external supplier. */}
        <Field
          label={t('ownershipStatus')}
          name="lessor_id"
          required
          error={!owner && errors.lessor_id ? t(errors.lessor_id) : undefined}
        >
          {(control) => (
            <Select
              {...control}
              value={owner}
              placeholder={t('supplierPoOwnerPlaceholder')}
              options={ownerOptions}
              onValueChange={(value) => {
                setOwner(value as OwnerChoice)
                setSupplier(null)
                // A new owner resets the party, the places and the units.
                update({
                  lessor_id: '',
                  owner_class: value === EXTERNAL ? '' : value,
                  company_id: '',
                  project_id: '',
                })
                setPicked({})
              }}
            />
          )}
        </Field>
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out',
            external
              ? 'translate-y-0 grid-rows-[1fr] opacity-100'
              : 'pointer-events-none -translate-y-1 grid-rows-[0fr] opacity-0',
          )}
          aria-hidden={!external}
        >
          <div className="min-h-0 overflow-hidden">
            <Field
              label={t('supplierPoSupplier')}
              name="supplier"
              required
              error={
                external && errors.lessor_id
                  ? t('supplierPoSupplierRequired')
                  : undefined
              }
              className="pb-1"
            >
              {(control) => (
                <AsyncSearchSelect
                  {...control}
                  value={form.lessor_id}
                  selectedOption={supplier}
                  placeholder={t('supplierPoSupplierPlaceholder')}
                  loadOptions={loadLessors}
                  disabled={!external}
                  onChange={(value, option) => {
                    setSupplier(option)
                    update({ lessor_id: value, company_id: '', project_id: '' })
                    setPicked({})
                  }}
                />
              )}
            </Field>
          </div>
        </div>
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
          {/* The units matter only once a project is chosen: until then the
              section keeps its hint, whatever the visits request is doing
              (owner 2026-10-21: no loading flash on picking the owner). */}
          {visitsState === 'error' ? (
            <ErrorState description={t('supplierPoListLoadError')} className="p-4" />
          ) : !form.project_id ? (
            <p className="rounded-xl border border-dashed p-3 text-sm text-muted">
              {t('supplierPoPickProjectFirst')}
            </p>
          ) : visitsState === 'loading' ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : unitsAtProject.length === 0 ? (
            <EmptyState title={t('supplierPoNoUnitsAtProject')} className="p-4" />
          ) : (
            <>
            <Field
              label={t('supplierPoDefaultRateUnit')}
              name="default_rate_unit"
              hint={t('supplierPoDefaultRateUnitHint')}
            >
              {(control) => (
                <Select
                  {...control}
                  value={defaultUnit}
                  options={rateUnitOptions}
                  onValueChange={(value) =>
                    changeDefaultUnit(supplierPoRateUnitOf(value))
                  }
                />
              )}
            </Field>
            <ul className="space-y-2">
              {unitsAtProject.map((visit) => {
                const line = picked[visit.equipment_id]
                const id = `po-unit-${visit.equipment_id}`
                // 0148: once a unit is ticked, a unit of another entry day
                // cannot join this PO.
                const otherDay =
                  !line && pickedDay !== null && visitEntryDay(visit) !== pickedDay
                return (
                  <li
                    key={visit.equipment_id}
                    className="rounded-xl border bg-bg p-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <label
                        htmlFor={id}
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-3',
                          otherDay ? 'cursor-not-allowed text-muted' : 'cursor-pointer',
                        )}
                      >
                        <Checkbox
                          id={id}
                          checked={Boolean(line)}
                          disabled={otherDay}
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
                            {otherDay && <> · {t('supplierPoOtherEntryDay')}</>}
                          </span>
                        </span>
                      </label>
                      {line && (
                        <div className="w-full sm:w-64">
                          <div className="flex gap-2">
                            <Input
                              dir="ltr"
                              inputMode="decimal"
                              placeholder="0.00"
                              aria-label={`${t('supplierPoPrice')} ${visit.equipment_code}`}
                              value={line.price}
                              invalid={Boolean(lineErrors[visit.equipment_id])}
                              data-price-input=""
                              className="min-w-0 flex-1"
                              onChange={(event) =>
                                setLinePrice(visit.equipment_id, event.target.value)
                              }
                              onKeyDown={movePriceFocus}
                            />
                            {/* 0157: this unit's price per month or per day. */}
                            <Select
                              aria-label={`${t('supplierPoRateUnit')} ${visit.equipment_code}`}
                              className="w-24 shrink-0"
                              value={line.rate_unit}
                              options={rateUnitOptions}
                              onValueChange={(value) =>
                                setLineUnit(visit.equipment_id, supplierPoRateUnitOf(value))
                              }
                            />
                          </div>
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
            </>
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
          hint={t(
            pickedDay ? 'supplierPoStartDateFollowsEntry' : 'supplierPoStartDateHint',
          )}
          error={errors.start_date && t(errors.start_date)}
        >
          {(control) => (
            <DatePicker
              {...control}
              disabled={pickedDay !== null}
              value={form.start_date}
              onChange={(value) => update({ start_date: value })}
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
          <p className="text-sm text-muted">
            {t('supplierPoSummaryTotal')}:{' '}
            {/* 0157: one total per unit, never a month and a day added. */}
            <PricesByUnit
              className="text-base font-semibold text-fg"
              parts={
                supplierPoTotalsByUnit(
                  Object.values(picked).map((line) => ({
                    price: isValidSupplierPoPrice(line.price) ? Number(line.price) : null,
                    rate_unit: line.rate_unit,
                  })),
                ).parts
              }
            />
          </p>
        )}
      </div>
    </Dialog>
  )
}
