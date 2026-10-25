import type { PermissionScope } from '@/lib/types'
import type { PermissionsStatus } from '@/lib/permissions'
import type { PhotoViewer } from '@/lib/movementPhotoGallery'

/**
 * wave 24 (actions by permissions) — the in-screen action and data decisions
 * that used to compare `profiles.role` now read the permissions of
 * `current_permissions()` (migration 0126) through `usePermissions()`.
 *
 * Every decision here is a pure function of
 *   (the permission state, the legacy role, the facts of the row)
 * so tests/wave24Actions.test.cjs can prove that, with the frozen legacy
 * mapping of the six roles (the roles system OFF), every answer equals the
 * role rule it replaces. Those old rules are kept VERBATIM in this file as the
 * `legacy*` functions: they are the fallback while the permissions load or
 * after a failed load (`status` 'loading' or 'error'), exactly today's
 * behaviour then, and nothing else ever reads them.
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

export type LegacyRole = string | null | undefined

export const WORKSHOP_ROLES: readonly string[] = [
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
]

export function isWorkshopRole(role: LegacyRole): boolean {
  return typeof role === 'string' && WORKSHOP_ROLES.includes(role)
}

/**
 * THE fallback switch: the permissions answer once they are 'ready'; while
 * they load or after a failed load the legacy role rule answers, exactly as
 * the screens did before wave 24.
 */
