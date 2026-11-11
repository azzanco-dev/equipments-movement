import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import { Button, PageHeader } from '@/components/ui'
import { AfaqyCard } from '@/components/admin-home/AfaqyCard'
import { AfaqySection } from '@/components/admin-home/AfaqySection'
import { AttentionSection } from '@/components/admin-home/AttentionSection'
import { AvailableCard } from '@/components/admin-home/AvailableCard'
import { EntriesCard } from '@/components/admin-home/EntriesCard'
import { FleetStateCard } from '@/components/admin-home/FleetStateCard'
import { FleetStateSection } from '@/components/admin-home/FleetStateSection'
import { KpiStrip } from '@/components/admin-home/KpiStrip'
import { LatestMovementsCard } from '@/components/admin-home/LatestMovementsCard'
import { TopProjectsCard } from '@/components/admin-home/TopProjectsCard'
import { WorkshopPurposeCard } from '@/components/admin-home/WorkshopPurposeCard'
import { WorkshopCard } from '@/components/admin-home/WorkshopCard'
import { useAdminHomeSection } from '@/components/admin-home/useAdminHomeSection'
import { WhatsAppStatusAlert } from '@/components/WhatsAppGatewayStatus'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import { fetchAllOwnersStateMatrix } from '@/lib/adminHomeData'
import { greetingName, greetingParts } from '@/lib/greetingName'
import { saudiGreetingPeriod } from '@/lib/homeGreeting'
import {
  normalizeGranularity,
  type AdminHomeGranularity,
} from '@/lib/adminHomeStats'

/** The Afaqy block's anchor. */
const AFAQY_ANCHOR = 'home-afaqy'

/** The full sections a block's «عرض الكل» opens in place, under its row. */
type Panel = 'fleet-tables' | 'afaqy'

const PANEL_ID: Record<Panel, string> = {
  'fleet-tables': 'home-panel-fleet-tables',
  afaqy: 'home-panel-afaqy',
}

/** A row of three blocks: stacked on a phone, two from md, three from xl
 *  (the approved mockup's variant «ب»). Tighter since the owner's review of
 *  2026-11-10 («قلل المسافات شوي، والمساحات، عشان الصفحة تستوعب اكثر»). */
const ROW = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'
/** The third row holds two blocks since the owner's «خلاص شيل الجدول» of
 *  2026-11-10 took «التوفر حسب النوع» out: half the width each from md. */
const TWO_ROW = 'grid gap-3 md:grid-cols-2'
/** The last block alone across the width (the projects chart since
 *  2026-11-10, «خلي الجدول تحت اخر شي»). */
const FULL_ROW = 'grid gap-3'

export interface AdminHomeScreenProps {
  onSelectEquipment?: (id: string) => void
  /** Opens a movement: «اخر الحركات» and the workshop rows (its open entry). */
  onSelectMovement?: (id: string) => void
  /** The shell opens /logs: the projects, workshop and suppliers link there. */
  canOpenLogs?: boolean
  /** Whether the shell opens a page («يحتاج انتباهك» links only then). */
  canOpenPage?: (
    page: 'logs' | 'purchasing/units' | 'purchasing/orders',
  ) => boolean
  /** Admin only: the legacy dashboard's register entry/exit shortcuts. */
  onCreateMovement?: (type: 'entry' | 'exit') => void
}

/**
 * The admin and monitor home page, rebuilt on the approved /ui-kit «نموذج
 * الرئيسية الجديدة v2» (owner 2026-11-09, «اعتمد الرئيسية الي في ui-kit»,
 * variant «ب بمسافات الحالية»: the mockup's arrangement on the current
 * spacing; EM-252, «الارقام الحالية تاخذ كامل الصفحة»). Top to bottom: the
 * greeting, the eight KPI tiles, then three rows of three blocks — the fleet
 * state, the projects with the most units, the workshop by purpose; the
 * «يحتاج انتباهك», the latest movements beside the workshop now (owner
 * 2026-11-10, «اخر الحركات جنب الورشة»); Afaqy and the daily entries and
 * exits («التوفر حسب النوع» left the page the same day, «خلاص شيل الجدول»). The owner's review of 2026-11-10:
 * the KPI strip counts Al-Azani only (no «بدون PO»), the fleet card is four
 * owner tabs (each a donut), «يحتاج انتباهك» three items, the workshop card
 * tabs by purpose (no suppliers) with an owner filter, the available units
 * table in the first row where the projects chart was, the projects chart
 * («توزيع المعدات على المشاريع») last across the width, and the spacing is
 * tighter.
 *
 * Every block owns its request and its own loading / failure state, so one
 * slow or broken block never blanks the page; the KPI strip, the fleet card,
 * «يحتاج انتباهك» and the workshop tabs share one snapshot over every owner. What a block cannot hold (the
 * full fleet tables with their sort and export,
 * Afaqy's two tables) opens in place under its row from its «عرض الكل». The
 * chart granularity lives in the URL (`?flow=`), so Back restores it.
 */
