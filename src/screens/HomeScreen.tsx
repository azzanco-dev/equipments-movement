import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Ban,
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
import { usePermissions } from '@/auth/PermissionsContext'
import { homeActions } from '@/lib/actionPermissions'
import { Button } from '@/components/ui'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { ErrorState } from '@/components/ui/ErrorState'
import { HomeMovementsCard } from '@/components/home/HomeMovementsCard'
import { InquiryCard } from '@/components/home/InquiryCard'
import { PendingClassificationCard } from '@/components/home/PendingClassificationCard'
import { Card, SectionHeader } from '@/components/ui/Card'
import { LogsScreen } from '@/screens/admin-home/LogsScreen'
import {
  ALL_CONTEXTS_HOME_DEFAULT_TAB,
  resolveHomeMovementsScope,
  type HomeMovementsScope,
} from '@/lib/homeScope'
import {
  changeSinceYesterday,
  formatSignedDelta,
  parseForemanHomeStats,
  parseWorkshopHomeStats,
  type ForemanHomeStats,
  type WorkshopHomeStats,
} from '@/lib/homeStats'
import type { MovementType } from '@/lib/types'
import { greetingName, greetingParts } from '@/lib/greetingName'

const EMPTY_FOREMAN: ForemanHomeStats = {
  entriesToday: 0,
  exitsToday: 0,
  insideNow: 0,
}
const EMPTY_WORKSHOP: WorkshopHomeStats = {
  insideNow: 0,
  maintenance: 0,
  parking: 0,
  outOfService: 0,
  pendingClassification: 0,
  insideYesterday: null,
  maintenanceYesterday: null,
  parkingYesterday: null,
  outOfServiceYesterday: null,
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
 *
 * wave-21-workshop-scope: the stat cards stay about the workshop for every
 * workshop role, but the two workshop managers' movements card is the admin
 * log (`LogsScreen`, embedded) over both contexts; see `homeMovementsScope`.
 */
export function HomeScreen({
  onSelectMovement,
  onCreateMovement,
  movementsScope,
}: {
  onSelectMovement: (id: string) => void
  onCreateMovement: (type: MovementType) => void
  /**
   * wave 23 (routing by permissions, step 2): the list this home shows, as
   * src/App.tsx derives it from the home.foreman / home.workshop scope, so a
   * custom role gets the right variant. Omitted while the permissions load
   * or after a failed load: the home then derives it itself
   * (`resolveHomeMovementsScope`: the same permissions once ready, the
   * narrowest list meanwhile).
   */
  movementsScope?: HomeMovementsScope
}) {
  const { t } = useI18n()
  const { user, profile } = useAuth()
  const permissionState = usePermissions()
  // wave-21-workshop-scope: which movements the home lists. Fails closed: an
  // unknown role or a user without a home key gets the foreman's own-rows
  // list, never a wider one.
  const scope = movementsScope ?? resolveHomeMovementsScope(permissionState)
  const managerMode = scope === 'all_contexts'
  const workshopMode = scope === 'workshop' || managerMode
  // The homes that embed the admin log instead of their own list.
  const embeddedLog =
    managerMode || scope === 'site_all' || scope === 'workshop_all'
  // wave 24: classifying workshop entries follows
  // `movements.workshop.classify` (the two workshop managers with the
  // legacy mapping); nobody while the permissions load or after a failed
  // load. `classify_workshop_entry` stays the authority.
  const holdsClassify = homeActions(permissionState).classifyWorkshopEntries
  const canClassify = workshopMode && holdsClassify
  // 2026-10-28: a foreman home with the embedded log (`site_all` /
  // `workshop_all`) classifies from the log's workshop tab too when its role
  // holds the key; the workshop homes are unchanged.
  const logClassify = holdsClassify && (workshopMode || embeddedLog)
  // The inquiry entry point follows `inquiry.view` (every workshop role holds
  // it with the legacy mapping). The plain foreman home keeps none (owner
  // decision 2026-09-22); a foreman home with the embedded log shows it.
  const canInquire = permissionState.can('inquiry.view')
  const name = greetingName(profile?.full_name)
  const parts = greetingParts(t('homeGreeting'), name !== '')
  const greeting = parts ? (
    <>
      {parts.before}
      <bdi>{name}</bdi>
      {parts.after}
    </>
  ) : null

  const [foremanStats, setForemanStats] =
    useState<ForemanHomeStats>(EMPTY_FOREMAN)
  const [workshopStats, setWorkshopStats] =
    useState<WorkshopHomeStats>(EMPTY_WORKSHOP)
  const [statsLoading, setStatsLoading] = useState(true)
  // True once the stats have loaded at least once. After that a refresh (it
  // runs after every classification) keeps the numbers and the pending list on
  // screen instead of flipping them to skeletons and back.
  const [statsLoaded, setStatsLoaded] = useState(false)
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
      setStatsLoaded(true)
      setStatsLoading(false)
    })()
    return () => {
      active = false
    }
  }, [user, workshopMode, refreshToken])

  const reload = useCallback(() => setRefreshToken((value) => value + 1), [])

  // Skeleton on the first load only; `statsRefreshing` marks a background
  // refresh of values that are already on screen.
  const statsFirstLoad = statsLoading && !statsLoaded
  const statsRefreshing = statsLoading && statsLoaded

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

  // wave-21-workshop-scope (owner decision 2026-10-11): the two workshop
  // managers read every movement and visit through the admin log itself —
  // its context tabs (projects / workshop / all, opening on the workshop),
  // its filter dialog, its visits/log views and its export — with the
  // classification of workshop entries kept on the workshop tab. The plain
  // `workshop` role and the foreman keep their own lists.
  // The workshop homes show a failed classification on the pending card; a
  // foreman home has no such card, so its log shows it.
  const classify = useMemo(
    () => ({
      onClassify,
      classifyingId,
      error: workshopMode ? null : classifyError,
    }),
    [onClassify, classifyingId, workshopMode, classifyError],
  )
  // A foreman home allowed to read more than its own rows (`site_all` /
  // `workshop_all`, owner 2026-10-28) embeds the same log, opening on
  // «المشاريع» or «الورشة».
  const movements = embeddedLog ? (
    <Card className="space-y-3">
      <SectionHeader as="h2" title={t('homeAllMovementsTitle')} />
      <LogsScreen
        embedded
        defaultContext={
          scope === 'site_all' ? 'site' : ALL_CONTEXTS_HOME_DEFAULT_TAB
        }
        // `workshop_all` opens on the workshop like the managers' home.
        classify={logClassify ? classify : undefined}
        onSelectMovement={onSelectMovement}
        refreshToken={refreshToken}
      />
    </Card>
  ) : (
    <HomeMovementsCard
      workshopMode={workshopMode}
      canClassify={canClassify}
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

  // Each workshop state card's secondary line is its change since yesterday
  // (owner decision, wave 6): the maintenance/parking split is already its
  // own cards, so it is not repeated here.
  const yesterdayHint = (now: number, yesterday: number | null) => {
    const delta = changeSinceYesterday(now, yesterday)
    if (delta === null) return undefined
    if (delta === 0) return t('noChangeSinceYesterday')
    return t('changeSinceYesterday').replace(
      '{delta}',
      formatSignedDelta(delta),
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={greeting ?? t('dashboard')}
        description={
          managerMode
            ? t('workshopManagerDashboardDesc')
            : t('supervisorDashboardDesc')
        }
      />

      {/* The two primary actions always lead the page, above every stat or
          list (owner decision, wave 6). */}
      {quickActions}

      {workshopMode ? (
        <>
          {/* The equipment inquiry entry point is workshop-only: the
              foreman does not need it on the home (owner decision,
              2026-09-22). */}
          {canInquire && <InquiryCard />}

          {/* State next: equipment counts right now, before the pending
              queue and the actions that act on them. Mobile layout (owner
              decision): inside-workshop full width, maintenance/parking
              side by side, awaiting-classification full width. Desktop:
              4 across. */}
          {statsError ? (
            <ErrorState onRetry={reload} />
          ) : (
            <div
              className="grid grid-cols-2 gap-3 md:grid-cols-5"
              aria-busy={statsRefreshing || undefined}
            >
              <StatCard
                className="col-span-2 md:col-span-1"
                label={t('insideWorkshopNow')}
                value={workshopStats.insideNow}
                icon={<Warehouse size={18} aria-hidden="true" />}
                hint={yesterdayHint(
                  workshopStats.insideNow,
                  workshopStats.insideYesterday,
                )}
                loading={statsFirstLoad}
              />
              <StatCard
                label={t('maintenancePurpose')}
                value={workshopStats.maintenance}
                tone="warning"
                icon={<Wrench size={18} aria-hidden="true" />}
                hint={yesterdayHint(
                  workshopStats.maintenance,
                  workshopStats.maintenanceYesterday,
                )}
                loading={statsFirstLoad}
              />
              <StatCard
                label={t('parkingPurpose')}
                value={workshopStats.parking}
                tone="info"
                icon={<ParkingCircle size={18} aria-hidden="true" />}
                hint={yesterdayHint(
                  workshopStats.parking,
                  workshopStats.parkingYesterday,
                )}
                loading={statsFirstLoad}
              />
              {/* wave 20 (migration 0125): the third purpose. */}
              <StatCard
                label={t('workshopPurposeOutOfService')}
                value={workshopStats.outOfService}
                tone="danger"
                icon={<Ban size={18} aria-hidden="true" />}
                hint={yesterdayHint(
                  workshopStats.outOfService,
                  workshopStats.outOfServiceYesterday,
                )}
                loading={statsFirstLoad}
              />
              <StatCard
                label={t('awaitingClassification')}
                value={workshopStats.pendingClassification}
                tone="warning"
                icon={<ClipboardList size={18} aria-hidden="true" />}
                loading={statsFirstLoad}
              />
            </div>
          )}

          {/* The plain `workshop` role never sees the pending-classification
              list, only the count card above (owner decision, wave 6).
              wave 24: the list is for the holders of the classify key. */}
          {canClassify && (
            <PendingClassificationCard
              rows={workshopStats.pending}
              loading={statsFirstLoad}
              refreshing={statsRefreshing}
              error={statsError}
              onRetry={reload}
              canClassify={canClassify}
              onClassify={onClassify}
              classifyingId={classifyingId}
              classifyError={classifyError}
            />
          )}

          {movements}
        </>
      ) : (
        <>
          {embeddedLog && canInquire && <InquiryCard />}

          {statsError ? (
            <ErrorState onRetry={reload} />
          ) : (
            <>
              {/* Primary asset-state card (owner decision, wave 6): static,
                  no longer a filter toggle onto the movements list. */}
              <StatCard
                label={t('myEquipmentInsideSitesNow')}
                value={foremanStats.insideNow}
                loading={statsFirstLoad}
              />
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label={t('entriesTodayCount')}
                  value={foremanStats.entriesToday}
                  loading={statsFirstLoad}
                />
                <StatCard
                  label={t('exitsTodayCount')}
                  value={foremanStats.exitsToday}
                  loading={statsFirstLoad}
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
