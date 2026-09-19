import type { BadgeTone } from '@/components/ui/Badge'
import type { TranslationKey } from '@/i18n/translations'
import type { UserRole } from '@/lib/types'

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
