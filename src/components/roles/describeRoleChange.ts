import type { TranslationKey } from '@/i18n/translations'
import type { Language } from '@/i18n/translations'
import { formatDateTime } from '@/lib/dateFormat'
import {
  SCOPE_LABEL_KEYS,
  roleChangeActionKey,
  roleChangeValue,
  type RoleChangeValue,
} from '@/lib/rolesAdmin'
import type { RoleChange } from '@/lib/types'
import type { ChangeItem } from './ui/model'

export interface ChangeLookups {
  t: (key: TranslationKey) => string
  lang: Language
  roleLabel: (key: string | null) => string | null
  permissionLabel: (key: string | null) => string | null
  profileName: (id: string | null) => string | null
}

/**
 * One `role_changes` row as the log shows it: who, when and a sentence
 * («ماذا») built from the action label, the subject (permission, user or
 * role) and the reduced old/new values. Raw JSON never reaches the screen
 * (`roleChangeValue`).
 */
export function describeRoleChange(
  row: RoleChange,
  lookups: ChangeLookups,
): ChangeItem {
  const { t, lang } = lookups
  const action = t(roleChangeActionKey(row.action))
  const arrow = lang === 'ar' ? '←' : '→'
  const valueLabel = (value: RoleChangeValue): string | null => {
    if (!value) return null
    if (value.kind === 'scope')
      return value.scope ? t(SCOPE_LABEL_KEYS[value.scope]) : '—'
    if (value.kind === 'role') return lookups.roleLabel(value.roleKey)
    if (value.kind === 'enabled')
      return value.enabled
        ? t('rolesSystemStatusActive')
        : t('rolesSystemStatusInactive')
    const name =
      (lang === 'ar' ? value.nameAr : value.nameEn) ??
      value.nameAr ??
      value.nameEn
    const active =
      value.active === null
        ? null
        : value.active
          ? t('rolesActiveBadge')
          : t('rolesInactiveBadge')
    return [name, active].filter(Boolean).join(' · ') || null
  }

  const subject = row.permission_key
    ? `«${lookups.permissionLabel(row.permission_key) ?? row.permission_key}»`
    : row.profile_id
      ? (lookups.profileName(row.profile_id) ?? '—')
      : null

  let detail: string | null = null
  if (row.action !== 'seeded') {
    const from = valueLabel(roleChangeValue(row.action, row.old_value))
    const to = valueLabel(roleChangeValue(row.action, row.new_value))
    detail = from && to && from !== to ? `${from} ${arrow} ${to}` : (to ?? from)
  }

  const what = [
    subject ? `${action}: ${subject}` : action,
    detail ? `(${detail})` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    id: String(row.id),
    roleKey: row.role_key,
    who: row.changed_by
      ? (lookups.profileName(row.changed_by) ?? '—')
      : t('roleChangesSystem'),
    when: formatDateTime(row.changed_at),
    what,
  }
}
