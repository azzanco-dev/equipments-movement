import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  SearchInput,
  Skeleton,
  cn,
} from '@/components/ui'
import {
  USERS_COUNT_KEYS,
  countLabel,
  matchesRole,
  type RoleItem,
} from './model'

/**
 * The roles column (start side of the split layout): search, «اضافة دور» and
 * one row per role with its badges and users count. The selected row is
 * monochrome (`nav-active`), like the sidebar.
 */
export function RolesList({
  roles,
  selectedKey,
  loading,
  error,
  onRetry,
  onSelect,
  onAdd,
}: {
  roles: RoleItem[]
  selectedKey: string | null
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  onSelect: (key: string) => void
  onAdd: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const filtered = useMemo(
    () => roles.filter((role) => matchesRole(role, query)),
    [roles, query],
  )

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('rolesListSearch')}
          className="min-w-0 flex-1"
        />
        <Button
          variant="primary"
          icon={<Plus size={16} aria-hidden="true" />}
          onClick={onAdd}
          disabled={loading || error}
        >
          {t('rolesAddRole')}
        </Button>
      </div>
      {error ? (
        <ErrorState description={t('rolesLoadError')} onRetry={onRetry} />
      ) : loading ? (
        <div className="space-y-1" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            roles.length === 0 ? t('rolesNone') : t('rolesListEmptySearch')
          }
          className="p-5"
        />
      ) : (
        <ul className="space-y-0.5" aria-label={t('rolesTabRoles')}>
          {filtered.map((role) => {
            const active = role.key === selectedKey
            return (
              <li key={role.key}>
                <button
                  type="button"
                  onClick={() => onSelect(role.key)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start transition-colors',
                    active ? 'nav-active' : 'hover:bg-surface-hover',
                    !role.isActive && !active && 'opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {role.name}
                      </span>
                      <Badge
                        size="sm"
                        tone={role.isSystem ? 'info' : 'neutral'}
                      >
                        {role.isSystem
                          ? t('rolesSystemBadge')
                          : t('rolesCustomBadge')}
                      </Badge>
                      {!role.isActive && (
                        <Badge size="sm" tone="warning">
                          {t('rolesDisabledBadge')}
                        </Badge>
                      )}
                    </span>
                    <span
                      className={cn(
                        'block text-[11px]',
                        active ? 'opacity-75' : 'text-muted',
                      )}
                    >
                      {countLabel(t, USERS_COUNT_KEYS, role.userCount)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
