import { useCallback, useMemo, type ReactNode } from 'react'
import {
  Ban,
  CheckCircle2,
  ClipboardList,
  HardHat,
  LogIn,
  ParkingCircle,
  Truck,
  Wrench,
} from 'lucide-react'
import {
  AppLink,
  Badge,
  ErrorState,
  StatCard,
  cn,
  type BadgeTone,
  type StatCardAccent,
} from '@/components/ui'
import { deepTint } from '@/components/charts'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { fetchEntriesSeries } from '@/lib/adminHomeData'
import {
  availableEquipmentHref,
  insideProjectsLogHref,
  movementLogHref,
  ownerEquipmentHref,
  workshopStateLogHref,
} from '@/lib/adminHomeLinks'
import {
  FLEET_STATES,
  type AdminHomeOwner,
  type OwnerStateMatrix,
} from '@/lib/adminHomeStats'
import { KPI_SPARK_DAYS, dailyRun, sharePercent } from '@/lib/adminHomeV2'
import { addDaysToDateKey } from '@/lib/calendar'
import { saudiDateKey } from '@/lib/saudiTime'
import { CountUp } from './CountUp'
import { MiniBars, ShareBar } from './HomeBlock'
import { KpiStripSkeleton } from './HomeSkeletons'
import type { AdminHomeSectionState } from './useAdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

/** Which list pages the shell opens; a tile links only to an open page. */
export interface KpiLinks {
  equipment: boolean
  logs: boolean
}

/** The one owner the strip counts (owner 2026-11-10, «خلي الارقام الي فوق
 *  تخص العزاني فقط»). */
const STRIP_OWNER: AdminHomeOwner = 'alazani'
const STRIP_OWNERS: AdminHomeOwner[] = [STRIP_OWNER]

interface Kpi {
  id: string
  label: TranslationKey
  value: number
  accent: StatCardAccent
  icon: ReactNode
  /** The chip under the number. */
  chip: ReactNode
  chipTone?: BadgeTone
  /** A real daily run, else the share bar of the figure. */
  visual: ReactNode
  href: string | null
}

const ICON = 15

