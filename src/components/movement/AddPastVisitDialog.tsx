import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import {
  buildSearchFilter,
  COMPANY_PROJECT_SEARCH_FIELDS,
  DRIVER_SEARCH_FIELDS,
  EQUIPMENT_CODE_TYPE_SEARCH_FIELDS,
  sanitizeSearchTerm,
} from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'
import { roleKeysHolding } from '@/lib/rolePermissionHolders'
import { localizedName } from '@/lib/localizedName'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  pastVisitFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import { formatDate } from '@/lib/dateFormat'
import { formatVisitDuration } from '@/lib/visitsList'
import {
  EMPTY_PAST_VISIT_VALUES,
  PAST_VISIT_CONTRACTOR_CODE_MAX_LENGTH,
  PAST_VISIT_FIELD_ORDER,
  PAST_VISIT_NOTES_MAX_LENGTH,
  pastVisitConflictDays,
  pastVisitConflictProject,
  pastVisitDays,
  pastVisitErrorOutcome,
  pastVisitTodayKey,
  type PastVisitConflict,
  type PastVisitValues,
} from '@/lib/pastVisit'
import { addPastSiteVisit } from '@/lib/pastVisitData'
import {
  AppLink,
  Button,
  DatePicker,
  Dialog,
  Field,
  Input,
  Notice,
  Textarea,
} from '@/components/ui'

export interface AddPastVisitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new ENTRY's id after the visit was stored. */
  onSaved: (entryId: string) => void
}

/**
 * «اضافة زيارة كاملة» (owner 2026-11-15, migration 0197): records a whole PAST
 * project visit — entry and exit — in the name of a foreman through ONE
 * `add_past_site_visit` call. Dates only; the exit is «انتهاء عمل»; no photos.
 * The database re-checks everything (permission, overlap, sequence), so a
 * refusal is shown under its field, or as the conflict panel for an overlap.
 */
