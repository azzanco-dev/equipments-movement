import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import {
  SalePricePreview,
  SalePricesByUnit,
} from '@/components/sales/SalePrice'
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
} from '@/components/ui'
import { EquipmentIdentifierTag } from '@/components/data-list/EquipmentIdentifierTag'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  clearFieldErrors,
  clientPoFormSchema,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  staticOptionLoader,
  visitCompanyOptions,
  visitProjectOptions,
  type PartyVisit,
} from '@/lib/purchasingData'
import {
  CLIENT_PO_CREATE_FIELD_RULES,
  CLIENT_PO_FIELD_ORDER,
  CLIENT_PO_STANDARD_HOURS_DEFAULT,
  SALE_DEFAULT_RATE_UNIT,
  SALE_RATE_UNIT_LABEL_KEYS,
  SALE_RATE_UNITS,
  clientPoErrorOutcome,
  clientPoTotalsByUnit,
  isValidClientPoQuantity,
  isValidSalePrice,
  isValidStandardHours,
  saleRateUnitOf,
  type ClientPoCreateLine,
  type ClientPoFormValues,
  type SaleRateUnit,
} from '@/lib/sales'
import { createClientPo, fetchRecentSiteVisits } from '@/lib/salesData'
import { saudiDateKey } from '@/lib/saudiTime'

const EMPTY_FORM: ClientPoFormValues = {
  company_id: '',
  project_id: '',
  po_number: '',
  issue_date: '',
  expiry_date: '',
  standard_hours: String(CLIENT_PO_STANDARD_HOURS_DEFAULT),
  notes: '',
}

type Picked = Record<
  string,
  {
    price: string
    rate_unit: SaleRateUnit
    standard_hours: string
    quantity: string
  }
>

/**
 * «المعدات في المشاريع»: a new client PO for one unit with no client PO and
 * no open client PO of that company and project. The dialog opens on the
 * unit's company and project with the unit ticked; the user can still
 * change everything.
 */
export interface CreateClientPoPreset {
  companyId: string
  projectId: string
  equipmentId: string
}

/**
 * «PO عميل جديد» (owner approval 2026-11-02, the /ui-kit mockup): the
 * company (the client) first, then its project — only the companies and
 * projects with units inside right now —, the client's own PO number, the
 * issue date (today by default), an optional expiry date, the standard
 * hours (260) and the notes; then the units inside the chosen project
 * ticked with an optional sale price each, its unit, the hours (empty = the
 * PO's) and the contract quantity. NO entry-day rule (the client side joins
 * on the purchasing rule alone: inside now). Saved in ONE call
 * (`create_client_po` with `p_equipment`): the PO and its lines, or nothing.
 */
