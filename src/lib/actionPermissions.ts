import type { PermissionScope } from '@/lib/types'
import type { PermissionsStatus } from '@/lib/permissions'
import type { PhotoRemoval, PhotoViewer } from '@/lib/movementPhotoGallery'

/**
 * wave 24 (actions by permissions) — the in-screen action and data decisions
 * that used to compare `profiles.role` now read the permissions of
 * `current_permissions()` (migration 0126) through `usePermissions()`.
 *
 * Every decision here is a pure function of
 *   (the permission state, the facts of the row)
 * so tests/wave24Actions.test.cjs can prove that, with the frozen legacy
 * mapping of the six roles, every answer equals the role rule it replaced.
 *
 * Roles stage 4a (2026-10-27): no decision reads `profiles.role` any more.
 * Until the permissions are 'ready' (while they load, or after a failed
 * load) every decision is the permission rule over an EMPTY map, so nothing
 * is granted (fail closed); once ready the answers are unchanged.
 *
 * Presentation only: every action is re-checked in PostgreSQL / the API
 * routes, which stay authoritative. Scope rules are mirrored for display:
 * `own` = the rows the user recorded; `site` / `workshop` = that context plus
 * own rows; `companies` cannot be evaluated in the browser without the user's
 * company list, so for display it is treated like `site` and the database
 * gives the final answer.
 *
 * This file has no runtime imports so the node tests can load it directly.
 */

export interface ActionPermissionState {
  status: PermissionsStatus
  permissions: ReadonlyMap<string, PermissionScope>
}

const NOTHING_GRANTED: ReadonlyMap<string, PermissionScope> = new Map()

/** The granted permissions: the loaded map once 'ready', else none. */
export function grantedPermissions(
  state: ActionPermissionState,
): ReadonlyMap<string, PermissionScope> {
  return state.status === 'ready' ? state.permissions : NOTHING_GRANTED
}

/**
 * THE switch: the permissions answer once they are 'ready'; while they load
 * or after a failed load the same rule answers over an empty map, so nothing
 * is granted (roles stage 4a: no role fallback).
 */