export function AdminHomeScreen({
  onSelectEquipment,
  onSelectMovement,
  canOpenLogs = false,
  canOpenPage = () => false,
  onCreateMovement,
}: AdminHomeScreenProps) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const name = greetingName(profile?.full_name)
  // Owner 2026-10-29 (the /ui-kit home mockup): «صباح الخير» / «مساء الخير»
  // by Saudi time. The Saudi day under it left on 2026-11-08 («شيل التاريخ
  // تحت مساء الخير»): the header shows the date and time now.
  const now = new Date()
  const parts = greetingParts(
    t(
      saudiGreetingPeriod(now) === 'morning'
        ? 'adminHomeGreetingMorning'
        : 'adminHomeGreetingEvening',
    ),
    name !== '',
  )
  // Owner 2026-10-26: the greeting and the name in one font (the heading's,
  // through `h1 *` in index.css). Smaller since 2026-11-08 («صغّر خط
  // التحية»; it was 30 / 36 px).
  const greeting = parts ? (
    // Bold since owner 2026-10-29 («التصبيحة خليها بولد»).
    <span className="text-[22px] font-bold leading-tight sm:text-[24px]">
      {parts.before}
      <bdi>{name}</bdi>
      {parts.after}
    </span>
  ) : null
  const pathname = usePathname()
  const params = useSearchParams()
  const granularity = normalizeGranularity(params.get('flow'))

  const setGranularity = useCallback(
    (value: AdminHomeGranularity) => {
      const next = new URLSearchParams(params.toString())
      next.set('flow', value)
      const query = next.toString()
      if (query === params.toString()) return
      window.history.replaceState(
        null,
        '',
        query ? `${pathname}?${query}` : pathname,
      )
    },
    [params, pathname],
  )

  // ONE snapshot over every owner for the KPI strip, the fleet card, the
  // attention block and the workshop tabs.
  const loadMatrix = useCallback(
    (signal: AbortSignal) => fetchAllOwnersStateMatrix(signal),
    [],
  )
  const matrix = useAdminHomeSection(loadMatrix)

  const canOpenEquipment = Boolean(onSelectEquipment)
  const [panel, setPanel] = useState<Panel | null>(null)
  // A panel opened by «عرض الكل» comes into view; nothing else scrolls.
  const [scrollTo, setScrollTo] = useState<Panel | null>(null)
  useEffect(() => {
    if (!scrollTo) return
    const element = document.getElementById(PANEL_ID[scrollTo])
    if (element) {
      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'start',
      })
    }
    setScrollTo(null)
  }, [scrollTo])
  const openPanel = (next: Panel) => {
    setPanel(next)
    setScrollTo(next)
  }
  const panelBox = (id: Panel, children: ReactNode) =>
    panel === id ? (
      <div id={PANEL_ID[id]} className="scroll-mt-20 space-y-2">
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
            {t('adminHomeCollapse')}
          </Button>
        </div>
        {children}
      </div>
    ) : null

  return (
    <>
      {/* wave 12: small screens only, admin only, and only when the WhatsApp
          gateway is known to be disconnected (the sidebar shows it on lg+).
          Outside the spaced column so a hidden alert leaves no gap. */}
      <WhatsAppStatusAlert className="mb-4" />
      {/* Less room above the greeting on this page only (owner 2026-11-08,
          «قلل المسافة الي فوق»): the main column's top padding is 16 / 24 /
          32 px; this takes it to 12 / 16 / 16 px. */}
      <div className="-mt-1 space-y-3 sm:-mt-2 lg:-mt-4">
        <PageHeader
          title={greeting ?? t('adminHomeTitle')}
          actions={
            onCreateMovement ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => onCreateMovement('entry')}
                  icon={<LogIn size={16} aria-hidden="true" />}
                >
                  {t('registerEntry')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onCreateMovement('exit')}
                  icon={<LogOut size={16} aria-hidden="true" />}
                >
                  {t('registerExit')}
                </Button>
              </div>
            ) : undefined
          }
        />
        <KpiStrip
          matrix={matrix}
          links={{
            equipment: canOpenEquipment,
            logs: canOpenLogs,
          }}
        />
        <div className={ROW}>
          <FleetStateCard
            matrix={matrix}
            canOpenEquipment={canOpenEquipment}
            canOpenLogs={canOpenLogs}
          />
          <AvailableCard
            canOpenEquipment={canOpenEquipment}
            onSelectEquipment={onSelectEquipment}
          />
          <WorkshopPurposeCard
            canOpenLogs={canOpenLogs}
            canOpenEquipment={canOpenEquipment}
          />
        </div>
        <div className={ROW}>
          <AttentionSection
            matrix={matrix}
            canOpenPage={canOpenPage}
            canOpenEquipment={canOpenEquipment}
          />
          <LatestMovementsCard
            canOpenLogs={canOpenLogs}
            onSelectMovement={onSelectMovement}
          />
          <WorkshopCard
            matrix={matrix}
            onSelectEquipment={onSelectEquipment}
            onSelectMovement={onSelectMovement}
            onShowFleetTables={() => openPanel('fleet-tables')}
          />
        </div>
        {panelBox(
          'fleet-tables',
          <FleetStateSection
            onSelectEquipment={onSelectEquipment}
            onSelectMovement={onSelectMovement}
            showCards={false}
            title="homeV2FleetTables"
            description="homeV2FleetTablesHint"
          />,
        )}
        <div className={TWO_ROW}>
          <AfaqyCard
            id={AFAQY_ANCHOR}
            canOpenEquipment={canOpenEquipment}
            onShowAll={() => openPanel('afaqy')}
          />
          <EntriesCard
            granularity={granularity}
            onGranularityChange={setGranularity}
          />
        </div>
        {panelBox(
          'afaqy',
          <AfaqySection onSelectEquipment={onSelectEquipment} />,
        )}
        <div className={FULL_ROW}>
          <TopProjectsCard canOpenLogs={canOpenLogs} />
        </div>
      </div>
    </>
  )
}
