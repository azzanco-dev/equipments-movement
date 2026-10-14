import { useI18n } from '@/i18n/I18nContext'
import type { PermissionScope } from '@/lib/types'
import { SCOPE_LABEL_KEYS } from '@/lib/rolesAdmin'
import { cn } from '@/components/ui'

/**
 * Inline scope picker of a granted, multi-scope permission: segmented, 28 px
 * like the toolbar controls (approved on /ui-kit, 2026-10-14). The shared kit
 * has no segmented single-choice control outside Tabs, so this is a plain
 * radiogroup styled with the project tokens.
 */
export function ScopeSegments({
  scopes,
  value,
  disabled,
  onChange,
}: {
  scopes: PermissionScope[]
  value: PermissionScope
  disabled?: boolean
  onChange: (scope: PermissionScope) => void
}) {
  const { t } = useI18n()
  return (
    <div
      role="radiogroup"
      aria-label={t('rolePermissionsScope')}
      className={cn(
        'inline-flex h-7 items-center gap-0.5 rounded-lg border bg-surface p-0.5',
        disabled && 'opacity-60',
      )}
    >
      {scopes.map((scope) => {
        const active = scope === value
        return (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(scope)}
            className={cn(
              'h-6 rounded-md px-2 text-xs transition-colors disabled:cursor-not-allowed',
              active
                ? 'bg-bg font-medium text-fg shadow-sm'
                : 'text-muted hover:text-fg',
            )}
          >
            {t(SCOPE_LABEL_KEYS[scope])}
          </button>
        )
      })}
    </div>
  )
}
