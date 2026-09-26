import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Alert } from '@/components/Alert'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { sanitizeSearchTerm } from '@/lib/search'
import { localizedName } from '@/lib/localizedName'
import type { Company, EntryExitLog, Project } from '@/lib/types'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  MOVEMENT_CONTRACTOR_CODE_MAX_LENGTH,
  MOVEMENT_EDIT_FIELD_ORDER,
  MOVEMENT_NOTES_MAX_LENGTH,
  buildMovementEditPayload,
  localDateKey,
  movementAdminErrorKey,
  movementEditUnchanged,
  validateMovementEdit,
  type MovementDriverEditMode,
  type MovementEditValues,
} from '@/lib/movementAdmin'
import {
  Button,
  DatePicker,
  Dialog,
  Field,
  Input,
  Notice,
  Textarea,
} from '@/components/ui'

const SITE_RECORDER_ROLES = ['admin', 'supervisor']
const WORKSHOP_RECORDER_ROLES = [
  'admin',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
]

export interface MovementEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  movement: EntryExitLog
  company: Company | null
  project: Project | null
  /** The driver shown as current: the latest append on an open visit. */
  driverId: string | null
  driverName: string | null
  /** Which driver path applies — see `movementDriverEditMode`. */
  driverMode: MovementDriverEditMode
  /**
   * The ENTRY that owns the append-only driver-change history; required when
   * `driverMode` is `driver_change`.
   */
  driverEntryId: string | null
  loadDrivers: (query: string) => Promise<SelectOption[]>
  /**
   * Called after something was stored, so the page refetches. `warning` is a
   * translated message when only part of the edit could be stored.
   */
  onSaved: (warning?: string) => void | Promise<void>
}

/**
 * wave6-J4 — the ONE admin correction dialog of a movement.
 *
 * Every field except an open visit's driver is written by a single
 * `PATCH /api/movements/:id`, i.e. one `admin_update_movement` call (migration
 * 0105) in one transaction; the database re-checks the admin role, the
 * ENTRY/EXIT sequence and the driver rules. The driver of an OPEN site visit
 * is never rewritten: that change is appended through
 * `change_active_movement_driver` (migrations 0040/0067) after the correction
 * was stored, so a failure there is reported as a partial success — never as
 * a total failure.
 */
