import { useCallback, useState, type ReactNode } from 'react'
import { ClipboardList, Store, Truck } from 'lucide-react'
import { AppLink, Button, Card, ErrorState, Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  fetchAllOwnersStateMatrix,
  fetchSupplierSiteCounts,
} from '@/lib/adminHomeData'
import {
  FLEET_STATES,
  ownerTotals,
  type AdminHomeOwner,
} from '@/lib/adminHomeStats'
import { EMPTY_FILTER_VALUE } from '@/lib/applyListFilters'
import { SUPPLIER_FILTER_KEY } from '@/lib/equipmentSupplier'
import { useAdminHomeSection } from './useAdminHomeSection'
import { ownershipBadge } from '@/lib/equipmentForm'

/** One light fill per owner (owner 2026-10-29, «لونت الكروت بالوان فاتحة»):
 *  the chart tints, each matching its owner's outline shade below. */
const OWNER_FILL: Record<AdminHomeOwner, string> = {
  alazani: 'var(--chart-1)',
  takween: 'var(--chart-3)',
  third_party_f: 'var(--chart-2)',
  third_party_partnership_b: 'var(--chart-5)',
  external_supplier: 'var(--chart-4)',
}

/** One tone per owner, in `ALL_OWNERS` order (the chart outline shades). */
const OWNER_STROKE: Record<AdminHomeOwner, string> = {
  alazani: 'var(--chart-stroke-1)',
  takween: 'var(--chart-stroke-3)',
  third_party_f: 'var(--chart-stroke-2)',
  third_party_partnership_b: 'var(--chart-stroke-5)',
  external_supplier: 'var(--chart-stroke-4)',
}

/**
 * The equipment list filtered to one owner's active units (the list's own
 * URL filter format, `useDataListState`).
 */
export function ownerEquipmentHref(owner: AdminHomeOwner): string {
  const filters = [
    { id: 'owner', field: 'ownership_status', operator: 'eq', value: owner },
    { id: 'status', field: 'status', operator: 'eq', value: 'active' },
  ]
  return `/equipment?filters=${encodeURIComponent(JSON.stringify(filters))}`
}

/**
 * The log's projects tab as visits, filtered to the units inside now and one
 * owner, or one supplier of «مالك اخر» (owner 2026-10-29, «في المشاريع مفروض
 * الدخوليات وكذلك الموردون في المشاريع»). `/logs` opens on the projects tab
 * and the visits view by default; `v` is the visits URL prefix and the
 * fields are `adminVisitsListConfig`'s. A supplier-less row (`id` null) is
 * the multi-select's «no value» entry.
 */
export function insideProjectsLogHref(
  owner: AdminHomeOwner,
  lessorId?: string | null,
): string {
  const filters = [
    { id: 'open', field: 'is_open', operator: 'eq', value: 'true' },
    {
      id: 'owner',
      field: 'equipment_ownership_status',
      operator: 'eq',
      value: owner,
    },
    ...(lessorId !== undefined
      ? [
          {
            id: 'supplier',
            field: SUPPLIER_FILTER_KEY,
            operator: 'in',
            value: lessorId ?? EMPTY_FILTER_VALUE,
          },
        ]
      : []),
  ]
  return `/logs?vfilters=${encodeURIComponent(JSON.stringify(filters))}`
}

/**
 * One row of small cards (owner 2026-10-29, «تقسم حق الاسطول والمشاريع
 * بحيث تكون في كاردز صغيرة»): the total on its own row, then one card per owner with
 * its full name (as on the equipment page, «الاسماء خليها كاملة»), its count
 * and its share, each a link to its list when the shell opens it.
 */
