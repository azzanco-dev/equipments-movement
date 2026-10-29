import { useCallback, useState, type ReactNode } from 'react'
import { ClipboardList, Store, Truck, Warehouse } from 'lucide-react'
import { AppLink, Button, Card, ErrorState, Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
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

/** One tone per owner, in `ALL_OWNERS` order (the chart outline shades). */
const OWNER_STROKE: Record<AdminHomeOwner, string> = {
  alazani: 'var(--chart-stroke-1)',
  takween: 'var(--chart-stroke-3)',
  third_party_f: 'var(--chart-stroke-2)',
  third_party_partnership_b: 'var(--chart-stroke-5)',
  external_supplier: 'var(--chart-stroke-4)',
}

/** The states of «المتبقي» (owner 2026-10-29, «وحالات الورشة», then «خلي
 *  قسم في الورشة يصير المتبقي، والي هو الاسطول - المشاريع»): the four
 *  workshop states and available. Label, the shade its card is tinted with,
 *  and what it opens: the log's open workshop visits of a purpose (`null` =
 *  no purpose yet), or the equipment list of the available units. */
const REST_STATES: {
  state: string
  label: TranslationKey
  stroke: string
  purpose: 'maintenance' | 'parking' | 'out_of_service' | null | 'available'
}[] = [
  {
    state: 'workshop_maintenance',
    label: 'maintenancePurpose',
    stroke: 'var(--chart-stroke-2)',
    purpose: 'maintenance',
  },
  {
    state: 'workshop_parking',
    label: 'parkingPurpose',
    stroke: 'var(--chart-stroke-3)',
    purpose: 'parking',
  },
  {
    state: 'workshop_out_of_service',
    label: 'workshopPurposeOutOfService',
    stroke: 'var(--danger)',
    purpose: 'out_of_service',
  },
  {
    state: 'workshop_unclassified',
    label: 'equipmentStateUnclassified',
    stroke: 'var(--chart-stroke-5)',
    purpose: null,
  },
  {
    state: 'available',
    label: 'equipmentStateAvailable',
    stroke: 'var(--chart-stroke-6)',
    purpose: 'available',
  },
]

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

/** The log's workshop tab as visits, the open ones of one workshop purpose
 *  (`null` = not classified yet). */
export function workshopStateLogHref(
  purpose: 'maintenance' | 'parking' | 'out_of_service' | null,
): string {
  const filters = [
    { id: 'open', field: 'is_open', operator: 'eq', value: 'true' },
    purpose
      ? {
          id: 'purpose',
          field: 'workshop_purpose',
          operator: 'eq',
          value: purpose,
        }
      : {
          id: 'purpose',
          field: 'workshop_purpose',
          operator: 'is_not_set',
          value: '',
        },
  ]
  return `/logs?context=workshop&vfilters=${encodeURIComponent(JSON.stringify(filters))}`
}

/** The equipment list of one owner's active units outside a project (the
 *  fleet minus the projects: workshop and available), or of every active
 *  available unit when `owner` is null. */
export function restEquipmentHref(owner: AdminHomeOwner | null): string {
  const filters = [
    ...(owner
      ? [
          {
            id: 'owner',
            field: 'ownership_status',
            operator: 'eq',
            value: owner,
          },
          {
            id: 'state',
            field: 'equipment_state',
            operator: 'neq',
            value: 'working',
          },
        ]
      : [
          {
            id: 'state',
            field: 'equipment_state',
            operator: 'eq',
            value: 'available',
          },
        ]),
    { id: 'status', field: 'status', operator: 'eq', value: 'active' },
  ]
  return `/equipment?filters=${encodeURIComponent(JSON.stringify(filters))}`
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
  extra,
}: {
  title: string
  hint: string
  icon: ReactNode
  total: number
  owners: { owner: AdminHomeOwner; count: number }[]
  /** Without it (the page is not opened by the shell) no card is a link. */
  hrefOf?: (owner: AdminHomeOwner) => string
  /** A further row under the owners' cards (the workshop states). */
  extra?: ReactNode
}) {
  const { t } = useI18n()
  const share = (count: number) =>
    total > 0 ? Math.round((count / total) * 100) : 0
  const cardClass = 'flex h-full flex-col gap-1 rounded-xl p-3'
  return (
    // Each section in a box of its own (owner 2026-10-29, «خلي قسم قسم في
    // مربع»).
    <Card as="div" className="space-y-3">
      <section aria-label={title} className="space-y-3">
        {/* The total on a row of its own (owner 2026-10-29, «خلي الاجمالي في
          صف لحاله»), the owners' cards under it. */}
        {/* At the start, the right in Arabic («خلي الارقام الاجمالية يمين»):
          the title and the hint, then the number under both («تحت
          النصوص», owner 2026-10-29), with the icon before them, on their
          right («والايقونة يمينهم»). */}
        <div className="flex items-start gap-3 rounded-xl bg-surface p-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-muted"
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{title}</span>
            <span className="block text-xs text-muted">{hint}</span>
            <span className="mt-1 block text-3xl font-bold tabular-nums">
              {total}
            </span>
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
            // A light fill per owner (owner 2026-10-29, «لونت الكروت بالوان
            // فاتحة» then «خليها اخف»): its outline shade at 18% over the page,
            // so the hues stay apart (the pastel tints made Takween's blue and
            // B's violet look alike, «لون تكوين قريب من لون B»). The text is
            // the charts' readable one (`--chart-text`).
            const tint = {
              backgroundColor: `color-mix(in srgb, ${OWNER_STROKE[row.owner]} 18%, var(--bg))`,
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
        {extra}
      </section>
    </Card>
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
export function SupplierSitesCard({ canOpenLogs }: { canOpenLogs: boolean }) {
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
        <Skeleton className="h-28 w-full" />
        <span className="sr-only">{t('loading')}</span>
      </div>
    )

  if (!data) return null
  const fleet = ownerTotals(data, FLEET_STATES)
  const sites = ownerTotals(data, ['inside_site'])
  // «المتبقي»: the fleet minus the projects — every workshop state and
  // available.
  const rest = ownerTotals(
    data,
    FLEET_STATES.filter((state) => state !== 'inside_site'),
  )

  return (
    // More room between the two sections (owner 2026-10-29).
    <div className="space-y-4">
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
      <OwnerTotalsRow
        title={t('adminHomeOwnerRestTitle')}
        hint={t('adminHomeOwnerRestHint')}
        icon={<Warehouse size={16} />}
        total={rest.total}
        owners={rest.owners}
        // That owner's units outside a project, on the equipment list.
        hrefOf={
          canOpenEquipment ? (owner) => restEquipmentHref(owner) : undefined
        }
        // Then its states over every owner: the workshop's and available.
        extra={
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {REST_STATES.map((item) => {
              const count = ownerTotals(data, [item.state]).total
              const share =
                rest.total > 0 ? Math.round((count / rest.total) * 100) : 0
              const href =
                item.purpose === 'available'
                  ? canOpenEquipment
                    ? restEquipmentHref(null)
                    : null
                  : canOpenLogs
                    ? workshopStateLogHref(item.purpose)
                    : null
              const style = {
                backgroundColor: `color-mix(in srgb, ${item.stroke} 18%, var(--bg))`,
                color: 'var(--chart-text)',
              }
              const body = (
                <>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.stroke }}
                    />
                    {t(item.label)}
                  </span>
                  <span className="mt-auto flex items-baseline justify-between gap-2">
                    <span className="text-2xl font-bold tabular-nums">
                      {count}
                    </span>
                    <span className="text-xs tabular-nums opacity-80">
                      {share}%
                    </span>
                  </span>
                </>
              )
              const cardClass = 'flex h-full flex-col gap-1 rounded-xl p-3'
              return (
                <li key={item.state}>
                  {href ? (
                    <AppLink
                      href={href}
                      style={style}
                      className={`${cardClass} transition-[filter] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
                    >
                      {body}
                    </AppLink>
                  ) : (
                    <div style={style} className={cardClass}>
                      {body}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        }
      />
    </div>
  )
}
