import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  Lock,
} from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import type { PermissionScope } from '@/lib/types'
import {
  selectionProblems,
  selectionWarnings,
  selectionsEqual,
  setPermissionScope,
  tickPermission,
  type SelectionWarning,
} from '@/lib/rolesAdmin'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Skeleton,
  cn,
} from '@/components/ui'
import { fill } from '../roleRows'
import {
  CHANGES_COUNT_KEYS,
  countLabel,
  diffGrants,
  matchesPermission,
  missingRequirements,
  toCatalogue,
  type Grants,
  type PermissionGroupItem,
  type PermissionItem,
} from './model'
import { ScopeSegments } from './ScopeSegments'
import { TriStateCheckbox, type TriState } from './TriStateCheckbox'

export type PermissionsSaveOutcome =
  | { ok: true }
  | {
      ok: false
      /** Message shown in the save bar. */
      message: string
      /** Per-row messages (the permission key the database named). */
      rows?: Record<string, string>
    }

export interface PermissionsTableProps {
  roleKey: string
  permissions: PermissionItem[]
  groups: PermissionGroupItem[]
  /** The saved grants; the draft is reset whenever this value changes. */
  saved: Grants | null
  /** Admin: every row read-only. */
  locked: boolean
  loadError?: boolean
  onRetry?: () => void
  onSave: (draft: Grants) => Promise<PermissionsSaveOutcome>
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * The compact permissions table approved on /ui-kit: collapsible groups with a
 * tri-state select-all and «n من m», a search box, inline scope segments for
 * a granted multi-scope key, the description behind an info icon, chips for
 * the enforcement kind and the requirements, requirements auto-ticked with a
 * flash, a warning chip on a dependant whose requirement was unticked, and a
 * sticky save bar with the change count. Saving is the caller's: one call with
 * the whole draft (`admin_set_role_permissions` on the real page).
 */
export function PermissionsTable({
  roleKey,
  permissions,
  groups,
  saved,
  locked,
  loadError,
  onRetry,
  onSave,
  onDirtyChange,
}: PermissionsTableProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Grants>(saved ?? {})
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((group) => [group.key, !group.collapsed])),
  )
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const timers = useRef<number[]>([])

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
    },
    [],
  )

  // The saved grants arrived or changed (first load, a successful save):
  // the draft follows them.
  useEffect(() => {
    setDraft(saved ?? {})
    setRowErrors({})
    setSaveError(null)
  }, [saved])

  const byKey = useMemo(
    () =>
      new Map(permissions.map((permission) => [permission.key, permission])),
    [permissions],
  )
  const catalogue = useMemo(() => toCatalogue(permissions), [permissions])

  const changes = saved ? diffGrants(saved, draft) : []
  const dirty = saved !== null && !selectionsEqual(saved, draft)
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const problems = useMemo(
    () => selectionProblems(draft, catalogue, roleKey),
    [catalogue, draft, roleKey],
  )
  // Problems of hidden keys (not in the table) cannot be fixed here and the
  // database keeps them as they are; only visible rows block the save.
  const visibleProblems = Object.keys(problems).filter((key) => byKey.has(key))
  // Non-blocking: combinations that save but will not work as they suggest.
  const warnings = useMemo(() => selectionWarnings(draft), [draft])

  const flashKeys = (keys: string[]) => {
    if (keys.length === 0) return
    setFlash(new Set(keys))
    timers.current.push(window.setTimeout(() => setFlash(new Set()), 1400))
  }

  const edit = (next: Grants) => {
    setSavedNotice(false)
    setSaveError(null)
    setDraft(next)
  }

  const toggle = (key: string, on: boolean) => {
    setRowErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    if (on) {
      const result = tickPermission(draft, catalogue, key)
      edit(result.selection)
      flashKeys(result.autoAdded)
    } else {
      const next = { ...draft }
      delete next[key]
      edit(next)
    }
  }

  const setScope = (key: string, scope: PermissionScope) => {
    edit(setPermissionScope(draft, catalogue, key, scope))
  }

  const toggleGroup = (groupKey: string, on: boolean) => {
    const members = permissions.filter(
      (permission) =>
        permission.group === groupKey && !(permission.adminOnly && !locked),
    )
    if (on) {
      let next: Grants = draft
      const added: string[] = []
      for (const permission of members) {
        const result = tickPermission(next, catalogue, permission.key)
        next = result.selection
        added.push(
          ...result.autoAdded.filter(
            (key) => !members.some((member) => member.key === key),
          ),
        )
      }
      edit(next)
      flashKeys(added)
    } else {
      const next = { ...draft }
      for (const permission of members) delete next[permission.key]
      edit(next)
    }
  }

  const save = async () => {
    if (!saved || changes.length === 0 || visibleProblems.length > 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const outcome = await onSave(draft)
      if (outcome.ok) {
        setSavedNotice(true)
        setRowErrors({})
      } else {
        setSaveError(outcome.message)
        setRowErrors(outcome.rows ?? {})
      }
    } finally {
      setSaving(false)
    }
  }

  const visibleGroups = groups
    .map((group) => ({
      group,
      all: permissions.filter((permission) => permission.group === group.key),
      rows: permissions.filter(
        (permission) =>
          permission.group === group.key &&
          matchesPermission(permission, query),
      ),
    }))
    .filter((entry) => entry.rows.length > 0)

  if (loadError)
    return (
      <ErrorState
        description={t('rolePermissionsLoadError')}
        onRetry={onRetry}
      />
    )

  if (saved === null)
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )

  return (
    <div className="space-y-3">
      {locked && (
        <Notice tone="info" size="compact">
          {t('rolePermissionsLockedAdmin')}
        </Notice>
      )}
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('rolePermissionsSearch')}
      />

      <div
        role="table"
        aria-label={t('rolePermissionsTableLabel')}
        className="overflow-hidden rounded-lg border"
      >
        {visibleGroups.length === 0 && (
          <EmptyState title={t('rolePermissionsEmptySearch')} className="m-3" />
        )}
        {visibleGroups.map(({ group, all, rows }) => {
          const granted = all.filter((permission) => permission.key in draft)
          const state: TriState =
            granted.length === 0
              ? 'none'
              : granted.length === all.length
                ? 'all'
                : 'some'
          const open = query ? true : openGroups[group.key] !== false
          return (
            <div key={group.key} role="rowgroup">
              <div
                role="row"
                className="flex items-center gap-3 border-b bg-surface px-3 py-2"
              >
                <TriStateCheckbox
                  state={state}
                  disabled={locked || saving}
                  label={fill(t('rolePermissionsSelectGroup'), {
                    group: group.name,
                  })}
                  onChange={(on) => toggleGroup(group.key, on)}
                />
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [group.key]: !open,
                    }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-start"
                >
                  <span className="text-sm font-semibold">{group.name}</span>
                  <span className="text-xs text-muted">
                    {fill(t('rolePermissionsOfCount'), {
                      granted: granted.length,
                      total: all.length,
                    })}
                  </span>
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className={cn(
                      'ms-auto shrink-0 text-muted transition-transform',
                      open && 'rotate-180',
                    )}
                  />
                </button>
              </div>
              {open &&
                rows.map((permission) => (
                  <PermissionRow
                    key={permission.key}
                    permission={permission}
                    draft={draft}
                    byKey={byKey}
                    locked={locked}
                    saving={saving}
                    flashed={flash.has(permission.key)}
                    problem={
                      problems[permission.key] === 'rolesErrMissingRequired'
                        ? undefined
                        : problems[permission.key]
                    }
                    // The locked admin role holds every key by design.
                    warnings={locked ? undefined : warnings[permission.key]}
                    rowError={rowErrors[permission.key]}
                    onToggle={(on) => toggle(permission.key, on)}
                    onScope={(scope) => setScope(permission.key, scope)}
                  />
                ))}
            </div>
          )
        })}
      </div>

      {!locked && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-bg px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            {saveError ? (
              <span className="text-danger" role="alert">
                {saveError}
              </span>
            ) : savedNotice ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 size={15} aria-hidden="true" />
                {t('rolePermissionsSavedShort')}
              </span>
            ) : visibleProblems.length > 0 ? (
              <span className="text-danger" role="status">
                {t('rolePermissionsHasProblems')}
              </span>
            ) : (
              <span className={changes.length ? 'font-medium' : 'text-muted'}>
                {countLabel(t, CHANGES_COUNT_KEYS, changes.length)}
              </span>
            )}
          </span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              disabled={changes.length === 0 || saving}
              onClick={() => {
                edit({ ...saved })
                setRowErrors({})
              }}
            >
              {t('rolePermissionsUndo')}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={changes.length === 0 || visibleProblems.length > 0}
              onClick={() => void save()}
            >
              {t('save')}
            </Button>
          </span>
        </div>
      )}
    </div>
  )
}