export function decideByPermissions<T>(
  state: ActionPermissionState,
  byPermissions: (permissions: ReadonlyMap<string, PermissionScope>) => T,
): T {
  return byPermissions(grantedPermissions(state))
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export interface MovementRowFacts {
  /** The signed-in user recorded the movement (`supervisor_id = auth.uid()`). */
  own: boolean
  context: 'site' | 'workshop'
}

/** Whether a granted scope covers the movement, for display (see header). */
export function scopeAllowsMovement(
  scope: PermissionScope | null | undefined,
  row: MovementRowFacts,
): boolean {
  switch (scope) {
    case 'all':
      return true
    case 'own':
      return row.own
    case 'site':
    case 'companies':
      return row.own || row.context === 'site'
    case 'workshop':
      return row.own || row.context === 'workshop'
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Movement detail (src/screens/MovementDetail.tsx)
// ---------------------------------------------------------------------------

export interface MovementDetailFacts extends MovementRowFacts {
  isEntry: boolean
  /** An ENTRY whose EXIT does not exist yet. */
  visitOpen: boolean
}

export type { PhotoRemoval }

export interface MovementDetailActions {
  /** The «خيارات» menu (edit / delete) and the admin-only detail rows. */
  editDelete: boolean
  /** The driver-change button of an open site entry. */
  changeDriver: boolean
  /** The pencil of the contractor code (own open site entry). */
  editContractorCode: boolean
  /** Adding photos to this movement. */
  addPhotos: boolean
  /** Which saved photos get the remove button. */
  photoRemoval: PhotoRemoval
}

export function movementDetailActionsFromPermissions(
  permissions: ReadonlyMap<string, PermissionScope>,
  facts: MovementDetailFacts,
): MovementDetailActions {
  return {
    editDelete: permissions.has('movements.edit_delete'),
    changeDriver: scopeAllowsMovement(
      permissions.get('movements.site.driver_change'),
      facts,
    ),
    editContractorCode:
      permissions.has('movements.site.contractor_code') &&
      facts.own &&
      facts.isEntry &&
      facts.context === 'site' &&
      facts.visitOpen,
    addPhotos: scopeAllowsMovement(
      permissions.get('movements.photos.manage'),
      facts,
    ),
    photoRemoval: permissions.has('movements.photos.delete_any')
      ? 'any'
      : permissions.has('movements.photos.manage')
        ? 'own'
        : 'none',
  }
}

export function movementDetailActions(
  state: ActionPermissionState,
  facts: MovementDetailFacts,
): MovementDetailActions {
  return decideByPermissions(state, (permissions) =>
    movementDetailActionsFromPermissions(permissions, facts),
  )
}

/**
 * The viewer `canRemoveSavedPhoto` (src/lib/movementPhotoGallery.ts) expects:
 * the decided removal ('any' / 'own' / 'none') and the signed-in user.
 */
export function photoViewerFor(
  removal: PhotoRemoval,
  userId: string | null | undefined,
): PhotoViewer {
  return { userId, removal }
}

export interface MovementSkeletonShape {
  /** The likeliest context before the movement row arrived. */
  context: 'site' | 'workshop'
  /** The square «خيارات» button placeholder. */
  adminMenu: boolean
  /** The add-photo control placeholder. */
  canUpload: boolean
}

export function movementSkeletonShapeFromPermissions(
  permissions: ReadonlyMap<string, PermissionScope>,
): MovementSkeletonShape {
  return {
    context: permissions.has('home.workshop') ? 'workshop' : 'site',
    adminMenu: permissions.has('movements.edit_delete'),
    canUpload: permissions.has('movements.photos.manage'),
  }
}

/** Until the permissions are ready: the neutral site shape, no actions. */
export function movementSkeletonShape(
  state: ActionPermissionState,
): MovementSkeletonShape {
  return decideByPermissions(state, movementSkeletonShapeFromPermissions)
}

// ---------------------------------------------------------------------------
// Movement form (src/components/EntryExitForm.tsx)
// ---------------------------------------------------------------------------

export interface MovementFormActions {
  /**
   * The limited workshop form instead of the site form. A user holding both
   * create keys gets the site form, as the admin always did.
   */
  workshopMode: boolean
  /** A site EXIT may close any foreman's visit (the list is not own-only). */
  exitAnyVisit: boolean
  /** The «ابلاغ الفورمان» panel on a blocked ENTRY. */
  notifyForeman: boolean
  /** The «اضافة معدة +» button of the form's context. */
  quickCreateEquipment: boolean
  /** The «اضافة سائق +» option of the site ENTRY driver field. */
  quickCreateDriver: boolean
  /** The «اضافة مورد +» option of the quick equipment form. */
  quickCreateLessor: boolean
}

export function movementFormActionsFromPermissions(
  permissions: ReadonlyMap<string, PermissionScope>,
): MovementFormActions {
  const workshopMode =
    permissions.has('movements.workshop.create') &&
    !permissions.has('movements.site.create')
  const quickEquipmentScope = permissions.get('equipment.quick_create')
  return {
    workshopMode,
    // search_site_exit_equipment (0127) lists every open visit for
    // `movements.exit_cross_context` or the `movements.site.create` scope all.
    exitAnyVisit:
      permissions.has('movements.exit_cross_context') ||
      permissions.get('movements.site.create') === 'all',
    notifyForeman: permissions.has('movements.notify_foreman'),
    quickCreateEquipment:
      quickEquipmentScope === 'all' ||
      quickEquipmentScope === (workshopMode ? 'workshop' : 'site'),
    quickCreateDriver: permissions.has('drivers.quick_create'),
    quickCreateLessor: permissions.has('lessors.quick_create'),
  }
}

export function movementFormActions(
  state: ActionPermissionState,
): MovementFormActions {
  return decideByPermissions(state, movementFormActionsFromPermissions)
}

// ---------------------------------------------------------------------------
// Field home (src/screens/HomeScreen.tsx)
// ---------------------------------------------------------------------------

export interface HomeActions {
  /** Classifying pending workshop entries (the purpose select). */
  classifyWorkshopEntries: boolean
}

export function homeActionsFromPermissions(
  permissions: ReadonlyMap<string, PermissionScope>,
): HomeActions {
  return {
    classifyWorkshopEntries: permissions.has('movements.workshop.classify'),
  }
}

export function homeActions(state: ActionPermissionState): HomeActions {
  return decideByPermissions(state, homeActionsFromPermissions)
}

// ---------------------------------------------------------------------------
// Admin screens and cards: one key each
// ---------------------------------------------------------------------------

export interface EquipmentFormActions {
  /** The Afaqy tracker unit field (wave 17). */
  trackerLink: boolean
  /** Changing the code of an existing unit (`admin_change_equipment_code`). */
  changeCode: boolean
}

export function equipmentFormActions(
  state: ActionPermissionState,
): EquipmentFormActions {
  return decideByPermissions(state, (permissions) => ({
    // The field also lists the Afaqy units, which /api/afaqy/units serves
    // for `settings.integrations` only.
    trackerLink:
      permissions.has('equipment.tracker_link') &&
      permissions.has('settings.integrations'),
    changeCode: permissions.has('equipment.change_code'),
  }))
}

export interface EquipmentListActions {
  /** «اضافة معدة» (`equipment.create`, policy insert_equipment). */
  create: boolean
  /** The edit buttons and the `?edit=` link (`equipment.edit`, policy
   *  update_equipment). Without it the update matches no row. */
  edit: boolean
  /** The Excel import and update (`equipment.import`). */
  importRows: boolean
}

export function equipmentListActions(
  state: ActionPermissionState,
): EquipmentListActions {
  return decideByPermissions(state, (permissions) => ({
    create: permissions.has('equipment.create'),
    edit: permissions.has('equipment.edit'),
    importRows: permissions.has('equipment.import'),
  }))
}

export interface UsersActions {
  /** Adding, editing and saving users (`users.manage`). */
  manage: boolean
}

export function usersActions(state: ActionPermissionState): UsersActions {
  return decideByPermissions(state, (permissions) => ({
    manage: permissions.has('users.manage'),
  }))
}

/** The WhatsApp gateway status (sidebar indicator, polling, home alert). */
export function canSeeIntegrationsStatus(
  state: ActionPermissionState,
): boolean {
  return decideByPermissions(state, (permissions) =>
    permissions.has('settings.integrations'),
  )
}

/** The «الموقع الحالي» card (Afaqy position). */
export function canViewEquipmentLocation(
  state: ActionPermissionState,
): boolean {
  return decideByPermissions(state, (permissions) =>
    permissions.has('equipment.location.view'),
  )
}
