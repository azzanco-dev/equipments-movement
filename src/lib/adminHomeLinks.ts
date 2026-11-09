/**
 * The lists the admin home links to, each in that list's own URL filter
 * format (`useDataListState`; `/logs` keeps its visits view under the `v`
 * prefix). Pure: the cards decide whether the shell opens the page.
 *
 * Moved here from `OwnerTotalsSection` when the home was rebuilt on the
 * approved /ui-kit «نموذج الرئيسية الجديدة v2» (owner 2026-11-09, «اعتمد
 * الرئيسية الي في ui-kit»), so the KPI strip, the fleet card and the
 * workshop card share one definition of every link.
 */

import type { AdminHomeOwner } from '@/lib/adminHomeStats'
import { EMPTY_FILTER_VALUE } from '@/lib/applyListFilters'
import { SUPPLIER_FILTER_KEY } from '@/lib/equipmentSupplier'

type UrlFilter = { id: string; field: string; operator: string; value: string }

const filtersParam = (filters: UrlFilter[]) =>
  encodeURIComponent(JSON.stringify(filters))

const OPEN_VISIT: UrlFilter = {
  id: 'open',
  field: 'is_open',
  operator: 'eq',
  value: 'true',
}

const ACTIVE_STATUS: UrlFilter = {
  id: 'status',
  field: 'status',
  operator: 'eq',
  value: 'active',
}

/** The URL filter of the chosen owners: `eq` for one, `in` for several, none
 *  for an empty selection (every owner). */
export function ownersFilter(
  field: string,
  owners: readonly AdminHomeOwner[],
): UrlFilter[] {
  if (owners.length === 0) return []
  return [
    owners.length === 1
      ? { id: 'owner', field, operator: 'eq', value: owners[0] }
      : { id: 'owner', field, operator: 'in', value: owners.join(',') },
  ]
}

/** The equipment list of the active fleet (every owner). */
export function activeFleetHref(): string {
  return `/equipment?filters=${filtersParam([ACTIVE_STATUS])}`
}

/** The equipment list filtered to one owner's active units. */
export function ownerEquipmentHref(owner: AdminHomeOwner): string {
  return `/equipment?filters=${filtersParam([
    { id: 'owner', field: 'ownership_status', operator: 'eq', value: owner },
    ACTIVE_STATUS,
  ])}`
}

/** The log's projects tab as visits: the units inside a project now (every
 *  owner). `/logs` opens on the projects tab and the visits view. */
export function openProjectVisitsHref(): string {
  return `/logs?vfilters=${filtersParam([OPEN_VISIT])}`
}

/**
 * The log's open project visits of one owner, or one supplier of «مالك اخر»
 * (owner 2026-10-29, «في المشاريع مفروض الدخوليات وكذلك الموردون في
 * المشاريع»). A supplier-less row (`lessorId` null) is the multi-select's
 * «no value» entry.
 */
export function insideProjectsLogHref(
  owner: AdminHomeOwner,
  lessorId?: string | null,
): string {
  return `/logs?vfilters=${filtersParam([
    OPEN_VISIT,
    {
      id: 'owner',
      field: 'equipment_ownership_status',
      operator: 'eq',
      value: owner,
    },
    ...(lessorId !== undefined
      ? [
          {
            id: 'supplier',
            field: SUPPLIER_FILTER_KEY,
            operator: 'in',
            value: lessorId ?? EMPTY_FILTER_VALUE,
          },
        ]
      : []),
  ])}`
}

/** The log's workshop tab as visits: every open workshop visit of the chosen
 *  owners (empty = every owner). */
export function openWorkshopVisitsHref(
  owners: readonly AdminHomeOwner[] = [],
): string {
  return `/logs?context=workshop&vfilters=${filtersParam([
    OPEN_VISIT,
    ...ownersFilter('equipment_ownership_status', owners),
  ])}`
}

/** The log's open workshop visits of one purpose (`null` = not classified
 *  yet) for the chosen owners (empty = every owner). */
export function workshopStateLogHref(
  purpose: 'maintenance' | 'parking' | 'out_of_service' | null,
  owners: readonly AdminHomeOwner[] = [],
): string {
  return `/logs?context=workshop&vfilters=${filtersParam([
    OPEN_VISIT,
    purpose
      ? {
          id: 'purpose',
          field: 'workshop_purpose',
          operator: 'eq',
          value: purpose,
        }
      : {
          id: 'purpose',
          field: 'workshop_purpose',
          operator: 'is_not_set',
          value: '',
        },
    ...ownersFilter('equipment_ownership_status', owners),
  ])}`
}

/** The equipment list of the active available units of the chosen owners
 *  (empty = every owner). */
export function availableEquipmentHref(
  owners: readonly AdminHomeOwner[] = [],
): string {
  return `/equipment?filters=${filtersParam([
    {
      id: 'state',
      field: 'equipment_state',
      operator: 'eq',
      value: 'available',
    },
    ACTIVE_STATUS,
    ...ownersFilter('ownership_status', owners),
  ])}`
}

/** The movement log (not the visits): «اخر الحركات» › «عرض الكل». */
export function movementLogHref(): string {
  return '/logs?view=log'
}

/** One movement's page. */
export function movementHref(id: string): string {
  return `/movements/${id}`
}
