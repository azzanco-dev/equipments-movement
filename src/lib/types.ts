import type { EquipmentState } from '@/lib/equipmentState'

/**
 * The keys of the six original roles (the 0126 seed of `public.roles`).
 * Since roles stage 4c-2 (migration 0156) it is no column of any table: a
 * user's role is his `profile_roles.role_key`, which may be any role key.
 */
export type UserRole =
  | 'admin'
  | 'supervisor'
  | 'workshop'
  | 'assistant_workshop_manager'
  | 'workshop_manager'
  | 'monitor'

/**
 * Equipment asset status (migration 0102; active / sold only since 0125).
 * Only `active` counts as part of the fleet; a sold unit keeps its history and
 * stays in the equipment list and the inquiry page, but is excluded from the
 * home stats, the admin home, the movement equipment selectors and the
 * current-state reports. The operational state is not stored: see
 * `EquipmentState` (src/lib/equipmentState.ts).
 */
/** 0163: `rental_ended` («منتهية») — a supplier unit whose rental ended. */
export type EquipmentStatus = 'active' | 'sold' | 'rental_ended'
export type OwnershipStatus =
  | 'alazani'
  | 'takween'
  | 'third_party_f'
  | 'third_party_partnership_b'
  | 'external_supplier'
export type RegistrationType =
  'private_transport' | 'public_transport' | 'heavy_equipment'
export type MovementType = 'entry' | 'exit'
export type RegistrationMethod = 'qr' | 'manual'

export interface Driver {
  id: string
  full_name: string
  name_en: string | null
  id_number: string | null
  mobile_number: string | null
  nationality: string | null
  employment_type: string | null
  job_title: string | null
  /** «الرقم الوظيفي» (EM-237, migration 0131): optional, trimmed, unique. */
  employee_number: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  full_name: string
  email?: string
  /**
   * @deprecated Roles stage 4c-2 (migration 0156) dropped `profiles.role`;
   * nothing selects or reads it. Kept optional only so the extracting
   * screen (owned separately) still compiles; it is always undefined.
   */
  role?: string
  assigned_companies?: Array<{ id: string; name_ar: string; name_en: string }>
  must_change_password: boolean
  created_at: string
}

// A user's private contact row (`profile_contacts`, migration 0113). Readable
// by an admin and by the user himself only; written only by the admin RPC
// `admin_set_user_mobile`. No row means no number.
export interface ProfileContact {
  user_id: string
  mobile_number: string | null
  updated_at: string
}

export interface Company {
  id: string
  name_ar: string
  name_en: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name_ar: string
  name_en: string
  created_at: string
  updated_at: string
}

export interface Lessor {
  id: string
  name: string
  /** 0164: optional English name (the supplier PO PDF). */
  name_en?: string | null
  contact_person: string | null
  contact_number: string | null
  created_at: string
  updated_at: string
}

export interface Equipment {
  id: string
  code: string
  type: string
  plate_number: string | null
  plate_digits?: string | null
  plate_letters_en?: string | null
  ownership_status: OwnershipStatus
  project_id: string | null
  lessor_id: string | null
  brand: string | null
  model: string | null
  manufacture_year: number | null
  chassis_number: string | null
  registration_type: RegistrationType | null
  qr_value: string
  last_maintenance_date: string | null
  registration_expiry: string | null
  insurance_expiry: string | null
  is_active: boolean
  /** Optional so a row read by an older `select` list keeps compiling; the UI
   *  treats a missing value as `active`, which is the column default. */
  status?: EquipmentStatus
  numbering_status?: 'numbered' | 'unnumbered'
  created_at: string
  updated_at: string
  /**
   * wave 20 (migration 0125): PostgREST computed fields, present only when the
   * select names them. The one state derived from the latest movement, and
   * (since migration 0129) whether the row was created within the last 7 days
   * («جديدة»).
   */
  equipment_state?: EquipmentState | null
  equipment_is_new?: boolean | null
  project?: Project | null
  lessor?: Lessor | null
}

export interface EntryExitLog {
  id: string
  equipment_id: string
  supervisor_id: string
  movement_type: MovementType
  movement_context?: 'site' | 'workshop'
  workshop_purpose?: 'maintenance' | 'parking' | 'out_of_service' | null
  /** wave-10-exit-purpose (migration 0111): site exits only; NULL on legacy rows. */
  exit_purpose?: 'maintenance' | 'work_completed' | null
  /**
   * The driver of the visit's latest driver change (resolved to that
   * driver's record name); set only when such a change exists.
   */
  current_driver_name?: string | null
  registration_method: RegistrationMethod
  driver_name: string | null
  /**
   * wave 19: the CURRENT name of the row's driver record (migration 0124 on
   * the views, or resolved by the screen); shown instead of the snapshot.
   */
  driver_full_name?: string | null
  driver_id: string | null
  odometer_reading: number | null
  notes: string | null
  photo_url: string | null
  company_id: string | null
  project_id: string | null
  contractor_equipment_code: string | null
  recorded_at: string
  created_at: string
  equipment?: Equipment
  supervisor?: Profile
  company?: Company | null
  project?: Project | null
  driver?: Driver | null
}

