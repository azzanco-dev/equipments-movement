import type { DataListConfig, ListFilter } from '@/components/data-list/types'
import type { TranslationKey } from '@/i18n/translations'
import {
  ACTIVITY_FIELD_FILTER_KEY,
  ACTIVITY_KIND_FILTER_KEY,
  EQUIPMENT_AUDIT_FIELDS,
} from '@/lib/activityFields'
import { EMPTY_FILTER_VALUE } from '@/lib/applyListFilters'
import { formatDate, formatDateTime } from '@/lib/dateFormat'

export {
  ACTIVITY_FIELD_FILTER_KEY,
  ACTIVITY_KIND_FILTER_KEY,
  EQUIPMENT_AUDIT_FIELDS,
  activityFieldFilterOptions,
} from '@/lib/activityFields'

// The activity page (owner 2026-11-02, approved on /ui-kit «نموذج صفحة
// النشاط الجديدة»): ONE list over the movement log (movement_audit_logs) and
// the equipment change log (equipment_audit_logs, 0168), read through the
// security_invoker view `activity_log` of migration 0170. This module holds
// the pure parts: the row shape and its select, the field labels of both
// logs, the readable form of a stored value, the changed-field filter that
// is not a plain column, the record's page, and the mapping of the old
// /activity URL parameters (`action`, `context`, `kind`) to the unified
// list's `filters`. Nothing here touches Supabase or React.

export type ActivityKind = 'movement' | 'equipment'
export type ActivityAction = 'create' | 'update' | 'delete'

/** One row of `activity_log` (migration 0170). */
export interface ActivityLogRow {
  /** 'm:<id>' / 'e:<id>'. */
  id: string
  kind: ActivityKind
  /** The log row's own id, the tie-break after `created_at`. */
  source_id: number
  /** The movement (kind movement) or the unit (kind equipment); null once
   *  the unit is deleted. */
  record_id: string | null
  action: ActivityAction
  actor_id: string | null
  actor_name: string | null
  equipment_id: string | null
  equipment_code: string | null
  movement_type: 'entry' | 'exit' | null
  movement_context: 'site' | 'workshop' | null
  changed_fields: string[]
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  created_at: string
}

/** Exactly the view's columns; nothing else is read. */
export const ACTIVITY_LOG_SELECT =
  'id,kind,source_id,record_id,action,actor_id,actor_name,equipment_id,equipment_code,movement_type,movement_context,changed_fields,old_values,new_values,created_at'

/** Every equipment column the 0168 trigger may record, labelled. */
const EQUIPMENT_FIELD_LABELS: Readonly<Record<string, TranslationKey>> = {
  ...Object.fromEntries(
    EQUIPMENT_AUDIT_FIELDS.map((field) => [field.key, field.label]),
  ),
  tracker_unit_name: 'activityFieldTrackerUnitName',
  tracker_linked_at: 'activityFieldTrackerLinkedAt',
  qr_value: 'qrValue',
  // Retired columns (AGENTS.md); still audited when a legacy path moves them.
  operational_status: 'activityFieldOperationalStatus',
  master_data_complete: 'activityFieldMasterDataComplete',
}

/** The movement log's keys (0069 / 0070, 0111 exit purpose, 0166 driver
 *  correction), labelled as the old activity screen did. */
const MOVEMENT_FIELD_LABELS: Readonly<Record<string, TranslationKey>> = {
  equipment_id: 'equipment',
  supervisor_id: 'supervisor',
  movement_type: 'movementType',
  movement_context: 'location',
  driver_id: 'driverName',
  driver_name: 'driverName',
  company_id: 'company',
  project_id: 'project',
  contractor_equipment_code: 'contractorEquipmentCode',
  notes: 'notes',
  recorded_at: 'actualMovementTime',
  workshop_purpose: 'workshopPurpose',
  exit_purpose: 'exitPurpose',
  // 0166: a corrected driver of the visit's change history.
  driver_change: 'driverCorrectionAuditField',
}

/** The translation key of a changed field's label, or null for an unknown
 *  key (the screen then shows the key itself). */
export function activityFieldLabelKey(
  kind: ActivityKind,
  field: string,
): TranslationKey | null {
  const labels =
    kind === 'equipment' ? EQUIPMENT_FIELD_LABELS : MOVEMENT_FIELD_LABELS
  return labels[field] ?? null
}

