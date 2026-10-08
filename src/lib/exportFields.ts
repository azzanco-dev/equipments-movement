/**
 * wave-15-export-fields: the fields both `/logs` exports (movements in
 * `@/lib/movementExcel`, visits in `@/lib/visitsList`) share, and the
 * lookups they make at export time for the values their views do not carry.
 *
 * The views (`movement_log_search`, `movement_visits`) are left as they are
 * (no migration): the supplier, a visit's chassis number, the current driver
 * of an entry, a driver's mobile number and the exit supervisor's name are
 * read once per export, only for the ids in the file, in bounded chunks
 * (`EXPORT_LOOKUP_CHUNK_SIZE`, at most `EXPORT_LOOKUP_PARALLEL` requests at a
 * time). Every loader throws on a failed query (`unwrapRows`), so the dialog
 * reports an export failure instead of writing cells that are silently empty.
 *
 * The client is an argument, so the loaders are tested without a browser.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TranslationKey } from '@/i18n/translations'
import { unwrapRows } from '@/lib/supabaseResult'

type Translate = (key: TranslationKey) => string

// ============ OWNER ============

/** The owner names of the export files, as the owner asked for them (2026-10-04). */
const OWNER_LABEL_KEYS: Record<string, TranslationKey> = {
  alazani: 'exportOwnerAlazani',
  takween: 'ownershipTakween',
  third_party_f: 'exportOwnerThirdPartyF',
  third_party_partnership_b: 'exportOwnerThirdPartyB',
  external_supplier: 'adminHomeOwnerExternal',
}

/**
 * The owner cell: the localized owner name, the raw value for an owner the app
 * does not know yet (never blank), and empty when the view returned none.
 */
export function exportOwnerLabel(
  status: string | null | undefined,
  t: Translate,
): string {
  if (!status) return ''
  const key = OWNER_LABEL_KEYS[status]
  return key ? t(key) : status
}

/** A master-data name for a sheet cell: trimmed, empty (never a dash) when missing. */
export function exportText(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

// ============ LOOKUP MAPS ============

/**
 * The values looked up at export time, keyed by id. A missing map, or an id
 * absent from it, exports an empty cell.
 */
export interface ExportLookups {
  /** Equipment id → supplier (lessor) name. */
  supplierByEquipment?: ReadonlyMap<string, string>
  /** Equipment id → chassis number (the visits view does not carry it). */
  chassisByEquipment?: ReadonlyMap<string, string>
  /** Driver id → mobile number. */
  mobileByDriver?: ReadonlyMap<string, string>
  /** Profile id → full name (the exit supervisor of a visit). */
  nameByProfile?: ReadonlyMap<string, string>
}

/** `map.get(id)`, or empty for a missing id or map. */
export function lookupValue(
  map: ReadonlyMap<string, string> | undefined,
  id: string | null | undefined,
): string {
  return (id ? map?.get(id) : undefined) ?? ''
}

/** Ids are looked up this many per request, so a URL stays short. */
export const EXPORT_LOOKUP_CHUNK_SIZE = 100

/** At most this many lookup requests run at the same time. */
export const EXPORT_LOOKUP_PARALLEL = 4

/** Splits a list into consecutive chunks of at most `size` (at least one). */
export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.trunc(size))
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += step)
    chunks.push(items.slice(index, index + step))
  return chunks
}

/** The distinct, non-empty ids of a list, in first-seen order. */
export function distinctIds(
  ids: readonly (string | null | undefined)[],
): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id)))
}

/** One `equipment` row as the export lookup selects it. */
export interface EquipmentExportRow {
  id: string
  chassis_number?: string | null
  /** PostgREST returns an embedded to-one row as an object (or null). */
  lessor?: { name: string | null } | { name: string | null }[] | null
}

/** The equipment lookup's select: one request gives the supplier and the chassis. */
export const EQUIPMENT_EXPORT_SELECT = 'id,chassis_number,lessor:lessors(name)'

/**
 * Maps equipment id to supplier (lessor) name. A unit without a lessor, or a
 * lessor without a name, is simply absent, so its cell exports empty.
 */
export function supplierNamesByEquipment(
  rows: readonly EquipmentExportRow[],
  into: Map<string, string> = new Map(),
): Map<string, string> {
  for (const row of rows) {
    const lessor = Array.isArray(row.lessor) ? row.lessor[0] : row.lessor
    const name = lessor?.name?.trim()
    if (row.id && name) into.set(row.id, name)
  }
  return into
}

/** Maps equipment id to chassis number; a unit without one is absent. */
export function chassisNumbersByEquipment(
  rows: readonly EquipmentExportRow[],
  into: Map<string, string> = new Map(),
): Map<string, string> {
  for (const row of rows) {
    const chassis = row.chassis_number?.trim()
    if (row.id && chassis) into.set(row.id, chassis)
  }
  return into
}

/** One `drivers` row as the mobile lookup selects it. */
export interface DriverMobileRow {
  id: string
  mobile_number: string | null
}

/**
 * Maps driver id to mobile number. A driver without a number is simply
 * absent, so the cell exports empty.
 */