export function CreateClientPoDialog({
  open,
  onOpenChange,
  onCreated,
  preset = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (poId: string) => void
  preset?: CreateClientPoPreset | null
}) {
  const { t, lang } = useI18n()
  const [form, setForm] = useState<ClientPoFormValues>(EMPTY_FORM)
  const [visits, setVisits] = useState<PartyVisit[]>([])
  const [visitsState, setVisitsState] = useState<
    'idle' | 'loading' | 'error' | 'ready'
  >('idle')
  const [picked, setPicked] = useState<Picked>({})
  // The unit a newly ticked unit's price takes; each unit can still be
  // changed next to its price (the purchasing rule of 0157).
  const [defaultUnit, setDefaultUnit] = useState<SaleRateUnit>(
    SALE_DEFAULT_RATE_UNIT,
  )
  const [errors, setErrors] = useState<FieldErrors<ClientPoFormValues>>({})
  const [lineErrors, setLineErrors] = useState<Record<string, TranslationKey>>(
    {},
  )
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
      SALE_RATE_UNITS.map((unit) => ({
        value: unit,
        label: t(SALE_RATE_UNIT_LABEL_KEYS[unit]),
      })),
    [t],
  )

  useEffect(() => {
    if (!open) return
    setForm({
      ...EMPTY_FORM,
      company_id: preset?.companyId ?? '',
      project_id: preset?.projectId ?? '',
      issue_date: saudiDateKey(),
    })
    setDefaultUnit(SALE_DEFAULT_RATE_UNIT)
    setPicked(
      preset
        ? {
            [preset.equipmentId]: {
              price: '',
              rate_unit: SALE_DEFAULT_RATE_UNIT,
              standard_hours: '',
              quantity: '',
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

  // Every site visit inside now or exited within 60 days (0188) drives the
  // company, project and unit choices;
  // reloaded on every open (the purchasing lesson of 2026-10-31).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setVisitsState('loading')
    fetchRecentSiteVisits()
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
  }, [open])

  const update = (patch: Partial<ClientPoFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof ClientPoFormValues)[],
      ),
    )
  }

  const toggle = (visit: PartyVisit, checked: boolean) => {
    setPicked((current) => {
      const next = { ...current }
      if (checked)
        next[visit.equipment_id] = {
          price: '',
          rate_unit: defaultUnit,
          standard_hours: '',
          quantity: '',
        }
      else delete next[visit.equipment_id]
      return next
    })
    setLineErrors((current) => {
      const next = { ...current }
      delete next[visit.equipment_id]
      return next
    })
  }

  const setLine = (equipmentId: string, patch: Partial<Picked[string]>) => {
    setPicked((current) => ({
      ...current,
      [equipmentId]: { ...current[equipmentId], ...patch },
    }))
    setLineErrors((current) => {
      const next = { ...current }
      delete next[equipmentId]
      return next
    })
  }

  /** A new default also moves the ticked units still on the old one; a unit
   *  changed by hand keeps its own. */
  const changeDefaultUnit = (next: SaleRateUnit) => {
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

  const save = async () => {
    const invalid = validateWithSchema(clientPoFormSchema, form)
    const badLines: Record<string, TranslationKey> = {}
    for (const [equipmentId, line] of Object.entries(picked)) {
      if (line.price.trim() && !isValidSalePrice(line.price))
        badLines[equipmentId] = 'supplierPoPriceInvalid'
      else if (
        line.standard_hours.trim() &&
        !isValidStandardHours(line.standard_hours)
      )
        badLines[equipmentId] = 'clientPoStandardHoursInvalid'
      else if (line.quantity.trim() && !isValidClientPoQuantity(line.quantity))
        badLines[equipmentId] = 'clientPoQuantityInvalid'
    }
    if (hasErrors(invalid) || Object.keys(badLines).length) {
      setErrors(invalid)
      setLineErrors(badLines)
      setMessage(null)
      focusFirstError(invalid, CLIENT_PO_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }
    setSaving(true)
    setMessage(null)
    const lines: ClientPoCreateLine[] = unitsAtProject
      .filter((visit) => picked[visit.equipment_id])
      .map((visit) => ({
        equipment_id: visit.equipment_id,
        price: picked[visit.equipment_id].price,
        rate_unit: picked[visit.equipment_id].rate_unit,
        standard_hours: picked[visit.equipment_id].standard_hours,
        quantity: picked[visit.equipment_id].quantity,
        note: '',
      }))
    const result = await createClientPo(form, lines)
    setSaving(false)
    if (!result.error && result.data) {
      onCreated(result.data)
      return
    }
    const outcome = clientPoErrorOutcome(result.error, (error) =>
      mapDatabaseErrorToField(error, CLIENT_PO_CREATE_FIELD_RULES),
    )
    if ('fieldErrors' in outcome) {
      setErrors(outcome.fieldErrors)
      focusFirstError(outcome.fieldErrors, CLIENT_PO_FIELD_ORDER, {
        root: bodyRef.current,
      })
    } else setMessage(outcome.message)
  }

  /** ArrowDown / ArrowUp in a price field moves to the price field of the
   *  unit below / above (the purchasing rule), so a column of prices is
   *  typed without the mouse. */
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
      title={t('clientPoNew')}
      description={t('clientPoCreateDesc')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('clientPoCreate')}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('clientPoCompany')}
            name="company_id"
            required
            error={errors.company_id && t(errors.company_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.company_id}
                selectedOption={
                  companyOptions.find(
                    (option) => option.value === form.company_id,
                  ) ?? null
                }
                placeholder={t('clientPoCompanyPlaceholder')}
                loadOptions={loadCompanies}
                disabled={visitsState !== 'ready'}
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
                  projectOptions.find(
                    (option) => option.value === form.project_id,
                  ) ?? null
                }
                placeholder={t('clientPoProjectPlaceholder')}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('clientPoNumber')}
            name="po_number"
            required
            hint={t('clientPoNumberHint')}
            error={errors.po_number && t(errors.po_number)}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={form.po_number}
                onChange={(event) => update({ po_number: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('clientPoStandardHours')}
            name="standard_hours"
            required
            hint={t('clientPoStandardHoursHint')}
            error={errors.standard_hours && t(errors.standard_hours)}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                inputMode="numeric"
                value={form.standard_hours}
                onChange={(event) =>
                  update({ standard_hours: event.target.value })
                }
              />
            )}
          </Field>
          <Field
            label={t('clientPoIssueDate')}
            name="issue_date"
            required
            error={errors.issue_date && t(errors.issue_date)}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={form.issue_date}
                onChange={(value) => update({ issue_date: value })}
              />
            )}
          </Field>
          <Field
            label={t('clientPoExpiryDate')}
            name="expiry_date"
            hint={t('clientPoNoExpiry')}
            error={errors.expiry_date && t(errors.expiry_date)}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={form.expiry_date}
                onChange={(value) => update({ expiry_date: value })}
              />
            )}
          </Field>
        </div>

        {/* The units inside the chosen project, ticked with a sale price. */}
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">
              {t('supplierPoCreateEquipment')}
            </p>
            <p className="text-xs text-muted">
              {t('clientPoCreateEquipmentDesc')}
            </p>
          </div>
          {visitsState === 'error' ? (
            <ErrorState
              description={t('clientPoListLoadError')}
              className="p-4"
            />
          ) : !form.project_id ? (
            <p className="rounded-xl border border-dashed p-3 text-sm text-muted">
              {t('clientPoPickProjectFirst')}
            </p>
          ) : visitsState === 'loading' ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : unitsAtProject.length === 0 ? (
            <EmptyState title={t('clientPoNoUnitsAtProject')} className="p-4" />
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
                      changeDefaultUnit(saleRateUnitOf(value))
                    }
                  />
                )}
              </Field>
              <ul className="space-y-2">
                {unitsAtProject.map((visit) => {
                  const line = picked[visit.equipment_id]
                  const id = `client-po-unit-${visit.equipment_id}`
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
                            onCheckedChange={(checked) =>
                              toggle(visit, checked === true)
                            }
                          />
                          <span className="flex min-w-0 flex-col text-start">
                            <span className="flex flex-wrap items-baseline gap-x-1.5">
                              <bdi dir="ltr" className="font-semibold">
                                {visit.equipment_code}
                              </bdi>
                              <EquipmentIdentifierTag
                                row={{
                                  equipment_plate_number:
                                    visit.equipment_plate_number,
                                }}
                              />
                            </span>
                            <span className="text-xs text-muted">
                              {visit.equipment_type ?? '—'} ·{' '}
                              {t('supplierPoEntryDate')}{' '}
                              <bdi dir="ltr">{formatDate(visit.entry_at)}</bdi>
                              {/* 0188: a unit that left the project. */}
                              {visit.exit_at && (
                                <>
                                  {' · '}
                                  {t('siteUnitsExited')}{' '}
                                  <bdi dir="ltr">
                                    {formatDate(visit.exit_at)}
                                  </bdi>
                                </>
                              )}
                            </span>
                          </span>
                        </label>
                        {line && (
                          <div className="w-full space-y-2 sm:w-80">
                            <div className="flex gap-2">
                              <Input
                                dir="ltr"
                                inputMode="decimal"
                                placeholder="0.00"
                                aria-label={`${t('salePrice')} ${visit.equipment_code}`}
                                value={line.price}
                                invalid={Boolean(
                                  lineErrors[visit.equipment_id],
                                )}
                                data-price-input=""
                                className="min-w-0 flex-1"
                                onChange={(event) =>
                                  setLine(visit.equipment_id, {
                                    price: event.target.value,
                                  })
                                }
                                onKeyDown={movePriceFocus}
                              />
                              <Select
                                aria-label={`${t('supplierPoRateUnit')} ${visit.equipment_code}`}
                                className="w-28 shrink-0"
                                value={line.rate_unit}
                                options={rateUnitOptions}
                                onValueChange={(value) =>
                                  setLine(visit.equipment_id, {
                                    rate_unit: saleRateUnitOf(value),
                                  })
                                }
                              />
                            </div>
                            <div className="flex gap-2">
                              <Input
                                dir="ltr"
                                inputMode="numeric"
                                placeholder={`${t('clientPoStandardHours')} ${form.standard_hours.trim() || CLIENT_PO_STANDARD_HOURS_DEFAULT}`}
                                aria-label={`${t('clientPoStandardHours')} ${visit.equipment_code}`}
                                value={line.standard_hours}
                                className="min-w-0 flex-1"
                                onChange={(event) =>
                                  setLine(visit.equipment_id, {
                                    standard_hours: event.target.value,
                                  })
                                }
                              />
                              <Input
                                dir="ltr"
                                inputMode="decimal"
                                placeholder={t('clientPoQuantity')}
                                aria-label={`${t('clientPoQuantity')} ${visit.equipment_code}`}
                                value={line.quantity}
                                className="min-w-0 flex-1"
                                onChange={(event) =>
                                  setLine(visit.equipment_id, {
                                    quantity: event.target.value,
                                  })
                                }
                              />
                            </div>
                            {/* Under the LTR fields, at their own start. */}
                            <p
                              dir="ltr"
                              className="min-h-4 text-start text-xs text-muted"
                            >
                              {lineErrors[visit.equipment_id] ? (
                                <span className="text-danger">
                                  {t(lineErrors[visit.equipment_id])}
                                </span>
                              ) : line.price.trim() ? (
                                <SalePricePreview value={line.price} />
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
            <SalePricesByUnit
              className="text-base font-semibold text-fg"
              parts={
                clientPoTotalsByUnit(
                  Object.values(picked).map((line) => ({
                    price: isValidSalePrice(line.price)
                      ? Number(line.price)
                      : null,
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
