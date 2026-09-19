import { useCallback, useEffect, useState } from 'react'
import { LogIn, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { HomeEquipmentSearch } from '@/components/home/HomeEquipmentSearch'
import { HomeMovementsCard } from '@/components/home/HomeMovementsCard'
import { PendingClassificationCard } from '@/components/home/PendingClassificationCard'
import {
  parseForemanHomeStats,
  parseWorkshopHomeStats,
  type ForemanHomeStats,
  type WorkshopHomeStats,
} from '@/lib/homeStats'
import type { MovementType } from '@/lib/types'

const EMPTY_FOREMAN: ForemanHomeStats = {
  entriesToday: 0,
  exitsToday: 0,
  insideNow: 0,
}
const EMPTY_WORKSHOP: WorkshopHomeStats = {
  insideNow: 0,
  maintenance: 0,
  parking: 0,
  pendingClassification: 0,
  pending: [],
}

/**
 * Home page for the foreman (`supervisor`) and the workshop roles
 * (`workshop`, `assistant_workshop_manager`, `workshop_manager`).
 *
 * First render costs at most three requests per role besides the equipment
 * search: the role's stats function, the movement list, and — for a foreman
 * only — the latest-driver lookup for the entries on the page. The workshop
 * classification section is served by the same stats call as the numbers, so
 * the list and its counter can never disagree.
 */
export function HomeScreen({
  onSelectMovement,
  onCreateMovement,
}: {
  onSelectMovement: (id: string) => void
  onCreateMovement: (type: MovementType) => void
}) {
  const { t } = useI18n()
  const { user, profile } = useAuth()
  const managerMode =
    profile?.role === 'workshop_manager' ||
    profile?.role === 'assistant_workshop_manager'
  const workshopMode = profile?.role === 'workshop' || managerMode

  const [foremanStats, setForemanStats] =
    useState<ForemanHomeStats>(EMPTY_FOREMAN)
  const [workshopStats, setWorkshopStats] =
    useState<WorkshopHomeStats>(EMPTY_WORKSHOP)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [classifyingId, setClassifyingId] = useState<string | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    setStatsLoading(true)
    setStatsError(false)
    void (async () => {
      const { data, error } = await supabase.rpc(
        workshopMode ? 'get_workshop_home_stats' : 'get_foreman_home_stats',
      )
      if (!active) return
      if (error) {
        setStatsError(true)
        setStatsLoading(false)
        return
      }
      if (workshopMode) setWorkshopStats(parseWorkshopHomeStats(data))
      else setForemanStats(parseForemanHomeStats(data))
      setStatsLoading(false)
    })()
    return () => {
      active = false
    }
  }, [user, workshopMode, refreshToken])

  const reload = useCallback(() => setRefreshToken((value) => value + 1), [])

  const classifyEntry = useCallback(
    async (entryLogId: string, purpose: string) => {
      setClassifyingId(entryLogId)
      setClassifyError(null)
      const { error } = await supabase.rpc('classify_workshop_entry', {
        p_entry_log_id: entryLogId,
        p_purpose: purpose,
      })
      setClassifyingId(null)
      if (error) {
        setClassifyError(t('workshopClassificationFailed'))
        return
      }
      reload()
    },
    [reload, t],
  )

  const onClassify = useCallback(
    (entryLogId: string, purpose: string) => {
      void classifyEntry(entryLogId, purpose)
    },
    [classifyEntry],
  )

  const movements = (
    <HomeMovementsCard
      workshopMode={workshopMode}
      canClassify={managerMode}
      onSelectMovement={onSelectMovement}
      onClassify={onClassify}
      classifyingId={classifyingId}
      refreshToken={refreshToken}
    />
  )

  const quickActions = (large: boolean) => (
    <div className={`grid grid-cols-2 gap-3${large ? '' : ' sm:max-w-md'}`}>
      <Button
        variant="primary"
        onClick={() => onCreateMovement('entry')}
        icon={<LogIn size={large ? 18 : 15} aria-hidden="true" />}
        className={large ? 'h-16 text-base' : undefined}
      >
        {t('registerEntry')}
      </Button>
      <Button
        variant="outline"
        onClick={() => onCreateMovement('exit')}
        icon={<LogOut size={large ? 18 : 15} aria-hidden="true" />}
        className={large ? 'h-16 text-base' : undefined}
      >
        {t('registerExit')}
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('dashboard')}
        description={
          managerMode
            ? t('workshopManagerDashboardDesc')
            : t('supervisorDashboardDesc')
        }
      />

      {workshopMode ? (
        <>
          <PendingClassificationCard
            rows={workshopStats.pending}
            loading={statsLoading}
            error={statsError}
            onRetry={reload}
            canClassify={managerMode}
            onClassify={onClassify}
            classifyingId={classifyingId}
            classifyError={classifyError}
          />

          {quickActions(false)}

          {statsError ? (
            <ErrorState onRetry={reload} />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label={t('insideWorkshopNow')}
                value={workshopStats.insideNow}
                loading={statsLoading}
              />
              <StatCard
                label={t('maintenancePurpose')}
                value={workshopStats.maintenance}
                tone="warning"
                loading={statsLoading}
              />
              <StatCard
                label={t('parkingPurpose')}
                value={workshopStats.parking}
                tone="info"
                loading={statsLoading}
              />
              <StatCard
                label={t('awaitingClassification')}
                value={workshopStats.pendingClassification}
                tone="warning"
                loading={statsLoading}
              />
            </div>
          )}

          <HomeEquipmentSearch />
          {movements}
        </>
      ) : (
        <>
          <HomeEquipmentSearch />

          {quickActions(true)}

          {statsError ? (
            <ErrorState onRetry={reload} />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard
                label={t('myEntriesToday')}
                value={foremanStats.entriesToday}
                tone="entry"
                loading={statsLoading}
              />
              <StatCard
                label={t('myExitsToday')}
                value={foremanStats.exitsToday}
                tone="exit"
                loading={statsLoading}
              />
              <StatCard
                label={t('myEquipmentInsideSites')}
                value={foremanStats.insideNow}
                loading={statsLoading}
                className="col-span-2 lg:col-span-1"
              />
            </div>
          )}

          {movements}
        </>
      )}
    </div>
  )
}