export interface EquipmentVisit {
  equipment_id: string
  equipment_code: string
  equipment_type: string
  contractor_equipment_code: string | null
  plate_number: string | null
  project_id: string | null
  project_name_ar: string | null
  project_name_en: string | null
  company_name_ar: string | null
  company_name_en: string | null
  entry_log_id: string
  entry_recorded_at: string
  entry_supervisor_id: string
  entry_supervisor_name: string | null
  driver_name: string | null
  odometer_reading: number | null
  notes: string | null
  photo_url: string | null
  registration_method: RegistrationMethod
  exit_log_id: string | null
  exit_recorded_at: string | null
  exit_supervisor_id: string | null
  exit_supervisor_name: string | null
  exit_odometer: number | null
  exit_notes: string | null
  exit_photo_url: string | null
  exit_registration_method: RegistrationMethod | null
  exit_driver_name?: string | null
  movement_context?: 'site' | 'workshop'
  last_driver_name?: string | null
}

export interface CompanyProject {
  id: string
  company_id: string
  project_id: string
  created_at: string
}

export interface EntryExitPhoto {
  id: string
  entry_exit_log_id: string
  file_path: string
  uploaded_by: string
  sort_order: number
  created_at: string
}

export interface LastMovement {
  movement_type: MovementType
  movement_context: 'site' | 'workshop'
  workshop_purpose: 'maintenance' | 'parking' | 'out_of_service' | null
  recorded_at: string
  supervisor_id: string
  supervisor_name: string | null
  company_id: string | null
  project_id: string | null
  project_name_ar: string | null
  project_name_en: string | null
  contractor_equipment_code: string | null
  driver_id: string | null
  driver_name: string | null
  /**
   * wave 19: the CURRENT name of `driver_id`'s record, looked up by the form
   * after `get_last_movement`; shown instead of the `driver_name` snapshot.
   */
  driver_full_name?: string | null
  // Added by migration 0091. Optional so the form keeps working against an
  // older `get_last_movement`; the UI shows "—" while they are absent.
  driver_mobile_number?: string | null
  company_name_ar?: string | null
  company_name_en?: string | null
}

export interface MovementDriverChange {
  id: string
  entry_log_id: string
  previous_driver_id: string | null
  previous_driver_name: string | null
  /** wave 19: the CURRENT name of `previous_driver_id`'s record, when resolved. */
  previous_driver_full_name?: string | null
  new_driver_id: string
  new_driver_name: string
  /** wave 19: the CURRENT name of `new_driver_id`'s record, when resolved. */
  new_driver_full_name?: string | null
  changed_by: string
  changed_at: string
  note: string | null
  changer?: Profile | null
}

/**
 * wave 22A (migrations 0126/0127): roles and permissions. Since 0150 the
 * system is on for good and `current_permissions()` answers from
 * `profile_roles` -> active `roles` -> `role_permissions` only; 0156
 * dropped the legacy `profiles.role`.
 */
export type PermissionScope = 'all' | 'site' | 'workshop' | 'companies' | 'own'

/** Row of `public.permissions`: the fixed, code-owned catalogue. */
export interface Permission {
  key: string
  group_key: string
  name_ar: string
  name_en: string
  description_ar: string
  description_en: string
  scoped: boolean
  /** Accepted scopes of a scoped key; null for an unscoped key. */
  scopes: PermissionScope[] | null
  /** Keys that must also be granted to a role holding this key. */
  requires: string[]
  /** Only the admin role may hold it (users.manage, settings.roles). */
  admin_only: boolean
  enforced_in: 'database' | 'interface' | 'reserved'
  sort: number
}

/** Row of `public.roles`. */
export interface Role {
  key: string
  name_ar: string
  name_en: string
  description_ar: string | null
  description_en: string | null
  is_system: boolean
  is_active: boolean
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

/** Row of `public.role_permissions`; scope is null for an unscoped key. */
export interface RolePermission {
  role_key: string
  permission_key: string
  scope: PermissionScope | null
}

/** Row of `public.profile_roles` (one role per user). */
export interface ProfileRole {
  profile_id: string
  role_key: string
  assigned_at: string
  assigned_by: string | null
}

/** Row of `current_permissions()`: scope is 'all' for an unscoped key. */
export interface CurrentPermission {
  permission_key: string
  scope: PermissionScope
}

/** Row of `public.role_changes` (admin-readable audit). */
export interface RoleChange {
  id: number
  changed_at: string
  changed_by: string | null
  action:
    | 'seeded'
    | 'role_created'
    | 'role_updated'
    | 'role_deleted'
    | 'permission_granted'
    | 'permission_scope_changed'
    | 'permission_revoked'
    | 'role_assigned'
    | 'role_reassigned'
    | 'role_unassigned'
    | 'roles_system_enabled'
    | 'roles_system_disabled'
    | 'setting_changed'
  role_key: string | null
  permission_key: string | null
  profile_id: string | null
  old_value: unknown
  new_value: unknown
}
