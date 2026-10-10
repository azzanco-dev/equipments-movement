import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  DatePicker,
  Dialog,
  ErrorState,
  Field,
  Input,
  Notice,
  RadioGroup,
  RadioGroupItem,
  Select,
} from '@/components/ui'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { useAuth } from '@/auth/AuthContext'
import {
  AFAQY_UNIT_NAME_MAX,
  loadAfaqyUnits,
  searchUnitList,
  type AfaqyUnitsAnswer,
} from '@/lib/afaqy'
import type { SelectOption } from '@/components/Select'
import { PlateNumberInput } from '@/components/PlateNumberInput'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  buildSearchFilter,
  COMPANY_PROJECT_SEARCH_FIELDS,
  NAME_SEARCH_FIELDS,
} from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'
import { localizedName } from '@/lib/localizedName'
import { usesExternalSupplier } from '@/lib/equipmentOwnership'
import {
  EMPTY_EQUIPMENT_FORM,
  EQUIPMENT_FIELD_ORDER,
  EQUIPMENT_STATUSES,
  equipmentStatusKey,
  applyEquipmentCode,
  applyOwnershipStatus,
  buildEquipmentPayload,
  equipmentFormValues,
  equipmentSaveFieldErrors,
  genQrValue,
  ownershipBadge,
  validateEquipmentForm,
  type EquipmentFormValues,
} from '@/lib/equipmentForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import type {
  Equipment,
  EquipmentStatus,
  OperationalStatus,
  OwnershipStatus,
} from '@/lib/types'
import {
  CODE_CHANGE_REASON_MAX,
  isEquipmentCodeChanged,
  isPreviousCodeError,
  ownerSuggestedByNewCode,
} from '@/lib/equipmentCodeHistory'

/** Radix reserves '' for "no value", so the optional select uses a sentinel. */
const NO_REGISTRATION_TYPE = 'none'
/** wave 17: the «بدون وحدة» option of the tracker unit selector. */
const NO_TRACKER_UNIT = 'none'

/** wave 17: the stored tracker link, read when the dialog opens (admin). */
type TrackerLink =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; unitId: string | null; unitName: string | null }

/** The unique index of migration 0122: one unit per equipment. */
function isTrackerUnitTaken(error: {
  code?: string | null
  message?: string | null
  details?: string | null
}): boolean {
  const text = [error.message, error.details].filter(Boolean).join(' ')
  return (
    error.code === '23505' && text.includes('equipment_tracker_unit_id_key')
  )
}

export interface EquipmentFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null adds a new record; a record edits it. */
  equipment: Equipment | null
  onSaved: () => void
}

