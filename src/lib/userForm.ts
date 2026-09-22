import type { BadgeTone } from '@/components/ui/Badge'
import type { TranslationKey } from '@/i18n/translations'
import type { UserRole } from '@/lib/types'
import {
  fieldErrors,
  pattern,
  required,
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
export const PASSWORD_MIN_LENGTH = 8

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/

/**
 * The same three rules the dialog enforced before (name, email, and password
 * present; a plausible email; a password of at least 8 characters), reported
 * per field instead of as one message.
 */
export function validateUserForm(
  form: UserFormValues,
): FieldErrors<UserFormValues> {
  return fieldErrors<UserFormValues>({
    full_name: required(form.full_name, 'fullNameRequired'),
    email:
      required(form.email, 'emailRequired') ??
      pattern(form.email, EMAIL_PATTERN, 'invalidUserEmail'),
    password: !form.password
      ? 'passwordRequired'
      : form.password.length < PASSWORD_MIN_LENGTH
        ? 'passwordMinLength'
        : undefined,
  })
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
