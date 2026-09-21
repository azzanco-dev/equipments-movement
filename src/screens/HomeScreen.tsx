import { useCallback, useEffect, useState } from 'react'
import {
  ClipboardList,
  LogIn,
  LogOut,
  ParkingCircle,
  Warehouse,
  Wrench,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { HomeEquipmentSearch } from '@/components/home/HomeEquipmentSearch'
import { HomeMovementsCard } from '@/components/home/HomeMovementsCard'
import { InquiryCard } from '@/components/home/InquiryCard'
import { PendingClassificationCard } from '@/components/home/PendingClassificationCard'
import {
  insideWorkshopBreakdown,
  parseForemanHomeStats,
  parseWorkshopHomeStats,
  workshopPurposeShare,
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

  // Same 64 px big-button style for both homes (owner decision, wave 6): the
  // two primary actions always lead the page.
  const quickActions = (
    <div className="grid grid-cols-2 gap-3">
      <Button
        variant="primary"
        onClick={() => onCreateMovement('entry')}
        icon={<LogIn size={18} aria-hidden="true" />}
        className="h-16 text-base"
      >
        {t('registerEntry')}
      </Button>
      <Button
        variant="outline"
        onClick={() => onCreateMovement('exit')}
        icon={<LogOut size={18} aria-hidden="true" />}
        className="h-16 text-base"
      >
        {t('registerExit')}
      </Button>
    </div>
  )

  const insideBreakdown = insideWorkshopBreakdown(workshopStats)
  const maintenanceShare = workshopPurposeShare(
    workshopStats.maintenance,
    workshopStats.insideNow,
  )
  const parkingShare = workshopPurposeShare(
    workshopStats.parking,
    workshopStats.insideNow,
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

      {/* The two primary actions and the equipment inquiry entry point
          always lead the page, above every stat or list (owner decision,
          wave 6). */}
      {quickActions}
      <InquiryCard />

      {workshopMode ? (
        <>
          {/* State next: equipment counts right now, before the pending
              queue and the actions that act on them. Mobile layout (owner
              decision): inside-workshop full width, maintenance/parking
              side by side, awaiting-classification full width. Desktop:
              4 across. */}
          {statsError ? (
            <ErrorState onRetry={reload} />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                className="col-span-2 md:col-span-1"
                label={t('insideWorkshopNow')}
                value={workshopStats.insideNow}
                icon={<Warehouse size={18} aria-hidden="true" />}
                hint={
                  insideBreakdown
                    ? t('insideWorkshopBreakdown')
                        .replace(
                          '{maintenance}',
                          String(insideBreakdown.maintenance),
                        )
                        .replace('{parking}', String(insideBreakdown.parking))
                    : undefined
                }
                loading={statsLoading}
              />
              <StatCard
                label={t('maintenancePurpose')}
                value={workshopStats.maintenance}
                tone="warning"
                icon={<Wrench size={18} aria-hidden="true" />}
                hint={
                  maintenanceShare
                    ? t('workshopPurposeShare')
                        .replace('{count}', String(maintenanceShare.count))
                        .replace('{total}', String(maintenanceShare.total))
                    : undefined
                }
                loading={statsLoading}
              />
              <StatCard
                label={t('parkingPurpose')}
                value={workshopStats.parking}
                tone="info"
                icon={<ParkingCircle size={18} aria-hidden="true" />}
                hint={
                  parkingShare
                    ? t('workshopPurposeShare')
                        .replace('{count}', String(parkingShare.count))
                        .replace('{total}', String(parkingShare.total))
                    : undefined
                }
                loading={statsLoading}
              />
              <StatCard
                className="col-span-2 md:col-span-1"
                label={t('awaitingClassification')}
                value={workshopStats.pendingClassification}
                tone="warning"
                icon={<ClipboardList size={18} aria-hidden="true" />}
                loading={statsLoading}
              />
            </div>
          )}

          {/* The plain `workshop` role never sees the pending-classification
              list, only the count card above (owner decision, wave 6). */}
          {managerMode && (
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
          )}

          <HomeEquipmentSearch />
          {movements}
        </>
      ) : (
        <>
          <HomeEquipmentSearch />

          {statsError ? (
            <ErrorState onRetry={reload} />
          ) : (
            <>
              {/* Primary asset-state card (owner decision, wave 6): static,
                  no longer a filter toggle onto the movements list. */}
              <StatCard
                label={t('myEquipmentInsideSitesNow')}
                value={foremanStats.insideNow}
                loading={statsLoading}
              />
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label={t('entriesTodayCount')}
                  value={foremanStats.entriesToday}
                  loading={statsLoading}
                />
                <StatCard
                  label={t('exitsTodayCount')}
                  value={foremanStats.exitsToday}
                  loading={statsLoading}
                />
              </div>
            </>
          )}

          {movements}
        </>
      )}
    </div>
  )
}
