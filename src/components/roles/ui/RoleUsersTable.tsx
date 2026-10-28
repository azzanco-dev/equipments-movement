import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Notice,
  type DataTableColumn,
} from '@/components/ui'
import { fill } from '../roleRows'
import {
  USERS_COUNT_KEYS,
  countLabel,
  type AssignCandidate,
  type RoleUserItem,
} from './model'

/** The «المستخدمون» tab: who holds the role, plus «اسناد مستخدم». */
export function RoleUsersTable({
  roleName,
  users,
  loading,
  error,
  onRetry,
  onAssignClick,
}: {
  roleName: string
  users: RoleUserItem[]
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  onAssignClick: () => void
}) {
  const { t } = useI18n()
  const columns: DataTableColumn<RoleUserItem>[] = [
    { key: 'name', header: t('roleUsersColUser'), cell: (row) => row.name },
    {
      key: 'since',
      header: t('roleUsersColSince'),
      cell: (row) => <span className="text-muted">{row.since ?? '—'}</span>,
      hideBelow: 'sm',
    },
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {fill(t('roleUsersOneRoleNote'), {
            count: countLabel(t, USERS_COUNT_KEYS, users.length),
          })}
        </p>
        <Button
          size="sm"
          variant="outline"
          icon={<UserPlus size={14} aria-hidden="true" />}
          onClick={onAssignClick}
        >
          {t('roleUsersAssign')}
        </Button>
      </div>
      {error ? (
        <ErrorState description={t('roleUsersLoadError')} onRetry={onRetry} />
      ) : (
        <DataTable
          size="sm"
          columns={columns}
          rows={users}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={3}
          caption={fill(t('roleUsersOfRole'), { name: roleName })}
          empty={t('roleUsersNoneYet')}
        />
      )}
    </div>
  )
}

/**
 * «اسناد مستخدم الى «الدور»»: a searchable AsyncSearchSelect over the users
 * who do not hold this role (the caller loads them, 20 at a time), the
 * one-role-per-user note when the chosen user holds another role, and the
 * caller's assignment (`admin_assign_profile_role` on the real page). The
 * caller returns a safe message on failure; null means assigned.
 */
export function AssignUserDialog({
  open,
  onOpenChange,
  roleName,
  loadOptions,
  onAssign,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleName: string
  loadOptions: (query: string) => Promise<AssignCandidate[]>
  onAssign: (candidate: AssignCandidate) => Promise<string | null>
}) {
  const { t } = useI18n()
  const [chosen, setChosen] = useState<AssignCandidate | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const close = (next: boolean) => {
    if (saving) return
    if (!next) {
      setChosen(null)
      setError(undefined)
    }
    onOpenChange(next)
  }

  const submit = async () => {
    if (!chosen) {
      setError(t('roleAssignPick'))
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const failure = await onAssign(chosen)
      if (failure) {
        setError(failure)
        return
      }
      setChosen(null)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="sm"
      title={fill(t('roleAssignTitle'), { role: roleName })}
      description={t('roleAssignDesc')}
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => close(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() => void submit()}
          >
            {t('roleAssignButton')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('roleUsersColUser')} required error={error}>
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={chosen?.value ?? ''}
              selectedOption={chosen}
              disabled={saving}
              onChange={(_value, option) => {
                setChosen((option as AssignCandidate | null) ?? null)
                setError(undefined)
              }}
              loadOptions={loadOptions}
              placeholder={t('roleAssignPlaceholder')}
            />
          )}
        </Field>
        {chosen?.currentRoleName && (
          <Notice tone="warning" size="compact">
            {fill(t('roleAssignMoveNote'), {
              name: chosen.label,
              from: chosen.currentRoleName,
              to: roleName,
            })}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}
