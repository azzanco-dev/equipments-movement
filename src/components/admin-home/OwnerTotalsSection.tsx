import { useCallback, type ReactNode } from 'react'
import { ClipboardList, Truck } from 'lucide-react'
import { AppLink, Card, ErrorState, Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { fetchAllOwnersStateMatrix } from '@/lib/adminHomeData'
import {
  FLEET_STATES,
  ownerTotals,
  type AdminHomeOwner,
} from '@/lib/adminHomeStats'
import { useAdminHomeSection } from './useAdminHomeSection'
import { useOwnerLabel } from './OwnerFilter'

/** One tone per owner, in `ALL_OWNERS` order (the chart outline shades). */
const OWNER_STROKE: Record<AdminHomeOwner, string> = {
  alazani: 'var(--chart-stroke-1)',
  takween: 'var(--chart-stroke-3)',
  third_party_f: 'var(--chart-stroke-2)',
  third_party_partnership_b: 'var(--chart-stroke-5)',
  external_supplier: 'var(--chart-stroke-4)',
}

/**
 * The equipment list filtered to one owner's active units, optionally in one
 * state (the list's own URL filter format, `useDataListState`).
 */
export function ownerEquipmentHref(
  owner: AdminHomeOwner,
  state?: 'working',
): string {
  const filters = [
    { id: 'owner', field: 'ownership_status', operator: 'eq', value: owner },
    { id: 'status', field: 'status', operator: 'eq', value: 'active' },
    ...(state
      ? [
          {
            id: 'state',
            field: 'equipment_state',
            operator: 'eq',
            value: state,
          },
        ]
      : []),
  ]
  return `/equipment?filters=${encodeURIComponent(JSON.stringify(filters))}`
}

function OwnerTotalCard({
  title,
  hint,
  icon,
  total,
  owners,
  hrefOf,
}: {
  title: string
  hint: string
  icon: ReactNode
  total: number
  owners: { owner: AdminHomeOwner; count: number }[]
  /** Without it (no equipment page) the rows are not links. */
  hrefOf?: (owner: AdminHomeOwner) => string
}) {
  const ownerLabel = useOwnerLabel()
  const share = (count: number) =>
    total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-muted">{title}</h3>
          <p className="text-3xl font-semibold tabular-nums">{total}</p>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-hover text-muted"
        >
          {icon}
        </span>
      </div>
      {/* The owners' shares as one stacked bar. */}
      <div
        aria-hidden="true"
        className="flex h-2 overflow-hidden rounded-full"
        style={{ backgroundColor: 'var(--chart-4)' }}
      >
        {owners.map((row) =>
          row.count > 0 ? (
            <span
              key={row.owner}
              style={{
                width: `${(row.count / total) * 100}%`,
                backgroundColor: OWNER_STROKE[row.owner],
              }}
            />
          ) : null,
        )}
      </div>
      <ul className="divide-y">
        {owners.map((row) => {
          const body = (
            <>
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: OWNER_STROKE[row.owner] }}
              />
              <span className="min-w-0 flex-1">{ownerLabel(row.owner)}</span>
              <span className="text-xs tabular-nums text-muted">
                {share(row.count)}%
              </span>
              <span className="w-10 text-end font-semibold tabular-nums">
                {row.count}
              </span>
            </>
          )
          const rowClass =
            'flex w-full items-center gap-2 py-2 text-start text-sm'
          return (
            <li key={row.owner}>
              {hrefOf ? (
                <AppLink
                  href={hrefOf(row.owner)}
                  className={`${rowClass} rounded transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
                >
                  {body}
                </AppLink>
              ) : (
                <span className={rowClass}>{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * «الاسطول» and «في المشاريع» side by side (owner 2026-10-29, approved on the
 * /ui-kit «نموذج الرئيسية الجديدة»: «قسم الاسطول، اجمالي الاسطول وتحته كل
 * مالك … وقسم المشاريع، اجمالي الي في المشاريع وتحته كل مالك لحاله»): each
 * total with every owner's count, share and a link to the equipment list
 * filtered to that owner. One snapshot (`get_admin_owner_state_matrix` over
 * every owner) feeds both cards, so they never disagree.
 */
export function OwnerTotalsSection({
  canOpenEquipment,
}: {
  canOpenEquipment: boolean
}) {
  const { t } = useI18n()
  const load = useCallback(
    (signal: AbortSignal) => fetchAllOwnersStateMatrix(signal),
    [],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  if (failed)
    return (
      <ErrorState
        title={t('adminHomeSectionError')}
        description={t('adminHomeSectionErrorHint')}
        onRetry={retry}
      />
    )

  if (loading && data === null)
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
        <span className="sr-only">{t('loading')}</span>
      </div>
    )

  if (!data) return null
  const fleet = ownerTotals(data, FLEET_STATES)
  const sites = ownerTotals(data, ['inside_site'])

  return (
    <section
      aria-label={t('adminHomeOwnerTotalsLabel')}
      className="grid gap-4 lg:grid-cols-2"
    >
      <OwnerTotalCard
        title={t('adminHomeOwnerFleetTitle')}
        hint={t('adminHomeOwnerFleetHint')}
        icon={<Truck size={16} />}
        total={fleet.total}
        owners={fleet.owners}
        hrefOf={
          canOpenEquipment ? (owner) => ownerEquipmentHref(owner) : undefined
        }
      />
      <OwnerTotalCard
        title={t('adminHomeOwnerSitesTitle')}
        hint={t('adminHomeOwnerSitesHint')}
        icon={<ClipboardList size={16} />}
        total={sites.total}
        owners={sites.owners}
        hrefOf={
          canOpenEquipment
            ? (owner) => ownerEquipmentHref(owner, 'working')
            : undefined
        }
      />
    </section>
  )
}