/** One changed field with its stored values; a key missing from a side's
 *  values was NULL there (both logs strip nulls). */
export interface ActivityChange {
  key: string
  before: unknown
  after: unknown
}

/** The row's changes in the order the trigger recorded them. */
export function activityChanges(row: ActivityLogRow): ActivityChange[] {
  return (row.changed_fields ?? []).map((key) => ({
    key,
    before: row.old_values?.[key] ?? null,
    after: row.new_values?.[key] ?? null,
  }))
}

const EQUIPMENT_STATUS_KEYS: Readonly<Record<string, TranslationKey>> = {
  active: 'equipmentStatusActive',
  sold: 'equipmentStatusSold',
  rental_ended: 'equipmentStatusRentalEnded',
}

/** The owner names, the same keys `ownershipBadge` (src/lib/equipmentForm.ts)
 *  gives the badges; copied so this module needs no form code. */
const OWNERSHIP_LABEL_KEYS: Readonly<Record<string, TranslationKey>> = {
  alazani: 'ownershipAlazani',
  takween: 'ownershipTakween',
  third_party_f: 'ownershipThirdPartyF',
  third_party_partnership_b: 'ownershipThirdPartyPartnershipB',
  external_supplier: 'ownershipExternalSupplier',
}

const REGISTRATION_TYPE_KEYS: Readonly<Record<string, TranslationKey>> = {
  private_transport: 'privateTransport',
  public_transport: 'publicTransport',
  heavy_equipment: 'heavyEquipment',
}

const MOVEMENT_VALUE_KEYS: Readonly<
  Record<string, Readonly<Record<string, TranslationKey>>>
> = {
  movement_type: { entry: 'entry', exit: 'exit' },
  movement_context: {
    site: 'activityContextSite',
    workshop: 'workshopLocation',
  },
  workshop_purpose: {
    maintenance: 'maintenancePurpose',
    parking: 'parkingPurpose',
    out_of_service: 'workshopPurposeOutOfService',
  },
  exit_purpose: {
    maintenance: 'exitPurposeMaintenance',
    work_completed: 'exitPurposeWorkCompleted',
  },
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** The translation key a stored enum value reads as, if it has one. */
function valueLabelKey(
  kind: ActivityKind,
  field: string,
  value: string,
): TranslationKey | null {
  if (kind === 'equipment') {
    if (field === 'status') return EQUIPMENT_STATUS_KEYS[value] ?? null
    if (field === 'ownership_status') return OWNERSHIP_LABEL_KEYS[value] ?? null
    if (field === 'registration_type')
      return REGISTRATION_TYPE_KEYS[value] ?? null
    return null
  }
  return MOVEMENT_VALUE_KEYS[field]?.[value] ?? null
}

/**
 * A stored value as the reader sees it: an empty value as a dash, a boolean
 * as نعم / لا, an enum (status, owner, registration type, movement type and
 * context, purposes) as its label, an instant in the Saudi date-time format,
 * a date as a date, anything else as it is. The 0070 / 0168 snapshots already
 * store names for the foreign keys (company, project, driver, supplier), so
 * those come through unchanged; an id the trigger could not resolve stays the
 * id, shortened.
 */
export function formatActivityValue(
  kind: ActivityKind,
  field: string,
  value: unknown,
  t: (key: TranslationKey) => string,
): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return t(value ? 'yes' : 'no')
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return JSON.stringify(value)
  const labelKey = valueLabelKey(kind, field, value)
  if (labelKey) return t(labelKey)
  if (ISO_INSTANT.test(value)) return formatDateTime(value)
  if (DATE_ONLY.test(value)) return formatDate(value)
  if (isUuid(value)) return `${value.slice(0, 8)}…`
  return value
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID.test(value)
}

/** The page the record cell opens: the movement or the unit; none for a
 *  deleted record or a unit that is gone. */
export function activityHref(
  row: Pick<ActivityLogRow, 'kind' | 'action' | 'record_id'>,
): string | null {
  if (!row.record_id || row.action === 'delete') return null
  return row.kind === 'movement'
    ? `/movements/${row.record_id}`
    : `/equipment/${row.record_id}`
}

/** The translation key of the «N fields» line under the code, with the
 *  count to substitute for `{count}`. */