function OwnerTotalsRow({
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
  /** Without it (the page is not opened by the shell) no card is a link. */
  hrefOf?: (owner: AdminHomeOwner) => string
}) {
  const { t } = useI18n()
  const share = (count: number) =>
    total > 0 ? Math.round((count / total) * 100) : 0
  const cardClass = 'flex h-full flex-col gap-1 rounded-xl p-3'
  return (
    <section aria-label={title} className="space-y-2">
      {/* The total on a row of its own (owner 2026-10-29, «خلي الاجمالي في
          صف لحاله»), the owners' cards under it. */}
      {/* At the start, the right in Arabic («خلي الارقام الاجمالية يمين»):
          the title, the number under it («الارقام الاجمالية تحت العنوان»),
          then the hint (owner 2026-10-29). */}
      <div className="flex items-center gap-3 rounded-xl border bg-surface p-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-3xl font-bold tabular-nums">{total}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-muted"
        >
          {icon}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {owners.map((row) => {
          const body = (
            <>
              <span className="flex items-start gap-1.5 text-xs">
                <span
                  aria-hidden="true"
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: OWNER_STROKE[row.owner] }}
                />
                <span className="min-w-0">
                  {t(ownershipBadge(row.owner).key)}
                </span>
              </span>
              <span className="mt-auto flex items-baseline justify-between gap-2">
                <span className="text-2xl font-bold tabular-nums">
                  {row.count}
                </span>
                <span className="text-xs tabular-nums opacity-80">
                  {share(row.count)}%
                </span>
              </span>
            </>
          )
          // The tint with the charts' readable text (`--chart-text`, dark on
          // the light tints, near-white on the dark theme's).
          // Half the tint over the page («خليها اخف», owner 2026-10-29).
          const tint = {
            backgroundColor: `color-mix(in srgb, ${OWNER_FILL[row.owner]} 50%, var(--bg))`,
            color: 'var(--chart-text)',
          }
          return (
            <li key={row.owner}>
              {hrefOf ? (
                <AppLink
                  href={hrefOf(row.owner)}
                  style={tint}
                  className={`${cardClass} transition-[filter] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
                >
                  {body}
                </AppLink>
              ) : (
                <div style={tint} className={cardClass}>
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Suppliers shown before «عرض الكل». */
const SUPPLIERS_COLLAPSED = 7

/**
 * «الموردون في المشاريع» (owner 2026-10-29, «اضف عمود في المشاريع تبع
 * الموردين», migration 0161): the «مالك اخر» units inside a project now,
 * per supplier, the largest first. It loads on its own, so a failure (or a
 * database without 0161 yet) never hides the two owner cards.
 */
function SupplierSitesCard({ canOpenLogs }: { canOpenLogs: boolean }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const load = useCallback(
    (signal: AbortSignal) => fetchSupplierSiteCounts(signal),
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
  if (loading && data === null) return <Skeleton className="h-40 w-full" />
  if (!data) return null

  const shown = expanded
    ? data.suppliers
    : data.suppliers.slice(0, SUPPLIERS_COLLAPSED)
  const share = (count: number) =>
    data.total > 0 ? Math.round((count / data.total) * 100) : 0

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-muted">
            {t('adminHomeSupplierSitesTitle')}
          </h3>
          <p className="text-3xl font-bold tabular-nums">{data.total}</p>
          <p className="text-xs text-muted">
            {t('adminHomeSupplierSitesHint')}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-hover text-muted"
        >
          <Store size={16} />
        </span>
      </div>
      {data.suppliers.length === 0 ? (
        <p className="text-sm text-muted">{t('adminHomeSupplierSitesEmpty')}</p>
      ) : (
        <ul
          className={`divide-y ${expanded ? 'max-h-80 overflow-y-auto' : ''}`}
        >
          {shown.map((row) => {
            const body = (
              <>
                <span
                  className={`min-w-0 flex-1 ${row.name ? '' : 'text-muted'}`}
                >
                  {row.name ?? t('adminHomeSupplierSitesNone')}
                </span>
                <span className="text-xs tabular-nums text-muted">
                  {share(row.count)}%
                </span>
                <span className="w-10 text-end font-bold tabular-nums">
                  {row.count}
                </span>
              </>
            )
            const rowClass = 'flex w-full items-center gap-2 py-2 text-sm'
            return (
              <li key={row.id ?? 'none'}>
                {canOpenLogs ? (
                  <AppLink
                    href={insideProjectsLogHref('external_supplier', row.id)}
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
      )}
      {data.suppliers.length > SUPPLIERS_COLLAPSED && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t('adminHomeSupplierSitesLess')
            : t('adminHomeSupplierSitesAll').replace(
                '{count}',
                String(data.suppliers.length),
              )}
        </Button>
      )}
    </Card>
  )
}

/**
 * «الاسطول» and «في المشاريع», each a row of small cards, then the suppliers
 * card (owner 2026-10-29, approved on the
 * /ui-kit «نموذج الرئيسية الجديدة»: «قسم الاسطول، اجمالي الاسطول وتحته كل
 * مالك … وقسم المشاريع، اجمالي الي في المشاريع وتحته كل مالك لحاله»): each
 * total with every owner's count, share and a link to the equipment list
 * filtered to that owner. One snapshot (`get_admin_owner_state_matrix` over
 * every owner) feeds both cards, so they never disagree.
 */
export function OwnerTotalsSection({
  canOpenEquipment,
  canOpenLogs,
}: {
  canOpenEquipment: boolean
  canOpenLogs: boolean
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
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <span className="sr-only">{t('loading')}</span>
      </div>
    )

  if (!data) return null
  const fleet = ownerTotals(data, FLEET_STATES)
  const sites = ownerTotals(data, ['inside_site'])

  return (
    // More room between the two sections (owner 2026-10-29).
    <div className="space-y-8">
      <OwnerTotalsRow
        title={t('adminHomeOwnerFleetTitle')}
        hint={t('adminHomeOwnerFleetHint')}
        icon={<Truck size={16} />}
        total={fleet.total}
        owners={fleet.owners}
        hrefOf={
          canOpenEquipment ? (owner) => ownerEquipmentHref(owner) : undefined
        }
      />
      <OwnerTotalsRow
        title={t('adminHomeOwnerSitesTitle')}
        hint={t('adminHomeOwnerSitesHint')}
        icon={<ClipboardList size={16} />}
        total={sites.total}
        owners={sites.owners}
        // The log's open project visits of that owner (owner 2026-10-29).
        hrefOf={
          canOpenLogs ? (owner) => insideProjectsLogHref(owner) : undefined
        }
      />
      <SupplierSitesCard canOpenLogs={canOpenLogs} />
    </div>
  )
}