export function MovementEditDialog({
  open,
  onOpenChange,
  movement,
  company,
  project,
  driverId,
  driverName,
  driverMode,
  driverEntryId,
  loadDrivers,
  onSaved,
}: MovementEditDialogProps) {
  const { t, lang } = useI18n()
  const context = movement.movement_context === 'workshop' ? 'workshop' : 'site'
  const site = context === 'site'
  const driverEditable = driverMode !== 'unsupported'

  const initial = useMemo<MovementEditValues>(
    () => ({
      equipment_id: movement.equipment_id ?? '',
      supervisor_id: movement.supervisor_id ?? '',
      movement_date: localDateKey(movement.recorded_at),
      company_id: site ? (company?.id ?? '') : '',
      project_id: site ? (project?.id ?? '') : '',
      contractor_code: site ? (movement.contractor_equipment_code ?? '') : '',
      driver_id: driverEditable ? (driverId ?? '') : '',
      notes: movement.notes ?? '',
    }),
    [movement, company, project, site, driverEditable, driverId],
  )

  const [values, setValues] = useState<MovementEditValues>(initial)
  const [options, setOptions] = useState<
    Partial<Record<keyof MovementEditValues, SelectOption | null>>
  >({})
  const [errors, setErrors] = useState<FieldErrors<MovementEditValues>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Reset from the movement every time the dialog opens, so a cancelled edit
  // never leaves stale values behind.
  useEffect(() => {
    if (!open) return
    setValues(initial)
    setOptions({
      equipment_id: movement.equipment
        ? {
            value: movement.equipment.id,
            label: `${movement.equipment.code} — ${movement.equipment.type}`,
          }
        : null,
      supervisor_id: movement.supervisor
        ? {
            value: movement.supervisor.id,
            label: movement.supervisor.full_name,
          }
        : null,
      company_id: company
        ? {
            value: company.id,
            label: localizedName(lang, company.name_ar, company.name_en),
          }
        : null,
      project_id: project
        ? {
            value: project.id,
            label: localizedName(lang, project.name_ar, project.name_en),
          }
        : null,
      driver_id:
        driverId && driverName ? { value: driverId, label: driverName } : null,
    })
    setErrors({})
    setError(null)
    // `initial` already depends on the movement; labels are refreshed with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  /** Editing a field clears its message; nothing is validated while typing. */
  const update = (patch: Partial<MovementEditValues>) => {
    setValues((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof MovementEditValues)[],
      ),
    )
  }

  const selectField = (
    key: keyof MovementEditValues,
    value: string,
    option: SelectOption | null,
  ) => {
    setOptions((current) => ({ ...current, [key]: option }))
    update({ [key]: value } as Partial<MovementEditValues>)
  }

  const loadEquipment = useCallback(async (query: string) => {
    const term = sanitizeSearchTerm(query)
    let request = supabase
      .from('equipment')
      .select('id,code,type')
      .order('code')
      .limit(20)
    if (term) request = request.or(`code.ilike.%${term}%,type.ilike.%${term}%`)
    const { data } = await request
    return (data ?? []).map((item) => ({
      value: item.id,
      label: `${item.code} — ${item.type}`,
    }))
  }, [])

  const loadSupervisors = useCallback(
    async (query: string) => {
      const term = sanitizeSearchTerm(query)
      let request = supabase
        .from('profiles')
        .select('id,full_name')
        .in('role', site ? SITE_RECORDER_ROLES : WORKSHOP_RECORDER_ROLES)
        .order('full_name')
        .limit(20)
      if (term) request = request.ilike('full_name', `%${term}%`)
      const { data } = await request
      return (data ?? []).map((item) => ({
        value: item.id,
        label: item.full_name,
      }))
    },
    [site],
  )

  const loadNamed = useCallback(
    async (table: 'companies' | 'projects', query: string) => {
      const term = sanitizeSearchTerm(query)
      let request = supabase
        .from(table)
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((item) => ({
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

  const unchanged = movementEditUnchanged(values, initial)

  const save = async () => {
    const invalid = validateMovementEdit(values, context)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setError(null)
      focusFirstError(invalid, MOVEMENT_EDIT_FIELD_ORDER, {
        root: bodyRef.current,
      })
      return
    }

    // An open site visit keeps its entry driver: that change is appended
    // separately, so it never makes the correction call necessary by itself.
    const appendDriver =
      driverMode === 'driver_change' &&
      Boolean(values.driver_id) &&
      values.driver_id !== initial.driver_id
    const correctionNeeded = !movementEditUnchanged(
      appendDriver ? { ...values, driver_id: '' } : values,
      initial,
    )

    setBusy(true)
    setError(null)
    let stored = false
    let failure: string | null = null

    try {
      if (correctionNeeded) {
        const { data: session } = await supabase.auth.getSession()
        const response = await fetch(`/api/movements/${movement.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${session.session?.access_token ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            buildMovementEditPayload(values, {
              context,
              originalRecordedAt: movement.recorded_at,
              currentDriverId: initial.driver_id,
              driverMode,
            }),
          ),
        })
        if (response.ok) {
          stored = true
        } else {
          const result = (await response.json().catch(() => null)) as {
            error?: string
          } | null
          failure = t(movementAdminErrorKey(result?.error, 'update'))
        }
      }

      if (!failure && appendDriver && driverEntryId) {
        const { error: changeError } = await supabase.rpc(
          'change_active_movement_driver',
          {
            p_entry_log_id: driverEntryId,
            p_new_driver_id: values.driver_id,
            p_note: null,
          },
        )
        // Raw PostgreSQL text never reaches the user.
        if (changeError)
          failure = stored
            ? t('movementEditDriverPartial')
            : t('driverChangeFailed')
        else stored = true
      }
    } catch (cause) {
      console.error('Movement edit request failed', cause)
      failure = stored
        ? t('movementEditDriverPartial')
        : t('movementEditFailed')
    } finally {
      setBusy(false)
    }

    if (failure && !stored) {
      setError(failure)
      return
    }
    // Something was stored: close and let the page refetch, carrying the
    // partial-success message when part of the edit failed.
    onOpenChange(false)
    await onSaved(failure ?? undefined)
  }

  const fieldError = (key: keyof MovementEditValues) =>
    errors[key] ? t(errors[key]) : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={t('editMovement')}
      description={t('movementCorrectionDialogDesc')}
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
          <Button
            variant="primary"
            loading={busy}
            disabled={unchanged}
            onClick={save}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
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
            label={t('supervisorName')}
            name="supervisor_id"
            required
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
            label={t('movementDate')}
            name="movement_date"
            required
            hint={t('movementEditDateHint')}
            error={fieldError('movement_date')}
          >
            {(control) => (
              <DatePicker
                {...control}
                value={values.movement_date}
                max={localDateKey(new Date())}
                onChange={(value) => update({ movement_date: value })}
              />
            )}
          </Field>
          {site && (
            <>
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
                label={t('contractorEquipmentCode')}
                name="contractor_code"
                error={fieldError('contractor_code')}
              >
                {(control) => (
                  <Input
                    {...control}
                    dir="ltr"
                    value={values.contractor_code}
                    maxLength={MOVEMENT_CONTRACTOR_CODE_MAX_LENGTH}
                    placeholder={t('contractorCodePlaceholder')}
                    onChange={(event) =>
                      update({ contractor_code: event.target.value })
                    }
                  />
                )}
              </Field>
            </>
          )}
          {driverEditable && (
            <Field
              label={t('driverName')}
              name="driver_id"
              error={fieldError('driver_id')}
              className="sm:col-span-2"
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
                  placeholder={t('selectDriver')}
                />
              )}
            </Field>
          )}
        </div>
        {driverMode === 'driver_change' && (
          <Notice tone="info" size="compact">
            {t('movementEditOpenVisitDriverHint')}
          </Notice>
        )}
        <Field label={t('notes')} name="notes" error={fieldError('notes')}>
          {(control) => (
            <Textarea
              {...control}
              value={values.notes}
              maxLength={MOVEMENT_NOTES_MAX_LENGTH}
              placeholder={t('notesPlaceholder')}
              onChange={(event) => update({ notes: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