export function driverMobilesById(
  rows: readonly DriverMobileRow[],
  into: Map<string, string> = new Map(),
): Map<string, string> {
  for (const row of rows) {
    const mobile = row.mobile_number?.trim()
    if (row.id && mobile) into.set(row.id, mobile)
  }
  return into
}

/** One `profile_names` row as the name lookup selects it. */
export interface ProfileNameRow {
  id: string
  full_name: string | null
}

/** Maps profile id to full name; a profile without a name is absent. */
export function profileNamesById(
  rows: readonly ProfileNameRow[],
  into: Map<string, string> = new Map(),
): Map<string, string> {
  for (const row of rows) {
    const name = row.full_name?.trim()
    if (row.id && name) into.set(row.id, name)
  }
  return into
}

// ============ DRIVER CHANGES ============

/** One `movement_driver_changes` row as the current-driver lookup selects it. */
export interface DriverChangeRow {
  id: string
  entry_log_id: string
  new_driver_id: string | null
  new_driver_name: string | null
  changed_at: string
}

/** The columns of `DriverChangeRow`, for the lookup's select. */
export const DRIVER_CHANGES_SELECT =
  'id,entry_log_id,new_driver_id,new_driver_name,changed_at'

/**
 * The latest change of each entry, by `(changed_at, id)` whatever the input
 * order: the CURRENT driver of the visit that entry opened.
 */
export function latestDriverChanges(
  changes: readonly DriverChangeRow[],
): Map<string, DriverChangeRow> {
  const latest = new Map<string, DriverChangeRow>()
  for (const change of changes) {
    const current = latest.get(change.entry_log_id)
    if (
      !current ||
      change.changed_at > current.changed_at ||
      (change.changed_at === current.changed_at && change.id > current.id)
    )
      latest.set(change.entry_log_id, change)
  }
  return latest
}

// ============ LOADERS ============

/**
 * Runs `load` over the distinct ids in chunks, a few chunks at a time. A
 * failure rejects the whole lookup.
 */
export async function lookupInChunks(
  ids: readonly (string | null | undefined)[],
  load: (chunk: string[]) => Promise<void>,
): Promise<void> {
  const chunks = chunkItems(distinctIds(ids), EXPORT_LOOKUP_CHUNK_SIZE)
  for (let start = 0; start < chunks.length; start += EXPORT_LOOKUP_PARALLEL)
    await Promise.all(
      chunks.slice(start, start + EXPORT_LOOKUP_PARALLEL).map(load),
    )
}

/**
 * The supplier and the chassis number of the units in a file, in ONE request
 * per chunk (`EQUIPMENT_EXPORT_SELECT`). Both views use it: the movement view
 * carries the chassis itself, the visits view carries neither.
 */
export async function loadEquipmentExportDetails(
  client: SupabaseClient,
  equipmentIds: readonly (string | null | undefined)[],
): Promise<{
  supplierByEquipment: Map<string, string>
  chassisByEquipment: Map<string, string>
}> {
  const supplierByEquipment = new Map<string, string>()
  const chassisByEquipment = new Map<string, string>()
  await lookupInChunks(equipmentIds, async (ids) => {
    const rows = unwrapRows(
      await client
        .from('equipment')
        .select(EQUIPMENT_EXPORT_SELECT)
        .in('id', ids),
    ) as unknown as EquipmentExportRow[]
    supplierNamesByEquipment(rows, supplierByEquipment)
    chassisNumbersByEquipment(rows, chassisByEquipment)
  })
  return { supplierByEquipment, chassisByEquipment }
}

/** The mobile numbers of the drivers in a file. */
export async function loadDriverMobiles(
  client: SupabaseClient,
  driverIds: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const mobileByDriver = new Map<string, string>()
  await lookupInChunks(driverIds, async (ids) => {
    const rows = unwrapRows(
      await client.from('drivers').select('id,mobile_number').in('id', ids),
    ) as unknown as DriverMobileRow[]
    driverMobilesById(rows, mobileByDriver)
  })
  return mobileByDriver
}

/**
 * The names of the profiles in a file, through `profile_names` (migration
 * 0099: id, full_name and role only, readable by every signed-in user).
 */
export async function loadProfileNames(
  client: SupabaseClient,
  profileIds: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const nameByProfile = new Map<string, string>()
  await lookupInChunks(profileIds, async (ids) => {
    const rows = unwrapRows(
      await client.from('profile_names').select('id,full_name').in('id', ids),
    ) as unknown as ProfileNameRow[]
    profileNamesById(rows, nameByProfile)
  })
  return nameByProfile
}

/**
 * The driver changes of a set of entries. Only site entries can have one
 * (workshop rows carry no driver), so the caller passes those ids alone.
 */
export async function loadDriverChanges(
  client: SupabaseClient,
  entryIds: readonly (string | null | undefined)[],
  signal?: AbortSignal,
): Promise<DriverChangeRow[]> {
  const changes: DriverChangeRow[] = []
  await lookupInChunks(entryIds, async (ids) => {
    const query = client
      .from('movement_driver_changes')
      .select(DRIVER_CHANGES_SELECT)
      .in('entry_log_id', ids)
    const rows = unwrapRows(await (signal ? query.abortSignal(signal) : query))
    changes.push(...(rows as unknown as DriverChangeRow[]))
  })
  return changes
}