export function AddPastVisitDialog({
  open,
  onOpenChange,
  onSaved,
}: AddPastVisitDialogProps) {
  const { t, lang } = useI18n()
  const [values, setValues] = useState<PastVisitValues>(
    EMPTY_PAST_VISIT_VALUES,
  )
  const [options, setOptions] = useState<
    Partial<Record<keyof PastVisitValues, SelectOption | null>>
  >({})
  const [errors, setErrors] = useState<FieldErrors<PastVisitValues>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `undefined` = no conflict; `null` = a conflict the database gave no
  // readable details for.
  const [conflict, setConflict] = useState<PastVisitConflict | null | undefined>(
    undefined,
  )
  const bodyRef = useRef<HTMLDivElement>(null)

  // Every opening starts from an empty form.
  useEffect(() => {
    if (!open) return
    setValues(EMPTY_PAST_VISIT_VALUES)
    setOptions({})
    setErrors({})
    setError(null)
    setConflict(undefined)
  }, [open])

  const update = (patch: Partial<PastVisitValues>) => {
    setValues((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(current, Object.keys(patch) as (keyof PastVisitValues)[]),
    )
    // The dates are what the overlap refusal is about.
    if ('entry_date' in patch || 'exit_date' in patch) setConflict(undefined)
  }

  const selectField = (
    key: keyof PastVisitValues,
    value: string,
    option: SelectOption | null,
  ) => {
    setOptions((current) => ({ ...current, [key]: option }))
    update({ [key]: value } as Partial<PastVisitValues>)
  }

  const loadEquipment = useCallback(async (query: string) => {
    const searchFilter = buildSearchFilter(
      EQUIPMENT_CODE_TYPE_SEARCH_FIELDS,
      query,
    )
    let request = supabase
      .from('equipment')
      .select('id,code,type')
      .order('code')
      .limit(20)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows(await request).map((item) => ({
      value: item.id,
      label: `${item.code} — ${item.type}`,
    }))
  }, [])

  const loadSupervisors = useCallback(async (query: string) => {
    const term = sanitizeSearchTerm(query)
    // The users whose assigned role records project movements.
    const roleKeys = await roleKeysHolding(supabase, 'movements.site.create')
    if (!roleKeys.length) return []
    let request = supabase
      .from('profile_names')
      .select('id,full_name')
      .in('role', roleKeys)
      .order('full_name')
      .limit(20)
    if (term) request = request.ilike('full_name', `%${term}%`)
    return unwrapRows(await request).map((item) => ({
      value: item.id,
      label: item.full_name,
    }))
  }, [])

  const loadNamed = useCallback(
    async (table: 'companies' | 'projects', query: string) => {
      const searchFilter = buildSearchFilter(
        COMPANY_PROJECT_SEARCH_FIELDS,
        query,
      )
      let request = supabase
        .from(table)
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map((item) => ({
        value: item.id,
        label: localizedName(lang, item.name_ar, item.name_en),
      }))
    },
    [lang],
  )
  const loadCompanies = useCallback(
    (query: string) => loadNamed('companies', query),
    [loadNamed],
  )
  const loadProjects = useCallback(
    (query: string) => loadNamed('projects', query),
    [loadNamed],
  )

  const loadDrivers = useCallback(async (query: string) => {
    let request = supabase
      .from('drivers')
      .select('id,full_name,name_en,mobile_number')
      .order('full_name')
      .limit(20)
    const searchFilter = buildSearchFilter(DRIVER_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows(await request).map((driver) => ({
      value: driver.id,
      label: `${driver.full_name}${driver.name_en ? ` — ${driver.name_en}` : ''}${driver.mobile_number ? ` — ${driver.mobile_number}` : ''}`,
    }))
  }, [])

  const showFieldErrors = (fields: FieldErrors<PastVisitValues>) => {
    setErrors(fields)
    focusFirstError(fields, PAST_VISIT_FIELD_ORDER, { root: bodyRef.current })
  }

  const save = async () => {
    const invalid = validateWithSchema<PastVisitValues>(
      pastVisitFormSchema,
      values,
    )
    if (hasErrors(invalid)) {
      setError(null)
      setConflict(undefined)
      showFieldErrors(invalid)
      return
    }

    setBusy(true)
    setError(null)
    setConflict(undefined)
    let saved: { entryId: string } | null = null
    try {
      const result = await addPastSiteVisit(values)
      if (result.error) {
        const outcome = pastVisitErrorOutcome(result.error)
        if (outcome.kind === 'conflict') {
          setConflict(outcome.conflict)
          showFieldErrors(outcome.fields)
        } else if (outcome.kind === 'fields') showFieldErrors(outcome.fields)
        else setError(t(outcome.message))
      } else saved = { entryId: result.data.entryId }
    } catch (cause) {
      console.error('Past visit request failed', cause)
      setError(t('saveFailed'))
    } finally {
      setBusy(false)
    }
    if (!saved) return
    onOpenChange(false)
    onSaved(saved.entryId)
  }

  const fieldError = (key: keyof PastVisitValues) =>
    errors[key] ? t(errors[key]) : undefined

  const days = pastVisitDays(values.entry_date, values.exit_date)
  const durationWords =
    days === null
      ? null
      : days === 0
        ? t('pastVisitSameDay')
        : formatVisitDuration(days * 1440, lang)

  const conflictRange = (() => {
    if (!conflict) return null
    const { from, to } = pastVisitConflictDays(conflict)
    const range = to
      ? t('pastVisitConflictRange')
          .replace('{from}', formatDate(from))
          .replace('{to}', formatDate(to))
      : t('pastVisitConflictRangeOngoing').replace('{from}', formatDate(from))
    const project = pastVisitConflictProject(conflict, lang)
    return project
      ? `${t('pastVisitConflictProject').replace('{project}', project)} ${range}`
      : range
  })()

  const today = pastVisitTodayKey()
  const optional = (label: string) => `${label} (${t('optional')})`

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={t('pastVisitTitle')}
      description={t('pastVisitDesc')}
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {t('pastVisitSubmit')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        <Notice tone="info" size="compact">
          {t('pastVisitNotice')}
        </Notice>
        {error && <Notice tone="danger">{error}</Notice>}
        {conflict !== undefined && (
          <Notice tone="danger">
            <p>{t('pastVisitConflictTitle')}</p>
            {conflictRange && <p className="mt-1">{conflictRange}</p>}
            {conflict && (
              <AppLink
                href={`/movements/${conflict.entryId}`}
                className="mt-1 inline-block font-medium underline underline-offset-2"
              >
                {t('pastVisitConflictLink')}
              </AppLink>
            )}
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('equipmentNameLabel')}
            name="equipment_id"
            required
            error={fieldError('equipment_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={values.equipment_id}
                selectedOption={options.equipment_id}
                onChange={(value, option) =>
                  selectField('equipment_id', value, option)
                }
                loadOptions={loadEquipment}
              />
            )}
          </Field>
          <Field
            label={t('pastVisitSupervisor')}
            name="supervisor_id"
            required
            hint={t('pastVisitSupervisorHint')}
            error={fieldError('supervisor_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={values.supervisor_id}
                selectedOption={options.supervisor_id}
                onChange={(value, option) =>
                  selectField('supervisor_id', value, option)
                }
                loadOptions={loadSupervisors}
              />
            )}
          </Field>
          <Field
            label={t('company')}
            name="company_id"
            required
            error={fieldError('company_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={values.company_id}
                selectedOption={options.company_id}
                onChange={(value, option) =>
                  selectField('company_id', value, option)
                }
                loadOptions={loadCompanies}
              />
            )}
          </Field>
          <Field
            label={t('project')}
            name="project_id"
            required
            error={fieldError('project_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={values.project_id}
                selectedOption={options.project_id}
                onChange={(value, option) =>
                  selectField('project_id', value, option)
                }
                loadOptions={loadProjects}
              />
            )}
          </Field>
          <Field
            label={t('pastVisitEntryDate')}
            name="entry_date"
            required
            error={fieldError('entry_date')}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={values.entry_date}
                max={today}
                onChange={(value) => update({ entry_date: value })}
              />
            )}
          </Field>
          <Field
            label={t('pastVisitExitDate')}
            name="exit_date"
            required
            error={fieldError('exit_date')}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={values.exit_date}
                min={values.entry_date || undefined}
                max={today}
                onChange={(value) => update({ exit_date: value })}
              />
            )}
          </Field>
          {durationWords && (
            <p className="text-xs text-muted sm:col-span-2">
              {t('pastVisitDurationLine').replace('{duration}', durationWords)}
            </p>
          )}
          <Field
            label={optional(t('driverName'))}
            name="driver_id"
            error={fieldError('driver_id')}
          >
            {(control) => (
              <AsyncSearchSelect
                {...control}
                value={values.driver_id}
                selectedOption={options.driver_id}
                onChange={(value, option) =>
                  selectField('driver_id', value, option)
                }
                loadOptions={loadDrivers}
                placeholder={t('pastVisitDriverPlaceholder')}
              />
            )}
          </Field>
          <Field
            label={optional(t('contractorEquipmentCode'))}
            name="contractor_code"
            error={fieldError('contractor_code')}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                value={values.contractor_code}
                maxLength={PAST_VISIT_CONTRACTOR_CODE_MAX_LENGTH}
                placeholder={t('contractorCodePlaceholder')}
                onChange={(event) =>
                  update({ contractor_code: event.target.value })
                }
              />
            )}
          </Field>
        </div>
        <Field
          label={optional(t('notes'))}
          name="notes"
          error={fieldError('notes')}
        >
          {(control) => (
            <Textarea
              {...control}
              value={values.notes}
              maxLength={PAST_VISIT_NOTES_MAX_LENGTH}
              placeholder={t('notesPlaceholder')}
              onChange={(event) => update({ notes: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
