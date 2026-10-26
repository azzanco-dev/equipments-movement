import { useCallback, type ReactNode } from 'react'
import {
  Clock3,
  Navigation,
  PowerOff,
  Radio,
  SignalZero,
  Timer,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { AppLink, Notice, StatCard } from '@/components/ui'
import type { StatCardAccent } from '@/components/ui/StatCard'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { canViewEquipmentLocation } from '@/lib/actionPermissions'
import { loadAfaqyStats, type AfaqyStatsAnswer } from '@/lib/afaqy'
import type { AfaqyStats, AfaqyStatsUnit } from '@/lib/afaqyStats'
import { formatDateTime } from '@/lib/dateFormat'
import { supabase } from '@/lib/supabase'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

const ICON_SIZE = 16

interface CardDef {
  label: TranslationKey
  hint?: TranslationKey
  value: (stats: AfaqyStats) => ReactNode
  accent: StatCardAccent
  icon: ReactNode
}

/** Coverage and the age of the last signal. */
const SIGNAL_CARDS: CardDef[] = [
  {
    label: 'afaqyHomeLinked',
    value: (stats) => `${stats.linked} / ${stats.fleet}`,
    accent: 'primary',
    icon: <Radio size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeRecent',
    hint: 'afaqyHomeRecentHint',
    value: (stats) => stats.signal.recent,
    accent: 'success',
    icon: <Wifi size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeStale',
    hint: 'afaqyHomeStaleHint',
    value: (stats) => stats.signal.stale,
    accent: 'warning',
    icon: <Clock3 size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeSilent',
    hint: 'afaqyHomeSilentHint',
    value: (stats) => stats.signal.silent,
    accent: 'danger',
    icon: <WifiOff size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeNoSignal',
    hint: 'afaqyHomeNoSignalHint',
    value: (stats) => stats.signal.none,
    accent: 'neutral',
    icon: <SignalZero size={ICON_SIZE} />,
  },
]

/** What the units heard in the last hour do now. */
const NOW_CARDS: CardDef[] = [
  {
    label: 'afaqyHomeMoving',
    value: (stats) => stats.now.moving,
    accent: 'success',
    icon: <Navigation size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeIdling',
    hint: 'afaqyHomeIdlingHint',
    value: (stats) => stats.now.idling,
    accent: 'warning',
    icon: <Timer size={ICON_SIZE} />,
  },
  {
    label: 'afaqyHomeOff',
    value: (stats) => stats.now.off,
    accent: 'neutral',
    icon: <PowerOff size={ICON_SIZE} />,
  },
]

const LISTS: { key: keyof AfaqyStats['lists']; title: TranslationKey }[] = [
  { key: 'workshopRunning', title: 'afaqyHomeWorkshopRunning' },
  { key: 'availableMoving', title: 'afaqyHomeAvailableMoving' },
  { key: 'idling', title: 'afaqyHomeIdlingList' },
  { key: 'silent', title: 'afaqyHomeSilentList' },
]

export interface AfaqySectionProps {
  onSelectEquipment?: (id: string) => void
}

/**
 * «افاقي» on the admin home (owner 2026-10-26: «ابغى استعرض بيانات احصائية
 * للمعدات في افاقي … خلينا على المعدات الي في البرنامج مضافة»): for the
 * program's active fleet, how many units are linked to a tracker, how fresh
 * their last signal is, what the units heard in the last hour do now, and
 * the units worth a look (engine running in the workshop, moving while out,
 * idling, silent for a day). Afaqy gives the last signal only, so this is a
 * snapshot. Shown with `equipment.location.view` (the «الموقع الحالي» key;
 * the admin role while the permissions load); the route checks it again.
 */
export function AfaqySection(props: AfaqySectionProps) {
  const { profile } = useAuth()
  const permissionState = usePermissions()
  if (!canViewEquipmentLocation(permissionState, profile?.role)) return null
  return <AfaqySectionContent {...props} />
}

function AfaqySectionContent({ onSelectEquipment }: AfaqySectionProps) {
  const { t } = useI18n()
  const load = useCallback(async (signal: AbortSignal) => {
    const answer: AfaqyStatsAnswer | null = await loadAfaqyStats(
      supabase,
      signal,
    )
    if (!answer || answer.kind === 'error') throw new Error('afaqy_stats')
    return answer
  }, [])
  const { data, loading, failed, retry } = useAdminHomeSection(load)
  const stats = data?.kind === 'ok' ? data.stats : null

  const unitLink = (unit: AfaqyStatsUnit) => (
    <li key={unit.id}>
      <AppLink
        href={`/equipment/${unit.id}`}
        onNavigate={
          onSelectEquipment ? () => onSelectEquipment(unit.id) : undefined
        }
        className="inline-flex h-7 items-center rounded-md bg-surface-hover px-2.5 text-xs font-semibold hover:underline"
      >
        <bdi dir="ltr">{unit.code}</bdi>
      </AppLink>
    </li>
  )

  return (
    <AdminHomeSection
      title={t('afaqyHomeTitle')}
      description={t('afaqyHomeDescription')}
      loading={loading && data === null}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-48 w-full"
    >
      {data?.kind === 'not_configured' ? (
        <Notice tone="neutral">{t('afaqyStatusNotConfigured')}</Notice>
      ) : stats ? (
        <div className="space-y-4" aria-busy={loading || undefined}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {SIGNAL_CARDS.map((card) => (
              <StatCard
                key={card.label}
                label={t(card.label)}
                value={<bdi dir="ltr">{card.value(stats)}</bdi>}
                hint={card.hint ? t(card.hint) : undefined}
                accent={card.accent}
                icon={card.icon}
              />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('afaqyHomeNowTitle')}</h3>
            <div className="grid grid-cols-3 gap-3">
              {NOW_CARDS.map((card) => (
                <StatCard
                  key={card.label}
                  label={t(card.label)}
                  value={card.value(stats)}
                  hint={card.hint ? t(card.hint) : undefined}
                  accent={card.accent}
                  icon={card.icon}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {LISTS.map(({ key, title }) => {
              const units = stats.lists[key]
              return (
                <section key={key} className="rounded-lg border p-3">
                  <h3 className="mb-2 text-sm font-medium">
                    {t(title)}{' '}
                    <span className="text-muted">
                      ({stats.listTotals[key]})
                    </span>
                  </h3>
                  {units.length === 0 ? (
                    <p className="text-xs text-muted">{t('afaqyHomeNone')}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {units.map(unitLink)}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
          <p className="text-xs text-muted">
            {t('afaqyHomeUpdated')}{' '}
            <bdi dir="ltr">{formatDateTime(stats.generatedAt, false)}</bdi>
          </p>
        </div>
      ) : null}
    </AdminHomeSection>
  )
}