export function decideByPermissions<T>(
  state: ActionPermissionState,
  role: LegacyRole,
  byPermissions: (permissions: ReadonlyMap<string, PermissionScope>) => T,
  byRole: (role: LegacyRole) => T,
): T {
  return state.status === 'ready'
    ? byPermissions(state.permissions)
    : byRole(role)
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

export type PhotoRemoval = 'any' | 'own' | 'none'

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

/** The pre-wave-24 role rules of MovementDetail, verbatim. FALLBACK ONLY. */
export function legacyMovementDetailActions(
  role: LegacyRole,
  facts: MovementDetailFacts,
): MovementDetailActions {
  return {
    editDelete: role === 'admin',
    changeDriver: role === 'admin' || (role === 'supervisor' && facts.own),
    editContractorCode:
      role === 'supervisor' &&
      facts.isEntry &&
      facts.context === 'site' &&
      facts.visitOpen &&
      facts.own,
    addPhotos:
      role === 'admin' ||
      (role !== 'monitor' && role != null && facts.own) ||
      (isWorkshopRole(role) && facts.context === 'workshop'),
    // canRemoveSavedPhoto (src/lib/movementPhotoGallery.ts): monitor never,
    // admin always, anybody else his own uploads.
    photoRemoval:
      role === 'monitor' ? 'none' : role === 'admin' ? 'any' : 'own',
  }
}

export function movementDetailActions(
  state: ActionPermissionState,
  role: LegacyRole,
  facts: MovementDetailFacts,
): MovementDetailActions {
  return decideByPermissions(
    state,
    role,
    (permissions) => movementDetailActionsFromPermissions(permissions, facts),
    (legacyRole) => legacyMovementDetailActions(legacyRole, facts),
  )
}

/**
 * The viewer `canRemoveSavedPhoto` (src/lib/movementPhotoGallery.ts) expects:
 * its `role` field is that function's three-way switch — 'monitor' removes
 * nothing, 'admin' removes any photo, anything else removes own uploads — so
 * the decided removal is encoded on it; no profile role is read.
 */
export function photoViewerFor(
  removal: PhotoRemoval,
  userId: string | null | undefined,
): PhotoViewer {
  return {
    userId,
    role:
      removal === 'any' ? 'admin' : removal === 'none' ? 'monitor' : 'uploader',
  }
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

/** The pre-wave-24 skeleton guesses of MovementDetail. FALLBACK ONLY. */
export function legacyMovementSkeletonShape(
  role: LegacyRole,
): MovementSkeletonShape {
  return {
    context: isWorkshopRole(role) ? 'workshop' : 'site',
    adminMenu: role === 'admin',
    canUpload: role !== 'monitor',
  }
}

export function movementSkeletonShape(
  state: ActionPermissionState,
  role: LegacyRole,
): MovementSkeletonShape {
  return decideByPermissions(
    state,
    role,
    movementSkeletonShapeFromPermissions,
    legacyMovementSkeletonShape,
  )
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

/** The pre-wave-24 role rules of EntryExitForm, verbatim. FALLBACK ONLY. */
export function legacyMovementFormActions(
  role: LegacyRole,
): MovementFormActions {
  const workshopMode = isWorkshopRole(role)
  return {
    workshopMode,
    exitAnyVisit: role === 'admin',
    notifyForeman: workshopMode || role === 'admin',
    // The quick-create controls had no role check: everybody who could open
    // the form saw them (the database functions decide). The form opens only
    // for a create key (`pageGate('movements/new')`), so a monitor never
    // reaches them.
    quickCreateEquipment: true,
    quickCreateDriver: true,
    quickCreateLessor: true,
  }
}

export function movementFormActions(
  state: ActionPermissionState,
  role: LegacyRole,
): MovementFormActions {
  return decideByPermissions(
    state,
    role,
    movementFormActionsFromPermissions,
    legacyMovementFormActions,
  )
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

/** Pre-wave-24: the two workshop managers classified. FALLBACK ONLY. */
export function legacyHomeActions(role: LegacyRole): HomeActions {
  return {
    classifyWorkshopEntries:
      role === 'workshop_manager' || role === 'assistant_workshop_manager',
  }
}

export function homeActions(
  state: ActionPermissionState,
  role: LegacyRole,
): HomeActions {
  return decideByPermissions(
    state,
    role,
    homeActionsFromPermissions,
    legacyHomeActions,
  )
}

// ---------------------------------------------------------------------------
// Admin screens and cards: one key each, the admin role as the fallback
// ---------------------------------------------------------------------------

export interface EquipmentFormActions {
  /** The Afaqy tracker unit field (wave 17). */
  trackerLink: boolean
  /** Changing the code of an existing unit (`admin_change_equipment_code`). */
  changeCode: boolean
}

export function equipmentFormActions(
  state: ActionPermissionState,
  role: LegacyRole,
): EquipmentFormActions {
  return decideByPermissions(
    state,
    role,
    (permissions) => ({
      // The field also lists the Afaqy units, which /api/afaqy/units serves
      // for `settings.integrations` only.
      trackerLink:
        permissions.has('equipment.tracker_link') &&
        permissions.has('settings.integrations'),
      changeCode: permissions.has('equipment.change_code'),
    }),
    // Pre-wave-24: `isAdmin` guarded both.
    (legacyRole) => ({
      trackerLink: legacyRole === 'admin',
      changeCode: legacyRole === 'admin',
    }),
  )
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
  role: LegacyRole,
): EquipmentListActions {
  return decideByPermissions(
    state,
    role,
    (permissions) => ({
      create: permissions.has('equipment.create'),
      edit: permissions.has('equipment.edit'),
      importRows: permissions.has('equipment.import'),
    }),
    // Before the roles system the equipment screens were the admin's only.
    (legacyRole) => ({
      create: legacyRole === 'admin',
      edit: legacyRole === 'admin',
      importRows: legacyRole === 'admin',
    }),
  )
}

export interface UsersActions {
  /** Adding, editing and saving users (`users.manage`). */
  manage: boolean
}

export function usersActions(
  state: ActionPermissionState,
  role: LegacyRole,
): UsersActions {
  return decideByPermissions(
    state,
    role,
    (permissions) => ({ manage: permissions.has('users.manage') }),
    // Pre-wave-24: the users screens were reachable by the admin only.
    (legacyRole) => ({ manage: legacyRole === 'admin' }),
  )
}

/** The WhatsApp gateway status (sidebar indicator, polling, home alert). */
export function canSeeIntegrationsStatus(
  state: ActionPermissionState,
  role: LegacyRole,
): boolean {
  return decideByPermissions(
    state,
    role,
    (permissions) => permissions.has('settings.integrations'),
    (legacyRole) => legacyRole === 'admin',
  )
}

/** The «الموقع الحالي» card (Afaqy position). */
export function canViewEquipmentLocation(
  state: ActionPermissionState,
  role: LegacyRole,
): boolean {
  return decideByPermissions(
    state,
    role,
    (permissions) => permissions.has('equipment.location.view'),
    (legacyRole) => legacyRole === 'admin',
  )
}
