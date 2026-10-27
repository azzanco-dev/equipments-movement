import { useEffect, useMemo, useState } from 'react'
import { Building2, Calendar, ExternalLink, Hash, Tag } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Button,
  InfoGrid,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type InfoGridItem,
} from '@/components/ui'
import { InquiryNow } from '@/components/inquiry/InquiryNow'
import { InquiryThinking } from '@/components/inquiry/InquiryThinking'
import { InquiryYearNumbers, InquiryYearStrip } from '@/components/inquiry/InquiryYear'
import { InquiryJourney, inquiryVisitAnchor } from '@/components/inquiry/InquiryJourney'
import { InquiryPoCard } from '@/components/inquiry/InquiryPoCard'
import { InquiryPlate } from '@/components/inquiry/InquiryPlate'
import {
  INQUIRY_SURFACE,
  InquiryCardTitle,
  inquiryRise,
} from '@/components/inquiry/inquiryStyle'
import { EquipmentStateBadge } from '@/components/equipment/EquipmentStateBadge'
import { equipmentStateFromMovement, type EquipmentState } from '@/lib/equipmentState'
import { formatDate } from '@/lib/dateFormat'
import { buildEquipmentVisits, type TimelineMovement } from '@/lib/visitTimeline'
import {
  inquiryYearDays,
  inquiryYearMonths,
  summarizeInquiryYear,
} from '@/lib/inquiryYear'

// One sample unit whose 2026 passes through every state (owner 2026-10-27:
// «في ui-kit سوي معدة فيها جميع الحالات عشان اشوفها»), drawn by the REAL
// components of /inquiry — the status card, the year numbers and strip, the
// PO card and the visit history — so what shows here is what the page
// shows. Sample data only; the header and the facts card copy the screen's
// markup (they live inside EquipmentInquiryScreen).

/** A fixed "now" so the sample reads the same every day: 27 October 2026,
 *  noon in Saudi time. */
const NOW = Date.parse('2026-10-27T09:00:00Z')
const YEAR = 2026
const CREATED_AT = Date.parse('2025-12-01T09:00:00Z')

const SALINI = {
  company_name: 'شركة ساليني العربية السعودية المحدودة',
  project_name: 'مشروع الدرعية',
  supervisor_name: 'Jagdeep Chopra',
}
const NESMA = {
  company_name: 'شركة نسما للمقاولات',
  project_name: 'مشروع البحر الاحمر',
  supervisor_name: 'محمد صالح',
}
const MABANI = {
  company_name: 'شركة المباني',
  project_name: 'مشروع حي السفارات',
  supervisor_name: 'احمد يوسف',
}
const WORKSHOP = { supervisor_name: 'صادق الساقية' }

/** A Saudi day at a wall-clock hour. */
function at(date: string, hour: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (hour - 3) * 3_600_000).toISOString()
}