/** The fleet split in its three places: a real stacked share, no series. */
function PlacesBar({
  parts,
  total,
}: {
  parts: { value: number; shade: number }[]
  total: number
}) {
  return (
    <span
      aria-hidden="true"
      className="block h-2 w-16 shrink-0 overflow-hidden rounded-full bg-surface-hover"
    >
      {/* The fill grows in as one piece, so the three parts keep their
          proportions. */}
      {total > 0 && (
        <span className="bar-grow flex h-full w-full gap-px">
          {parts.map((part, index) => (
            <span
              key={index}
              className="block h-full"
              style={{
                width: `${(part.value / total) * 100}%`,
                backgroundColor: deepTint(
                  `var(--chart-${part.shade})`,
                  `var(--chart-stroke-${part.shade})`,
                ),
              }}
            />
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * The eight KPI tiles of the admin home v2 (owner 2026-11-09, «اعتمد
 * الرئيسية الي في ui-kit», variant «ب»): the fleet, on projects, the three
 * workshop purposes, available, the entries of the Saudi today with the
 * exits as its chip and the real run of the last 14 days, and the workshop
 * units without a purpose. Since the owner's review of 2026-11-10 («خلي
 * الارقام الي فوق تخص العزاني فقط … وشيل بدون PO من فوق») every tile counts
 * the Al-Azani fleet only: the state tiles from the page's ONE
 * `get_admin_owner_state_matrix` snapshot (`count('alazani', state)`, no
 * request of their own), the entries from `get_admin_entries_series` for
 * Al-Azani, and the «بدون PO» tile is gone («غير مصنفة» in its place for
 * everyone). The fleet tile's chip says «العزاني». Every figure counts up;
 * every tile is a link to the Al-Azani rows of the list it stands for when
 * the shell opens it. The tiles without a daily series carry the share bar
 * of their figure, never an invented trend.
 */
export function KpiStrip({
  matrix,
  links,
}: {
  matrix: AdminHomeSectionState<OwnerStateMatrix>
  links: KpiLinks
}) {
  const { t } = useI18n()

  const loadFlow = useCallback(async (signal: AbortSignal) => {
    const today = saudiDateKey()
    const from = addDaysToDateKey(today, -(KPI_SPARK_DAYS - 1)) ?? today
    const rows = await fetchEntriesSeries(
      from,
      today,
      STRIP_OWNERS,
      null,
      signal,
    )
    return {
      entries: dailyRun(rows, 'entries', today),
      exits: dailyRun(rows, 'exits', today),
    }
  }, [])
  const flow = useAdminHomeSection(loadFlow)

  const data = matrix.data
  const kpis: Kpi[] = useMemo(() => {
    if (!data) return []
    const of = (state: string) => data.count(STRIP_OWNER, state)
    const fleet = FLEET_STATES.reduce((sum, state) => sum + of(state), 0)
    const inside = of('inside_site')
    const maintenance = of('workshop_maintenance')
    const parking = of('workshop_parking')
    const outOfService = of('workshop_out_of_service')
    const unclassified = of('workshop_unclassified')
    const available = of('available')
    const workshop = maintenance + parking + outOfService + unclassified
    const share = (value: number) => `${sharePercent(value, fleet)}%`
    const stateTile = (
      id: string,
      label: TranslationKey,
      value: number,
      accent: StatCardAccent,
      shade: number,
      icon: ReactNode,
      href: string | null,
    ): Kpi => ({
      id,
      label,
      value,
      accent,
      icon,
      chip: share(value),
      visual: (
        <ShareBar value={value} total={fleet} shade={shade} className="w-16" />
      ),
      href,
    })
    const todayEntries = flow.data?.entries.at(-1) ?? 0
    const todayExits = flow.data?.exits.at(-1) ?? 0
    return [
      {
        id: 'fleet',
        label: 'homeV2Fleet',
        value: fleet,
        accent: 'chart-1',
        icon: <Truck size={ICON} />,
        chip: t('homeV2AlazaniOnly'),
        visual: (
          <PlacesBar
            total={fleet}
            parts={[
              { value: inside, shade: 1 },
              { value: workshop, shade: 2 },
              { value: available, shade: 6 },
            ]}
          />
        ),
        href: links.equipment ? ownerEquipmentHref(STRIP_OWNER) : null,
      },
      stateTile(
        'projects',
        'homeV2OnProjects',
        inside,
        'chart-1',
        1,
        <HardHat size={ICON} />,
        links.logs ? insideProjectsLogHref(STRIP_OWNER) : null,
      ),
      stateTile(
        'maintenance',
        'maintenancePurpose',
        maintenance,
        'warning',
        2,
        <Wrench size={ICON} />,
        links.logs ? workshopStateLogHref('maintenance', STRIP_OWNERS) : null,
      ),
      stateTile(
        'parking',
        'parkingPurpose',
        parking,
        'info',
        3,
        <ParkingCircle size={ICON} />,
        links.logs ? workshopStateLogHref('parking', STRIP_OWNERS) : null,
      ),
      stateTile(
        'out_of_service',
        'workshopPurposeOutOfService',
        outOfService,
        'danger',
        5,
        <Ban size={ICON} />,
        links.logs
          ? workshopStateLogHref('out_of_service', STRIP_OWNERS)
          : null,
      ),
      stateTile(
        'available',
        'equipmentStateAvailable',
        available,
        'chart-6',
        6,
        <CheckCircle2 size={ICON} />,
        links.equipment ? availableEquipmentHref(STRIP_OWNERS) : null,
      ),
      {
        id: 'today',
        label: 'homeV2EntriesToday',
        value: todayEntries,
        accent: 'entry',
        icon: <LogIn size={ICON} />,
        chip: flow.data
          ? t('homeV2ExitsCount').replace('{count}', String(todayExits))
          : '—',
        chipTone: 'exit',
        visual: flow.data ? (
          <MiniBars values={flow.data.entries} shade={1} />
        ) : null,
        href: links.logs ? movementLogHref() : null,
      },
      stateTile(
        'unclassified',
        'equipmentStateUnclassified',
        unclassified,
        'chart-5',
        5,
        <ClipboardList size={ICON} />,
        links.logs ? workshopStateLogHref(null, STRIP_OWNERS) : null,
      ),
    ]
  }, [data, flow.data, links, t])

  if (matrix.failed)
    return (
      <ErrorState
        title={t('adminHomeSectionError')}
        description={t('adminHomeSectionErrorHint')}
        onRetry={matrix.retry}
      />
    )
  if (!data)
    return (
      <div aria-busy="true">
        <KpiStripSkeleton />
        <span className="sr-only">{t('loading')}</span>
      </div>
    )

  // The entries read fails on its own: its tile says so and offers a
  // retry, the snapshot tiles stay.
  const tileFailed = (id: string) => id === 'today' && flow.failed

  return (
    <ul
      aria-label={t('adminHomeTitle')}
      aria-busy={matrix.loading || undefined}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      {kpis.map((kpi) => {
        const failed = tileFailed(kpi.id)
        const pending = kpi.id === 'today' && flow.loading && !flow.data
        const card = (
          <StatCard
            accent={kpi.accent}
            icon={kpi.icon}
            loading={pending}
            className={cn(
              'h-full rounded-2xl p-3',
              kpi.href && 'transition-colors group-hover:bg-surface-hover',
            )}
            label={t(kpi.label)}
            value={
              failed ? (
                <span className="text-sm font-normal text-danger">
                  {t('adminHomeSectionError')}
                </span>
              ) : (
                <span className="flex items-end justify-between gap-2">
                  <span className="leading-none">
                    <CountUp value={kpi.value} />
                  </span>
                  {kpi.visual}
                </span>
              )
            }
            hint={
              failed ? undefined : (
                <span className="mt-1 flex items-center gap-1">
                  <Badge
                    size="sm"
                    tone={kpi.chipTone ?? 'neutral'}
                    className="tabular-nums"
                  >
                    {kpi.chip}
                  </Badge>
                </span>
              )
            }
          />
        )
        return (
          <li key={kpi.id} className="min-w-0">
            {failed ? (
              <button
                type="button"
                className="block h-full w-full rounded-2xl text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={flow.retry}
                aria-label={`${t(kpi.label)} · ${t('retry')}`}
              >
                {card}
              </button>
            ) : kpi.href ? (
              <AppLink
                href={kpi.href}
                className="group block h-full rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {card}
              </AppLink>
            ) : (
              card
            )}
          </li>
        )
      })}
    </ul>
  )
}