export function activityFieldsCountKey(count: number): TranslationKey {
  if (count === 1) return 'activityFieldsOne'
  if (count === 2) return 'activityFieldsTwo'
  if (count <= 10) return 'activityFieldsFew'
  return 'activityFieldsMany'
}

/**
 * The config's filter keys that reach PostgREST as plain columns through
 * `applyListFilters`: the allowlist minus the changed-field filter.
 */
export function activityColumnFilterKeys(config: DataListConfig): Set<string> {
  return new Set(
    config.filterFields
      .map((field) => field.key)
      .filter((key) => key !== ACTIVITY_FIELD_FILTER_KEY),
  )
}

/** The ticked keys of the «الحقل» filter, limited to known fields; [] for
 *  no filter. */
export function activityFieldFilterValues(
  filters: readonly ListFilter[],
): string[] {
  const filter = filters.find(
    (entry) =>
      entry.field === ACTIVITY_FIELD_FILTER_KEY && entry.operator === 'in',
  )
  if (!filter) return []
  const known = new Set(EQUIPMENT_AUDIT_FIELDS.map((field) => field.key))
  return filter.value
    .split(',')
    .map((value) => value.trim())
    .filter((value) => known.has(value))
}

/** The kind the current filters select, or null for «الكل». */
export function activityKindOf(
  filters: readonly ListFilter[],
): ActivityKind | null {
  const filter = filters.find(
    (entry) =>
      entry.field === ACTIVITY_KIND_FILTER_KEY && entry.operator === 'eq',
  )
  if (filter?.value === 'movement' || filter?.value === 'equipment')
    return filter.value
  return null
}

/** The filters with the kind set (or removed for «الكل»); the dependent
 *  filters are dropped by `useDataListState` through `visibleWhen`. */
export function withActivityKind(
  filters: readonly ListFilter[],
  kind: ActivityKind | null,
): ListFilter[] {
  const rest = filters.filter(
    (entry) => entry.field !== ACTIVITY_KIND_FILTER_KEY,
  )
  if (!kind) return rest
  return [
    {
      id: 'kind',
      field: ACTIVITY_KIND_FILTER_KEY,
      operator: 'eq',
      value: kind,
    },
    ...rest,
  ]
}

const LEGACY_ACTIONS = new Set<string>(['create', 'update', 'delete'])
const LEGACY_CONTEXTS = new Set<string>(['site', 'workshop'])
const LEGACY_KINDS = new Set<string>(['movement', 'equipment'])

/**
 * The old /activity parameters (`action`, `context` of the first screen; the
 * `kind` of the approved mockup's links) as the unified list's `filters`.
 * `q` and `page` are read by `useDataListState` under the same names. Returns
 * the rewritten parameters, or null when nothing legacy is present. A URL
 * that already carries `filters` keeps it: the legacy keys are only removed.
 * A `context` implies the movement kind.
 */
export function legacyActivityParams(
  params: URLSearchParams,
): URLSearchParams | null {
  const action = params.get('action')
  const context = params.get('context')
  const kind = params.get('kind')
  if (action === null && context === null && kind === null) return null
  const next = new URLSearchParams(params.toString())
  next.delete('action')
  next.delete('context')
  next.delete('kind')
  if (next.has('filters')) return next
  const filters: ListFilter[] = []
  const resolvedKind =
    kind && LEGACY_KINDS.has(kind)
      ? kind
      : context && LEGACY_CONTEXTS.has(context)
        ? 'movement'
        : null
  if (resolvedKind)
    filters.push({
      id: 'kind',
      field: ACTIVITY_KIND_FILTER_KEY,
      operator: 'eq',
      value: resolvedKind,
    })
  if (action && LEGACY_ACTIONS.has(action))
    filters.push({
      id: 'action',
      field: 'action',
      operator: 'eq',
      value: action,
    })
  if (resolvedKind === 'movement' && context && LEGACY_CONTEXTS.has(context))
    filters.push({
      id: 'context',
      field: 'movement_context',
      operator: 'eq',
      value: context,
    })
  if (filters.length) next.set('filters', JSON.stringify(filters))
  return next
}

/** The «النظام» option of the user filter: rows with no actor. */
export const ACTIVITY_SYSTEM_ACTOR = EMPTY_FILTER_VALUE
