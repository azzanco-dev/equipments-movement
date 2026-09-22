import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  DatePicker,
  Dialog,
  ErrorState,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
} from '@/components/ui'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { PlateNumberInput } from '@/components/PlateNumberInput'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { sanitizeSearchTerm } from '@/lib/search'
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

/** Radix reserves '' for "no value", so the optional select uses a sentinel. */
const NO_REGISTRATION_TYPE = 'none'

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
  const langRef = useRef(lang)
  langRef.current = lang
  const [form, setForm] = useState<EquipmentFormValues>(EMPTY_EQUIPMENT_FORM)
  const [projectOption, setProjectOption] = useState<SelectOption | null>(null)
  const [lessorOption, setLessorOption] = useState<SelectOption | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<EquipmentFormValues>>({})
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
  }, [open, equipment])

  const loadEquipmentTypes = useCallback(async (query: string) => {
    let request = supabase
      .from('equipment_types')
      .select('name')
      .order('name')
      .limit(20)
    const term = sanitizeSearchTerm(query)
    if (term) request = request.ilike('name', `%${term}%`)
    const { data } = await request
    return (data ?? []).map((item) => ({ value: item.name, label: item.name }))
  }, [])

  const loadProjects = useCallback(
    async (query: string) => {
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((project) => ({
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
    const term = sanitizeSearchTerm(query)
    if (term) request = request.ilike('name', `%${term}%`)
    const { data } = await request
    return (data ?? []).map((lessor) => ({
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
    try {
      const payload = buildEquipmentPayload(form)
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
      const attributed = equipmentSaveFieldErrors(
        err as { code?: string | null; message?: string | null },
      )
      if (attributed) {
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
        <Field
          label={t('equipmentType')}
          name="type"
          required
          error={errors.type && t(errors.type)}
        >
          {() => (
            <AsyncSearchSelect
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
          {() => (
            <RadioGroup
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
            {() => (
              <PlateNumberInput
                value={form.plate_number}
                onChange={(value) => {
                  clearErrors('plate_number')
                  setForm((current) => ({ ...current, plate_number: value }))
                }}
              />
            )}
          </Field>
        )}
        <Field label={t('manufactureYear')}>
          {(control) => (
            <Input
              {...control}
              type="number"
              placeholder={t('manufactureYearPlaceholder')}
              value={form.manufacture_year}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  manufacture_year: event.target.value,
                }))
              }
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
        <Field label={t('project')}>
          {() => (
            <AsyncSearchSelect
              value={form.project_id}
              selectedOption={projectOption}
              onChange={(value, option) => {
                setForm((current) => ({ ...current, project_id: value }))
                setProjectOption(option)
              }}
              loadOptions={loadProjects}
              placeholder="—"
            />
          )}
        </Field>
        {usesExternalSupplier(form.ownership_status) && (
          <Field label={t('externalSupplier')}>
            {() => (
              <AsyncSearchSelect
                value={form.lessor_id}
                selectedOption={lessorOption}
                onChange={(value, option) => {
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
      </div>
    </Dialog>
  )
}
