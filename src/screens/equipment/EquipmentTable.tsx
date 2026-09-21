import type { ReactNode } from 'react'
import { ChevronRight, Edit2, PackageSearch, Power } from 'lucide-react'
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { RelativeTime } from '@/components/RelativeTime'
import type { Equipment } from '@/lib/types'
import { usesExternalSupplier } from '@/lib/equipmentOwnership'
import {
  activeBadge,
  masterDataBadge,
  operationalStatusBadge,
  ownershipBadge,
} from '@/lib/equipmentForm'

/**
 * Pattern for the migrated list screens (equipment first, then drivers,
 * companies, projects and lessors). Copy this shape:
 *
 * 1. The screen (`*ListScreen.tsx`) owns the data: `useDataListState` for the
 *    URL state, `useListRequest` for the abortable query, `DataListToolbar`
 *    and `DataListPagination` around the table. Search, filters, sort and
 *    paging stay server-side; nothing is filtered in the browser.
 * 2. This table component is presentational: it receives rows plus the
 *    loading/error flags and renders exactly one of `ErrorState` (a failed
 *    load, never an empty list), `EmptyState` (no rows) or `DataTable`.
 * 3. Column `key` values are the server sort keys from the module's
 *    `listConfigs` entry, so `sort`/`onSortChange` map straight onto
 *    `useDataListState` and header sorting stays server-side.
 * 4. Row click opens the detail; row actions are `IconButton`s, which
 *    `DataTable` already excludes from the row click.
 * 5. Statuses and flags use the shared `Badge` through the mapping helpers in
 *    `src/lib` (here `equipmentForm.ts`) — no ad hoc palette colors, no
 *    hardcoded strings: every label comes from `useI18n`.
 */
export interface EquipmentTableProps {
  rows: Equipment[]
  loading: boolean
  /** Message for a failed load; replaces the table with `ErrorState`. */
  error: string | null
  onRetry: () => void
  sort: string
  direction: 'asc' | 'desc'
  onSortChange: (key: string, direction: 'asc' | 'desc') => void
  onOpen: (id: string) => void
  onEdit: (equipment: Equipment) => void
  onToggleActive: (equipment: Equipment) => void
  /** Rendered in the empty state, e.g. the "add equipment" button. */
  emptyAction?: ReactNode
}

export function EquipmentTable({
  rows,
  loading,
  error,
  onRetry,
  sort,
  direction,
  onSortChange,
  onOpen,
  onEdit,
  onToggleActive,
  emptyAction,
}: EquipmentTableProps) {
  const { t } = useI18n()

  if (error) return <ErrorState description={error} onRetry={onRetry} />

  if (!loading && rows.length === 0)
    return (
      <EmptyState
        icon={<PackageSearch size={28} aria-hidden="true" />}
        title={t('noEquipment')}
        action={emptyAction}
      />
    )

  const columns: DataTableColumn<Equipment>[] = [
    {
      key: 'code',
      header: t('equipmentCode'),
      sortable: true,
      className: 'font-semibold',
      cell: (row) => {
        const incomplete = masterDataBadge(row.master_data_complete)
        return (
          <span className="inline-flex items-center gap-2">
            <span dir="ltr">{row.code}</span>
            {incomplete && (
              <Badge tone={incomplete.tone} size="sm">
                {t(incomplete.key)}
              </Badge>
            )}
          </span>
        )
      },
    },
    {
      key: 'type',
      header: t('equipmentType'),
      sortable: true,
      className: 'text-muted',
      cell: (row) => row.type,
    },
    {
      key: 'plate_number',
      header: t('plateNumber'),
      sortable: true,
      className: 'text-muted',
      cell: (row) => (
        <span dir="ltr">{row.plate_number || row.chassis_number || '—'}</span>
      ),
    },
    {
      key: 'operational_status',
      header: t('operationalStatus'),
      sortable: true,
      cell: (row) => {
        const badge = operationalStatusBadge(row.operational_status)
        return <Badge tone={badge.tone}>{t(badge.key)}</Badge>
      },
    },
    {
      key: 'ownership_status',
      header: t('ownershipStatus'),
      sortable: true,
      cell: (row) => {
        const incomplete = masterDataBadge(row.master_data_complete)
        if (incomplete)
          return <Badge tone={incomplete.tone}>{t(incomplete.key)}</Badge>
        const badge = ownershipBadge(row.ownership_status)
        const supplier =
          usesExternalSupplier(row.ownership_status) && row.lessor?.name
            ? ` - ${row.lessor.name}`
            : ''
        return (
          <Badge tone={badge.tone}>
            {t(badge.key)}
            {supplier}
          </Badge>
        )
      },
    },
    {
      key: 'is_active',
      header: t('isActive'),
      cell: (row) => {
        const badge = activeBadge(row.is_active)
        return <Badge tone={badge.tone}>{t(badge.key)}</Badge>
      },
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (row) => (
        <span className="flex items-center gap-1">
          <IconButton
            size="sm"
            label={t('edit')}
            title={t('edit')}
            icon={<Edit2 size={15} />}
            onClick={() => onEdit(row)}
          />
          <IconButton
            size="sm"
            label={row.is_active ? t('deactivate') : t('activate')}
            title={row.is_active ? t('deactivate') : t('activate')}
            icon={<Power size={15} />}
            onClick={() => onToggleActive(row)}
          />
          <ChevronRight
            size={15}
            aria-hidden="true"
            className="rtl-flip ms-1 text-muted"
          />
        </span>
      ),
    },
    {
      key: 'updated_at',
      header: t('updatedAt'),
      sortable: true,
      className: 'text-muted',
      hideBelow: 'md',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      loading={loading}
      loadingRows={8}
      caption={t('equipmentList')}
      sort={{ key: sort, direction }}
      onSortChange={onSortChange}
      onRowClick={(row) => onOpen(row.id)}
      empty={t('noEquipment')}
    />
  )
}