export function EquipmentFormDialog({
  open,
  onOpenChange,
  equipment,
  onSaved,
}: EquipmentFormDialogProps) {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  // wave 17: the tracker link is admin-only (RLS: `update_equipment`).
  const isAdmin = profile?.role === 'admin'
  const langRef = useRef(lang)
  langRef.current = lang
  const [form, setForm] = useState<EquipmentFormValues>(EMPTY_EQUIPMENT_FORM)
  const [projectOption, setProjectOption] = useState<SelectOption | null>(null)
  const [lessorOption, setLessorOption] = useState<SelectOption | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<EquipmentFormValues>>({})
  // EM-196: optional reason recorded with the previous code when an existing
  // record's code changes.
  const [codeReason, setCodeReason] = useState('')
  // wave 17: the Afaqy tracker unit. Only a CHANGED selection is saved, and
  // only once the stored link was read, so a failed read never clears it.
  const [trackerLink, setTrackerLink] = useState<TrackerLink>({
    state: 'loading',
  })
  const [trackerUnitId, setTrackerUnitId] = useState('')
  const [trackerOption, setTrackerOption] =
    useState<AsyncSearchSelectOption | null>(null)
  const [trackerError, setTrackerError] = useState<string | null>(null)
  const [trackerNotConfigured, setTrackerNotConfigured] = useState(false)
  const unitsRef = useRef<Promise<AfaqyUnitsAnswer | null> | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  /** Editing a field clears its message; nothing is validated while typing. */
  const clearErrors = (...fields: (keyof EquipmentFormValues)[]) =>
    setErrors((current) => clearFieldErrors(current, fields))

  // Reloads the form every time the dialog opens, and when the deep-linked
  // `?edit=` record arrives after the dialog is already open.
  useEffect(() => {
    if (!open) return
    setForm(
      equipment
        ? equipmentFormValues(equipment)
        : { ...EMPTY_EQUIPMENT_FORM, qr_value: genQrValue() },
    )
    setProjectOption(
      equipment?.project
        ? {
            value: equipment.project.id,
            label: localizedName(
              langRef.current,
              equipment.project.name_ar,
              equipment.project.name_en,
            ),
          }
        : null,
    )
    setLessorOption(
      equipment?.lessor
        ? { value: equipment.lessor.id, label: equipment.lessor.name }
        : null,
    )
    setError(null)
    setErrors({})
    setCodeReason('')
  }, [open, equipment])

  // wave 17: read the stored tracker link (admin only). Kept out of the list
  // select, so the list never depends on the link columns.
  useEffect(() => {
    if (!open || !isAdmin) return
    setTrackerError(null)
    setTrackerNotConfigured(false)
    unitsRef.current = null
    setTrackerUnitId('')
    setTrackerOption(null)
    if (!equipment) {
      setTrackerLink({ state: 'ready', unitId: null, unitName: null })
      return
    }
    let active = true
    setTrackerLink({ state: 'loading' })
    void supabase
      .from('equipment')
      .select('tracker_unit_id,tracker_unit_name')
      .eq('id', equipment.id)
      .maybeSingle()
      .then(({ data, error: linkError }) => {
        if (!active) return
        if (linkError || !data) {
          setTrackerLink({ state: 'error' })
          return
        }
        const row = data as {
          tracker_unit_id: string | null
          tracker_unit_name: string | null
        }
        setTrackerLink({
          state: 'ready',
          unitId: row.tracker_unit_id,
          unitName: row.tracker_unit_name,
        })
        setTrackerUnitId(row.tracker_unit_id ?? '')
        setTrackerOption(
          row.tracker_unit_id
            ? {
                value: row.tracker_unit_id,
                label: row.tracker_unit_name || row.tracker_unit_id,
              }
            : null,
        )
      })
    return () => {
      active = false
    }
  }, [open, equipment, isAdmin])

  // One units request per dialog session (the route also caches the list for
  // five minutes). The few hundred units are searched in the browser: it is
  // one admin call of a small external list, not a table of ours.
  const loadTrackerUnits = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      unitsRef.current ??= loadAfaqyUnits(supabase)
      const answer = await unitsRef.current
      const none = { value: NO_TRACKER_UNIT, label: t('afaqyNoUnit') }
      if (answer?.kind === 'not_configured') {
        setTrackerNotConfigured(true)
        return [none]
      }
      if (!answer || answer.kind !== 'ok') {
        unitsRef.current = null
        throw new Error('afaqy_units_failed')
      }
      return [
        none,
        ...searchUnitList(answer.units, query, 19).map((unit) => ({
          value: unit.unitId,
          label: unit.name || unit.unitId,
          description: unit.imei ?? undefined,
        })),
      ]
    },
    [t],
  )

  const loadEquipmentTypes = useCallback(async (query: string) => {
    let request = supabase
      .from('equipment_types')
      .select('name')
      .order('name')
      .limit(20)
    const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows(await request).map((item) => ({
      value: item.name,
      label: item.name,
    }))
  }, [])

  const loadProjects = useCallback(
    async (query: string) => {
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      const searchFilter = buildSearchFilter(
        COMPANY_PROJECT_SEARCH_FIELDS,
        query,
      )
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map((project) => ({
        value: project.id,
        label: localizedName(lang, project.name_ar, project.name_en),
      }))
    },
    [lang],
  )

  const loadLessors = useCallback(async (query: string) => {
    let request = supabase
      .from('lessors')
      .select('id,name')
      .order('name')
      .limit(20)
    const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows(await request).map((lessor) => ({
      value: lessor.id,
      label: lessor.name,
    }))
  }, [])

  /** Ownership is derived from the code prefix; a non-supplier owner clears
   *  the supplier selection as well as the stored `lessor_id`. */
  const updateCode = (code: string) => {
    clearErrors('code')
    setForm((current) => {
      const next = applyEquipmentCode(current, code)
      if (!usesExternalSupplier(next.ownership_status)) setLessorOption(null)
      return next
    })
  }

  const updateOwnership = (status: OwnershipStatus) =>
    setForm((current) => {
      if (!usesExternalSupplier(status)) setLessorOption(null)
      return applyOwnershipStatus(current, status)
    })

  // Editing only: a real code change (not case or spaces) keeps the same
  // equipment and records the previous code in the history (migration 0114).
  const codeChanged =
    equipment !== null && isEquipmentCodeChanged(equipment.code, form.code)
  const suggestedOwner =
    equipment && codeChanged
      ? ownerSuggestedByNewCode(equipment.ownership_status, form.code)
      : null

  const handleSave = async () => {
    const invalid = validateEquipmentForm(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setError(null)
      focusFirstError(invalid, EQUIPMENT_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    setError(null)
    // True once the code change itself is saved, so a later failure of the
    // other fields is reported as the partial save it is.
    let codeSaved = false
    setTrackerError(null)
    try {
      // wave 17: the three link columns travel only when the admin changed
      // the selection after the stored link was read.
      const trackerChanged =
        isAdmin &&
        trackerLink.state === 'ready' &&
        trackerUnitId !== (trackerLink.unitId ?? '')
      const trackerFields = !trackerChanged
        ? {}
        : trackerUnitId
          ? {
              tracker_unit_id: trackerUnitId,
              tracker_unit_name:
                (trackerOption?.label ?? '').slice(0, AFAQY_UNIT_NAME_MAX) ||
                null,
              tracker_linked_at: new Date().toISOString(),
            }
          : {
              tracker_unit_id: null,
              tracker_unit_name: null,
              tracker_linked_at: null,
            }
      const payload = { ...buildEquipmentPayload(form), ...trackerFields }
      if (equipment && codeChanged) {
        // The code goes first through the admin RPC that carries the reason
        // to the history trigger; a rejected code fails before anything is
        // written. The update below then sends the same code, so no second
        // history row is recorded.
        const newCode = form.code.trim()
        const { error: codeError } = await supabase.rpc(
          'admin_change_equipment_code',
          {
            p_equipment_id: equipment.id,
            p_new_code: newCode,
            p_reason: codeReason.trim() || null,
          },
        )
        if (codeError) throw codeError
        codeSaved = true
        payload.code = newCode
      }
      const { error: saveError } = equipment
        ? await supabase
            .from('equipment')
            .update(payload)
            .eq('id', equipment.id)
        : await supabase.from('equipment').insert(payload)
      if (saveError) throw saveError
      onOpenChange(false)
      onSaved()
    } catch (err) {
      console.error(err)
      // A duplicate code, QR value, or plate belongs on that field; anything
      // else stays a safe top-level message, never the raw database text.
      const saveError = err as {
        code?: string | null
        message?: string | null
        details?: string | null
      }
      // A previous code of another unit (0114) has its own message; it is
      // also a 23505, so it is checked before the generic duplicate mapping.
      const attributed: FieldErrors<EquipmentFormValues> | null =
        isPreviousCodeError(saveError)
          ? { code: 'equipmentCodePreviouslyUsed' }
          : equipmentSaveFieldErrors(saveError)
      if (codeSaved) {
        setError(t('equipmentCodeSavedPartially'))
        onSaved()
      } else if (isTrackerUnitTaken(saveError)) {
        setTrackerError(t('afaqyTrackerUnitTaken'))
      } else if (attributed) {
        setErrors(attributed)
        focusFirstError(attributed, EQUIPMENT_FIELD_ORDER, {
          root: bodyRef.current,
        })
      } else {
        setError(t('saveFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={equipment ? t('editEquipment') : t('addEquipment')}
      description={t('dialogDescEquipmentForm')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            {t('save')}
          </Button>
        </>
      }
    >
      {error && <ErrorState title={error} className="mb-4 p-4" />}
      <div ref={bodyRef} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t('equipmentCode')}
          name="code"
          required
          error={errors.code && t(errors.code)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('equipmentCodePlaceholder')}
              value={form.code}
              onChange={(event) => updateCode(event.target.value)}
            />
          )}
        </Field>
        {codeChanged && (
          <div className="space-y-3 sm:col-span-2">
            {suggestedOwner && (
              <Notice tone="info" size="compact">
                {t('codeChangeOwnerNotice').replace(
                  '{owner}',
                  t(ownershipBadge(suggestedOwner).key),
                )}
              </Notice>
            )}
            <Field
              label={t('codeChangeReason')}
              name="code_change_reason"
              hint={t('codeChangeReasonHint')}
            >
              {(control) => (
                <Input
                  {...control}
                  placeholder={t('codeChangeReasonPlaceholder')}
                  maxLength={CODE_CHANGE_REASON_MAX}
                  value={codeReason}
                  onChange={(event) => setCodeReason(event.target.value)}
                />
              )}
            </Field>
          </div>
        )}
        <Field
          label={t('equipmentType')}
          name="type"
          required
          error={errors.type && t(errors.type)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={form.type}
              selectedOption={
                form.type ? { value: form.type, label: form.type } : null
              }
              onChange={(value) => {
                clearErrors('type')
                setForm((current) => ({ ...current, type: value }))
              }}
              loadOptions={loadEquipmentTypes}
              placeholder={t('selectEquipmentType')}
            />
          )}
        </Field>
        <Field
          label={t('equipmentIdentificationType')}
          name="numbering_status"
          required
          className="sm:col-span-2"
        >
          {(control) => (
            <RadioGroup
              {...control}
              value={form.numbering_status}
              onValueChange={(value) => {
                clearErrors('plate_number')
                setForm((current) =>
                  value === 'unnumbered'
                    ? {
                        ...current,
                        numbering_status: 'unnumbered',
                        plate_number: '',
                      }
                    : { ...current, numbering_status: 'numbered' },
                )
              }}
              className="!flex-row !gap-6 rounded-lg border px-3"
            >
              <RadioGroupItem value="numbered" label={t('vehiclePlate')} />
              <RadioGroupItem value="unnumbered" label={t('customsCard')} />
            </RadioGroup>
          )}
        </Field>
        {form.numbering_status === 'numbered' && (
          <Field
            label={t('plateNumber')}
            name="plate_number"
            required
            error={errors.plate_number && t(errors.plate_number)}
            className="sm:col-span-2"
          >
            {(control) => (
              <PlateNumberInput
                {...control}
                value={form.plate_number}
                onChange={(value) => {
                  clearErrors('plate_number')
                  setForm((current) => ({ ...current, plate_number: value }))
                }}
              />
            )}
          </Field>
        )}
        <Field
          label={t('manufactureYear')}
          name="manufacture_year"
          error={errors.manufacture_year && t(errors.manufacture_year)}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              placeholder={t('manufactureYearPlaceholder')}
              value={form.manufacture_year}
              onChange={(event) => {
                clearErrors('manufacture_year')
                setForm((current) => ({
                  ...current,
                  manufacture_year: event.target.value,
                }))
              }}
            />
          )}
        </Field>
        <Field label={t('brand')}>
          {(control) => (
            <Input
              {...control}
              placeholder={t('brandPlaceholder')}
              value={form.brand}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  brand: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('model')}>
          {(control) => (
            <Input
              {...control}
              placeholder={t('modelPlaceholder')}
              value={form.model}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('chassisNumber')}>
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('chassisNumberPlaceholder')}
              value={form.chassis_number}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  chassis_number: event.target.value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('operationalStatus')}>
          {(control) => (
            <Select
              {...control}
              value={form.operational_status}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  operational_status: value as OperationalStatus,
                }))
              }
              options={[
                { value: 'operational', label: t('operational') },
                { value: 'maintenance', label: t('maintenance') },
                { value: 'stopped', label: t('stopped') },
              ]}
            />
          )}
        </Field>
        {/* Lifecycle status (migration 0102). It replaced the activate /
            deactivate toggle, so this select is the only place a record leaves
            or rejoins the fleet. */}
        <Field label={t('equipmentStatus')} hint={t('equipmentStatusHint')}>
          {(control) => (
            <Select
              {...control}
              value={form.status}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  status: value as EquipmentStatus,
                }))
              }
              options={EQUIPMENT_STATUSES.map((value) => ({
                value,
                label: t(equipmentStatusKey(value)),
              }))}
            />
          )}
        </Field>
        <Field label={t('ownershipStatus')}>
          {(control) => (
            <Select
              {...control}
              value={form.ownership_status}
              onValueChange={(value) =>
                updateOwnership(value as OwnershipStatus)
              }
              options={[
                { value: 'alazani', label: t('ownershipAlazani') },
                { value: 'takween', label: t('ownershipTakween') },
                { value: 'third_party_f', label: t('ownershipThirdPartyF') },
                {
                  value: 'third_party_partnership_b',
                  label: t('ownershipThirdPartyPartnershipB'),
                },
                {
                  value: 'external_supplier',
                  label: t('ownershipExternalSupplier'),
                },
              ]}
            />
          )}
        </Field>
        <Field label={t('registrationType')}>
          {(control) => (
            <Select
              {...control}
              value={form.registration_type || NO_REGISTRATION_TYPE}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  registration_type:
                    value === NO_REGISTRATION_TYPE ? '' : value,
                }))
              }
              options={[
                { value: NO_REGISTRATION_TYPE, label: '—' },
                { value: 'private_transport', label: t('privateTransport') },
                { value: 'public_transport', label: t('publicTransport') },
                { value: 'heavy_equipment', label: t('heavyEquipment') },
              ]}
            />
          )}
        </Field>
        <Field
          label={t('project')}
          name="project_id"
          error={errors.project_id && t(errors.project_id)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={form.project_id}
              selectedOption={projectOption}
              onChange={(value, option) => {
                clearErrors('project_id')
                setForm((current) => ({ ...current, project_id: value }))
                setProjectOption(option)
              }}
              loadOptions={loadProjects}
              placeholder="—"
            />
          )}
        </Field>
        {usesExternalSupplier(form.ownership_status) && (
          <Field
            label={t('externalSupplier')}
            name="lessor_id"
            error={errors.lessor_id && t(errors.lessor_id)}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={form.lessor_id}
                selectedOption={lessorOption}
                onChange={(value, option) => {
                  clearErrors('lessor_id')
                  setForm((current) => ({ ...current, lessor_id: value }))
                  setLessorOption(option)
                }}
                loadOptions={loadLessors}
                placeholder="—"
              />
            )}
          </Field>
        )}
        <Field label={t('lastMaintenanceDate')}>
          {(control) => (
            <DatePicker
              {...control}
              value={form.last_maintenance_date}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  last_maintenance_date: value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('registrationExpiry')}>
          {(control) => (
            <DatePicker
              {...control}
              value={form.registration_expiry}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  registration_expiry: value,
                }))
              }
            />
          )}
        </Field>
        <Field label={t('insuranceExpiry')}>
          {(control) => (
            <DatePicker
              {...control}
              value={form.insurance_expiry}
              onChange={(value) =>
                setForm((current) => ({ ...current, insurance_expiry: value }))
              }
            />
          )}
        </Field>
        <Field
          label={t('qrValue')}
          name="qr_value"
          required
          error={errors.qr_value && t(errors.qr_value)}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('qrValuePlaceholder')}
              value={form.qr_value}
              onChange={(event) => {
                clearErrors('qr_value')
                setForm((current) => ({
                  ...current,
                  qr_value: event.target.value,
                }))
              }}
            />
          )}
        </Field>
        {isAdmin && (
          <Field
            label={t('afaqyTrackerUnit')}
            name="tracker_unit_id"
            hint={
              trackerNotConfigured
                ? t('afaqyStatusNotConfigured')
                : t('afaqyTrackerUnitHint')
            }
            error={
              trackerError ??
              (trackerLink.state === 'error'
                ? t('afaqyTrackerLoadError')
                : undefined)
            }
            className="sm:col-span-2"
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={trackerUnitId}
                selectedOption={trackerOption}
                disabled={trackerLink.state !== 'ready'}
                onChange={(value, option) => {
                  setTrackerError(null)
                  if (!value || value === NO_TRACKER_UNIT) {
                    setTrackerUnitId('')
                    setTrackerOption(null)
                  } else {
                    setTrackerUnitId(value)
                    setTrackerOption(option)
                  }
                }}
                loadOptions={loadTrackerUnits}
                placeholder={t('afaqyNoUnit')}
              />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  )
}