/** The unit's 2026, oldest first. Each "now" variant keeps a prefix of it. */
const MOVEMENTS: TimelineMovement[] = [
  { id: 'm01', movement_context: 'site', movement_type: 'entry', recorded_at: at('2026-01-05', 8), ...SALINI, driver_name: 'سالم العتيبي' },
  { id: 'm02', movement_context: 'site', movement_type: 'exit', recorded_at: at('2026-02-20', 16), ...SALINI, driver_name: 'سالم العتيبي', exit_purpose: 'maintenance' },
  { id: 'm03', movement_context: 'workshop', movement_type: 'entry', recorded_at: at('2026-02-21', 10), ...WORKSHOP, workshop_purpose: 'maintenance' },
  { id: 'm04', movement_context: 'workshop', movement_type: 'exit', recorded_at: at('2026-03-10', 14), ...WORKSHOP },
  { id: 'm05', movement_context: 'site', movement_type: 'entry', recorded_at: at('2026-04-01', 8), ...NESMA, driver_name: 'ماجد الحربي' },
  { id: 'm06', movement_context: 'site', movement_type: 'exit', recorded_at: at('2026-06-15', 17), ...NESMA, driver_name: 'فهد القحطاني', exit_purpose: 'work_completed' },
  { id: 'm07', movement_context: 'workshop', movement_type: 'entry', recorded_at: at('2026-06-20', 11), ...WORKSHOP, workshop_purpose: 'parking' },
  { id: 'm08', movement_context: 'workshop', movement_type: 'exit', recorded_at: at('2026-07-30', 13), ...WORKSHOP },
  { id: 'm09', movement_context: 'site', movement_type: 'entry', recorded_at: at('2026-08-02', 8), ...MABANI, driver_name: 'سعيد الشمري' },
  { id: 'm10', movement_context: 'site', movement_type: 'exit', recorded_at: at('2026-09-10', 16), ...MABANI, driver_name: 'سعيد الشمري', exit_purpose: 'maintenance' },
  { id: 'm11', movement_context: 'workshop', movement_type: 'entry', recorded_at: at('2026-09-12', 10), ...WORKSHOP, workshop_purpose: 'out_of_service' },
  { id: 'm12', movement_context: 'workshop', movement_type: 'exit', recorded_at: at('2026-09-30', 15), ...WORKSHOP },
  { id: 'm13', movement_context: 'site', movement_type: 'entry', recorded_at: at('2026-10-10', 8), ...SALINI, driver_name: 'عبدالله احمد علي احمد النعمي' },
]

type NowVariant = 'site' | 'maintenance' | 'parking' | 'out_of_service' | 'unrecorded' | 'loading'

/** Where the unit is now in each variant: how many of the movements it
 *  keeps (the day "now" stays the same). */
const VARIANTS: { value: NowVariant; label: string; keep: number }[] = [
  { value: 'site', label: 'في مشروع', keep: 13 },
  { value: 'maintenance', label: 'صيانة', keep: 3 },
  { value: 'parking', label: 'وقوف', keep: 7 },
  { value: 'out_of_service', label: 'خارج الخدمة', keep: 11 },
  { value: 'unrecorded', label: 'بدون تسجيل', keep: 12 },
  { value: 'loading', label: 'تحميل', keep: 13 },
]

export function InquiryAllStatesShowcase() {
  // Drawn after mounting, like the page itself (it never renders on the
  // server).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <Skeleton className="h-[640px] w-full rounded-3xl" />
  return <AllStates />
}