function PermissionRow({
  permission,
  draft,
  byKey,
  locked,
  saving,
  flashed,
  problem,
  warnings,
  rowError,
  onToggle,
  onScope,
}: {
  permission: PermissionItem
  draft: Grants
  byKey: ReadonlyMap<string, PermissionItem>
  locked: boolean
  saving: boolean
  flashed: boolean
  problem?: TranslationKey
  warnings?: SelectionWarning[]
  rowError?: string
  onToggle: (on: boolean) => void
  onScope: (scope: PermissionScope) => void
}) {
  const { t } = useI18n()
  const granted = permission.key in draft
  const adminOnlyBlocked = permission.adminOnly && !locked
  const missing = missingRequirements(draft, byKey, permission.key)
  const nameOf = (key: string) => byKey.get(key)?.name ?? key
  const requiresLabel = permission.requires.map(nameOf).join('، ')
  const missingLabel = missing.map(nameOf).join('، ')
  const error = rowError ?? (problem ? t(problem) : null)

  return (
    <div
      role="row"
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center',
        'transition-colors duration-500',
        flashed && 'bg-success-soft',
        error && 'bg-danger-soft',
      )}
    >
      <Checkbox
        checked={granted}
        disabled={locked || saving || (adminOnlyBlocked && !granted)}
        aria-label={permission.name}
        onCheckedChange={(value) => onToggle(value === true)}
        className="mt-0.5 sm:mt-0"
      />
      <div role="cell" className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              // Owner note 2026-10-14: smaller, regular weight; only a granted
              // permission gets a little weight so the eye finds it.
              'text-[13px]',
              granted || locked ? 'font-medium' : 'text-muted',
            )}
          >
            {permission.name}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={fill(t('rolePermissionsDescribe'), {
                  name: permission.name,
                })}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
              >
                <Info size={14} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="max-w-72 p-3 text-xs leading-relaxed">
              <p className="mb-1 font-semibold">{permission.name}</p>
              <p dir="ltr" className="mb-1.5 font-latin text-[11px] text-muted">
                {permission.key}
              </p>
              <p>{permission.description}</p>
            </PopoverContent>
          </Popover>
          {locked && (
            <Lock size={12} aria-hidden="true" className="text-muted" />
          )}
          {permission.enforcedIn === 'interface' && (
            <Badge size="sm">{t('rolePermissionsInterfaceChip')}</Badge>
          )}
          {permission.enforcedIn === 'reserved' && (
            <Badge size="sm">{t('rolePermissionsReservedChip')}</Badge>
          )}
          {permission.adminOnly && (
            <Badge size="sm" tone="info">
              {t('rolePermissionsAdminOnlyHint')}
            </Badge>
          )}
          {missing.length > 0 ? (
            <Badge size="sm" tone="warning">
              {fill(t('rolePermissionsRequiresMissing'), {
                names: missingLabel,
              })}
            </Badge>
          ) : (
            permission.requires.length > 0 && (
              <Badge size="sm">
                {fill(t('rolePermissionsRequires'), { names: requiresLabel })}
              </Badge>
            )
          )}
          {error && (
            <Badge size="sm" tone="danger">
              {error}
            </Badge>
          )}
        </div>
        {granted && warnings && warnings.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {warnings.map((warning) => (
              <li
                key={warning.message}
                className="flex items-start gap-1 text-xs leading-relaxed text-warning"
              >
                <AlertTriangle
                  size={13}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
                <span>
                  {fill(t(warning.message), {
                    names: warning.keys.map(nameOf).join('، '),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div role="cell" className="col-start-2 sm:col-start-3">
        {granted && permission.scopes.length > 1 && (
          <ScopeSegments
            scopes={permission.scopes}
            value={draft[permission.key] ?? permission.scopes[0]}
            disabled={locked || saving}
            onChange={onScope}
          />
        )}
      </div>
    </div>
  )
}
