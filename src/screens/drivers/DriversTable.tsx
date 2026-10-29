import type { ReactNode } from 'react'
import { Edit2, Eye, Trash2, UserSearch } from 'lucide-react'
import {
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { RelativeTime } from '@/components/RelativeTime'
import { useI18n } from '@/i18n/I18nContext'
import { buildDriverDialogHref } from '@/lib/driverEquipment'
import type { Driver } from '@/lib/types'

/** Same pattern as `screens/equipment/EquipmentTable.tsx` (see the comment
 *  there), plus the bulk-selection column driven by `useRowSelection`. */
export interface DriversTableProps {
  rows: Driver[]
  loading: boolean
  error: string | null
  onRetry: () => void
  sort: string
  direction: 'asc' | 'desc'
  onSortChange: (key: string, direction: 'asc' | 'desc') => void
  selected: Set<string>
  onToggleRow: (id: string) => void
  onTogglePage: (ids: string[]) => void
  onOpen: (id: string) => void
  /** Omitted without `drivers.edit`: the row shows no edit button. */
  onEdit?: (driver: Driver) => void
  /** Omitted without `drivers.delete`: no delete button and no selection
   *  column (the selection only feeds the bulk delete). */
  onDelete?: (driver: Driver) => void
  emptyAction?: ReactNode
}

export function DriversTable({
  rows,
  loading,
  error,
  onRetry,
  sort,
  direction,
  onSortChange,
  selected,
  onToggleRow,
  onTogglePage,
  onOpen,
  onEdit,
  onDelete,
  emptyAction,
}: DriversTableProps) {
  const { t } = useI18n()

  if (error) return <ErrorState description={error} onRetry={onRetry} />

  if (!loading && rows.length === 0)
    return (
      <EmptyState
        icon={<UserSearch size={28} aria-hidden="true" />}
        title={t('noDrivers')}
        action={emptyAction}
      />
    )

  const allOnPageSelected =
    rows.length > 0 && rows.every((driver) => selected.has(driver.id))

  const selectColumn: DataTableColumn<Driver>[] = onDelete
    ? [
        {
          key: 'select',
          header: (
            <Checkbox
              checked={allOnPageSelected}
              onCheckedChange={() =>
                onTogglePage(rows.map((driver) => driver.id))
              }
              aria-label={t('selectAll')}
            />
          ),
          width: '2.5rem',
          align: 'center',
          cell: (row) => (
            <Checkbox
              checked={selected.has(row.id)}
              onCheckedChange={() => onToggleRow(row.id)}
              aria-label={row.full_name}
            />
          ),
        },
      ]
    : []

  const columns: DataTableColumn<Driver>[] = [
    ...selectColumn,
    {
      key: 'full_name',
      header: t('fullName'),
      sortable: true,
      // Owner 2026-10-29 (the log / PO list look): the English name is a
      // muted line under the name instead of a column; it still sorts from
      // the toolbar.
      cell: (row) => (
        <span className="flex flex-col text-start">
          <span className="font-semibold">{row.full_name}</span>
          {row.name_en && (
            <span dir="ltr" className="text-start text-xs text-muted">
              {row.name_en}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'id_number',
      header: t('idNumber'),
      cell: (row) => <span dir="ltr">{row.id_number ?? '—'}</span>,
    },
    {
      key: 'mobile_number',
      header: t('mobileNumber'),
      cell: (row) => <span dir="ltr">{row.mobile_number ?? '—'}</span>,
    },
    {
      // EM-237: «الرقم الوظيفي», sorted and searched server-side.
      key: 'employee_number',
      header: t('driverEmployeeNumber'),
      sortable: true,
      hideBelow: 'sm',
      cell: (row) => <span dir="ltr">{row.employee_number ?? '—'}</span>,
    },
    {
      key: 'nationality',
      header: t('nationality'),
      className: 'text-muted',
      hideBelow: 'sm',
      cell: (row) => row.nationality ?? '—',
    },
    {
      key: 'employment_type',
      header: t('employmentType'),
      className: 'text-muted',
      hideBelow: 'md',
      cell: (row) => row.employment_type ?? '—',
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (row) => (
        <span className="flex items-center gap-1">
          <IconButton
            size="sm"
            label={t('viewDetails')}
            title={t('viewDetails')}
            icon={<Eye size={15} />}
            onClick={() => onOpen(row.id)}
          />
          {onEdit && (
            <IconButton
              size="sm"
              label={t('edit')}
              title={t('edit')}
              icon={<Edit2 size={15} />}
              onClick={() => onEdit(row)}
            />
          )}
          {onDelete && (
            <IconButton
              size="sm"
              label={t('delete')}
              title={t('delete')}
              icon={<Trash2 size={15} />}
              onClick={() => onDelete(row)}
            />
          )}
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
      caption={t('drivers')}
      sort={{ key: sort, direction }}
      onSortChange={onSortChange}
      onRowClick={(row) => onOpen(row.id)}
      // The detail is a dialog opened by `?driver=` on the list.
      rowHref={(row) => buildDriverDialogHref(row.id)}
      rowLinkColumn="full_name"
      // Owner 2026-10-29: the log / PO list look — 13 px rows with 8 px above
      // and below the content (headers stay 12 px).
      cellTextClassName="text-[13px]"
      cellClassName="py-2"
      empty={t('noDrivers')}
    />
  )
}