function AllStates() {
  const { t } = useI18n()
  const [variant, setVariant] = useState<NowVariant>('site')
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)
  const keep = VARIANTS.find((item) => item.value === variant)?.keep ?? 13
  const movements = useMemo(() => MOVEMENTS.slice(0, keep), [keep])
  const visits = useMemo(() => buildEquipmentVisits(movements), [movements])
  const year = useMemo(() => {
    const days = inquiryYearDays(visits, CREATED_AT, NOW, YEAR)
    return { days, months: inquiryYearMonths(days), summary: summarizeInquiryYear(days) }
  }, [visits])
  const latest = movements[movements.length - 1]
  const state: EquipmentState = equipmentStateFromMovement({
    movement_type: latest.movement_type,
    movement_context: latest.movement_context,
    workshop_purpose: latest.workshop_purpose ?? null,
  })
  const insideProject = latest.movement_context === 'site' && latest.movement_type === 'entry'

  const selectVisit = (key: string) => {
    setHighlightedKey(key)
    window.requestAnimationFrame(() =>
      document
        .getElementById(inquiryVisitAnchor(key))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    )
  }

  const facts: InfoGridItem[] = [
    {
      key: 'owner',
      icon: <Tag size={15} aria-hidden="true" />,
      label: t('ownershipStatus'),
      value: t('ownershipAlazani'),
    },
    {
      key: 'plate',
      icon: <Hash size={15} aria-hidden="true" />,
      label: t('plateNumber'),
      value: <InquiryPlate plate="1128-XVV" chassis={null} />,
    },
    {
      key: 'chassis',
      icon: <Hash size={15} aria-hidden="true" />,
      label: t('chassisNumber'),
      value: 'JHHZJL1H0BK001128',
      dir: 'ltr',
    },
    {
      key: 'created',
      icon: <Calendar size={15} aria-hidden="true" />,
      label: t('inquiryCreatedAt'),
      value: formatDate(new Date(CREATED_AT)),
      dir: 'ltr',
    },
  ]

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">A291 — كل الحالات في 2026</h3>
          <p className="text-xs text-muted">
            بيانات عينة على مكونات الصفحة الحقيقية، واليوم ثابت على 27/10/2026.
            اختر وين المعدة الحين.
          </p>
        </div>
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <Tabs
            value={variant}
            onValueChange={(next) => {
              setVariant(next as NowVariant)
              setHighlightedKey(null)
            }}
          >
            <TabsList variant="segmented" aria-label="وين المعدة الحين">
              {VARIANTS.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="inquiry-page-bg rounded-3xl bg-surface px-3 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-4">
          {variant === 'loading' ? (
            <InquiryThinking code="A291" />
          ) : (
            <div key={variant} className="space-y-4">
              <section className={cn(INQUIRY_SURFACE, 'inq-rise space-y-4 p-4')} style={inquiryRise(0)}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold leading-none">
                        <bdi dir="ltr">A291</bdi>
                      </h2>
                      <EquipmentStateBadge state={state} />
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                      <span className="font-medium text-fg">CRANE 7 TON BASKET</span>
                      <span aria-hidden="true">·</span>
                      <InquiryPlate plate="1128-XVV" chassis={null} />
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" icon={<ExternalLink size={14} aria-hidden="true" />}>
                      {t('inquiryEquipmentPage')}
                    </Button>
                    <Button size="sm" variant="ghost">
                      {t('inquiryAnotherUnit')}
                    </Button>
                  </div>
                </div>
                <InquiryNow visits={visits} state={state} now={NOW} />
              </section>

              <div
                className="inq-rise flex items-center justify-between gap-2 px-1 pt-2"
                style={inquiryRise(1)}
              >
                <h3 className="text-base font-semibold">
                  {t('inquiryActivityIn').replace('{year}', String(YEAR))}
                </h3>
              </div>
              <InquiryYearNumbers summary={year.summary} year={YEAR} index={2} />
              <InquiryYearStrip
                days={year.days}
                months={year.months}
                index={6}
                onSelectVisit={selectVisit}
              />

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="space-y-4 xl:col-start-3 xl:row-start-1">
                  <section className={cn(INQUIRY_SURFACE, 'inq-rise space-y-2 p-4')} style={inquiryRise(6)}>
                    <InquiryCardTitle icon={<Tag size={14} />}>{t('inquiryFacts')}</InquiryCardTitle>
                    <InfoGrid items={facts} columns={1} />
                  </section>
                  {insideProject && (
                    <InquiryPoCard
                      po={variant === 'site' ? { id: 'sample-po', number: 'SPO260046' } : null}
                      index={7}
                    />
                  )}
                  <section className={cn(INQUIRY_SURFACE, 'p-4 text-sm text-muted')}>
                    <span className="flex items-center gap-2">
                      <Building2 size={14} aria-hidden="true" />
                      «الموقع الحالي» للمسؤول من افاقي، ولا يظهر في العينة.
                    </span>
                  </section>
                </div>
                <div className="xl:col-span-2 xl:col-start-1 xl:row-start-1">
                  <InquiryJourney
                    visits={visits}
                    now={NOW}
                    index={7}
                    highlightedKey={highlightedKey}
                    // The sample's movements have no pages to open.
                    onSelectMovement={() => undefined}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
