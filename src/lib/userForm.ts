import type { BadgeTone } from '@/components/ui/Badge'
import type { TranslationKey } from '@/i18n/translations'
import type { UserRole } from '@/lib/types'
import {
  PASSWORD_MIN_LENGTH,
  userEditFormSchema,
  userFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'

/** Badge tone plus the translation key of its label (same shape as
 * `equipmentForm.ts`'s `BadgeDescriptor`, kept local so this file has no
 * runtime dependency on equipment code). */
export interface BadgeDescriptor {
  tone: BadgeTone
  key: TranslationKey
}

/**
 * Every assignable role, in the order shown in the add-user role select.
 * Roles are assigned only through the `create-user` Edge Function and the
 * admin-only database functions (AGENTS.md); this list only drives the UI.
 */
export const USER_ROLES: UserRole[] = [
  'supervisor',
  'workshop',
  'assistant_workshop_manager',
  'workshop_manager',
  'monitor',
  'admin',
]

/** Values held by the add-user dialog. */
export interface UserFormValues {
  full_name: string
  email: string
  password: string
  role: UserRole
}

export const EMPTY_USER_FORM: UserFormValues = {
  full_name: '',
  email: '',
  password: '',
  role: 'supervisor',
}

/** The order the fields appear in, used to focus the first invalid one. */
export const USER_FIELD_ORDER = [
  'full_name',
  'email',
  'password',
  'role',
] as const

/** The minimum the `create-user` Edge Function accepts. */
export { PASSWORD_MIN_LENGTH }

/**
 * The same three rules the dialog enforced before (name, email, and password
 * present; a plausible email; a password of at least 8 characters), reported
 * per field instead of as one message (`userFormSchema`).
 */
export function validateUserForm(
  form: UserFormValues,
): FieldErrors<UserFormValues> {
  return validateWithSchema(userFormSchema, form)
}

/** Values held by the edit form of the user detail page. */
export interface UserEditFormValues {
  full_name: string
  email: string
  role: UserRole
  password: string
  mobile_number: string
}

/** The order the fields appear in, used to focus the first invalid one. */
export const USER_EDIT_FIELD_ORDER = [
  'full_name',
  'email',
  'role',
  'password',
  'mobile_number',
] as const

/**
 * The edit form's rules (`userEditFormSchema`): name and email present, a
 * plausible email, a new password of at least 8 characters when one is typed,
 * and the mobile number rule of `admin_set_user_mobile`.
 */
export function validateUserEditForm(
  form: UserEditFormValues,
): FieldErrors<UserEditFormValues> {
  return validateWithSchema(userEditFormSchema, form)
}

/**
 * Attributes a known `create-user` failure to the field that caused it. An
 * unrecognized code stays a top-level message, and the raw server text is
 * never shown.
 */
export function userServerFieldErrors(
  serverCode: string | undefined,
): FieldErrors<UserFormValues> | null {
  if (serverCode === 'email_exists') return { email: 'userEmailExists' }
  if (serverCode === 'invalid_email') return { email: 'invalidUserEmail' }
  if (serverCode === 'weak_password') return { password: 'passwordMinLength' }
  return null
}

/**
 * The same for a `manage-user` update: the role refusals belong on the role
 * field. Its other failures carry no code (a taken email is reported as
 * "could not update login details"), so they stay a form-level message.
 */
export function userEditServerFieldErrors(
  serverCode: string | undefined,
): FieldErrors<UserEditFormValues> | null {
  if (serverCode === 'own_role') return { role: 'cannotChangeOwnRole' }
  if (serverCode === 'last_admin') return { role: 'lastAdminRequired' }
  return null
}

const ROLE_BADGES: Record<UserRole, BadgeDescriptor> = {
  admin: { tone: 'info', key: 'admin' },
  supervisor: { tone: 'neutral', key: 'supervisor' },
  workshop: { tone: 'neutral', key: 'workshopOfficer' },
  assistant_workshop_manager: {
    tone: 'neutral',
    key: 'assistantWorkshopManager',
  },
  workshop_manager: { tone: 'neutral', key: 'workshopManager' },
  monitor: { tone: 'neutral', key: 'monitoring' },
}

/**
 * Single mapping from a role to its shared `Badge` (AGENTS.md: no ad hoc
 * palette colors). An unrecognized value never falls back to an existing
 * role's label — client-side role handling must fail closed.
 */
export function roleBadge(role: UserRole): BadgeDescriptor {
  return ROLE_BADGES[role] ?? { tone: 'neutral', key: 'unknownRole' }
}
