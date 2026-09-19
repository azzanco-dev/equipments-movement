import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
} from '@/components/ui'
import {
  EquipmentSuggestSearch,
  type EquipmentSuggestion,
} from '@/components/inquiry/EquipmentSuggestSearch'
import { EquipmentTimeline } from '@/components/inquiry/EquipmentTimeline'
import type {
  EquipmentPresence,
  MovementContext,
  TimelineMovement,
  WorkshopPurpose,
} from '@/lib/visitTimeline'

// Review of the EQUIPMENT INQUIRY idea on /ui-kit. Everything below is sample
// data: one search field suggests equipment as the product owner types, they
// pick exactly one, and the page shows that equipment's history as a timeline.
// A real screen keeps the same components and swaps this local filtering for a
// server-side RPC.

type DemoLang = 'ar' | 'en'
type Bilingual = Record<DemoLang, string>

type DemoEquipment = {
  id: string
  code: string
  type: Bilingual
  plate: string
  chassis: string
  state: EquipmentPresence
}

const DEMO_EQUIPMENT: DemoEquipment[] = [
  {
    id: 'e1',
    code: 'A120',
    type: { ar: 'حفار', en: 'Excavator' },
    plate: '1234-ABJ',
    chassis: 'JCB4820JX1120',
    state: 'outside',
  },
  {
    id: 'e2',
    code: 'A311',
    type: { ar: 'شيول', en: 'Loader' },
    plate: '6640-KLM',
    chassis: 'CAT950HX3311',
    state: 'outside',
  },
  {
    id: 'e3',
    code: 'A905',
    type: { ar: 'كومبريسر', en: 'Compressor' },
    plate: '9933-TTK',
    chassis: 'ATL7820CX0905',
    state: 'inside_workshop',
  },
  {
    id: 'e4',
    code: 'TK208',
    type: { ar: 'رافعة شوكية', en: 'Forklift' },
    plate: '5521-RSA',
    chassis: 'TOY8FD25T0208',
    state: 'inside_site',
  },
  {
    id: 'e5',
    code: 'TK140',
    type: { ar: 'ونش', en: 'Boom truck' },
    plate: '4501-SQR',
    chassis: 'HIN700BT10140',
    state: 'outside',
  },
  {
    id: 'e6',
    code: 'F77',
    type: { ar: 'قلاب', en: 'Dump truck' },
    plate: '8810-DHW',
    chassis: 'MER3340DT0077',
    state: 'inside_site',
  },
  {
    id: 'e7',
    code: 'F412',
    type: { ar: 'صهريج ماء', en: 'Water tanker' },
    plate: '2277-NHY',
    chassis: 'ISU6200WT0412',
    state: 'outside',
  },
  {
    id: 'e8',
    code: 'B19',
    type: { ar: 'بوكلين', en: 'Backhoe' },
    plate: '3092-ZHT',
    chassis: 'JCB3CX19B019',
    state: 'inside_workshop',
  },
  {
    id: 'e9',
    code: 'B240',
    type: { ar: 'بلدوزر', en: 'Bulldozer' },
    plate: '7712-GHF',
    chassis: 'CATD6R24B240',
    state: 'outside',
  },
  {
    id: 'e10',
    code: 'U001',
    type: { ar: 'مولد كهرباء', en: 'Generator' },
    plate: '1180-QWE',
    chassis: 'PRK500GN0001',
    state: 'outside',
  },
  {
    id: 'e11',
    code: 'U002',
    type: { ar: 'خلاطة خرسانة', en: 'Concrete mixer' },
    plate: '4408-MNB',
    chassis: 'SCH9M3CM0002',
    state: 'inside_site',
  },
  {
    id: 'e12',
    code: 'A742',
    type: { ar: 'جريدر', en: 'Grader' },
    plate: '5150-YUI',
    chassis: 'CAT140KGR0742',
    state: 'outside',
  },
]

/** A120 is the one equipment with a full demo history; every other code
 * (A742 and the rest) falls through to the "no history" empty state. */
const HISTORY_EQUIPMENT_ID = 'e1'

const COMPANIES: Bilingual[] = [
  { ar: 'شركة تكوين', en: 'Takween' },
  { ar: 'شركة العزاني', en: 'Al-Azani' },
  { ar: 'مقاولات الخليج', en: 'Gulf Contracting' },
]

const PROJECTS: Bilingual[] = [
  { ar: 'مشروع الرياض الشمالي', en: 'Riyadh North' },
  { ar: 'طريق الدمام السريع', en: 'Dammam Expressway' },
  { ar: 'توسعة ميناء جدة', en: 'Jeddah Port Expansion' },
]

const FOREMEN: Bilingual[] = [
  { ar: 'سعد القحطاني', en: 'Saad Al-Qahtani' },
  { ar: 'ماجد العتيبي', en: 'Majed Al-Otaibi' },
  { ar: 'طارق الشمري', en: 'Tareq Al-Shammari' },
]

const DRIVERS: Bilingual[] = [
  { ar: 'محمد علي', en: 'Mohammed Ali' },
  { ar: 'حسن ابراهيم', en: 'Hassan Ibrahim' },
  { ar: 'يوسف الدوسري', en: 'Youssef Al-Dosari' },
  { ar: 'عمر صالح', en: 'Omar Saleh' },
]

/**
 * A visit script instead of 40 hand-written rows: each line is one visit, so
 * the demo history stays readable and every timeline case is explicit.
 * `days: null` leaves the visit open; `entry: false` is the legacy lone exit.
 */
type VisitScript = {
  /** Day offset from the fixed demo "today", counting backwards. */
  startsDaysAgo: number
  days: number | null
  context: MovementContext
  purpose?: WorkshopPurpose
  /** Index into COMPANIES / PROJECTS / FOREMEN / DRIVERS. */
  pick?: number
  /** A driver change during the visit shows a different name on the exit. */
  exitDriver?: number
  entry?: false
  photos?: number
}

// Eight months of history, newest last: 18 visits -> about 35 movements.
const VISIT_SCRIPT: VisitScript[] = [
  // A lone legacy exit with no entry: `days: 0` puts it at `startsDaysAgo`
  // itself (there is no start to count the duration from).
  { startsDaysAgo: 238, days: 0, context: 'site', entry: false, photos: 2 },
  { startsDaysAgo: 232, days: 14, context: 'site', pick: 0, photos: 3 },
  {
    startsDaysAgo: 214,
    days: 3,
    context: 'workshop',
    purpose: 'maintenance',
    photos: 2,
  },
  {
    startsDaysAgo: 205,
    days: 21,
    context: 'site',
    pick: 1,
    exitDriver: 2,
    photos: 3,
  },
  {
    startsDaysAgo: 179,
    days: 2,
    context: 'workshop',
    purpose: 'parking',
    photos: 1,
  },
  { startsDaysAgo: 172, days: 17, context: 'site', pick: 2, photos: 2 },
  {
    startsDaysAgo: 150,
    days: 6,
    context: 'workshop',
    purpose: 'maintenance',
    photos: 3,
  },
  { startsDaysAgo: 138, days: 25, context: 'site', pick: 0, photos: 2 },
  {
    startsDaysAgo: 108,
    days: 4,
    context: 'workshop',
    purpose: 'parking',
    photos: 1,
  },
  {
    startsDaysAgo: 99,
    days: 19,
    context: 'site',
    pick: 1,
    exitDriver: 3,
    photos: 3,
  },
  {
    startsDaysAgo: 76,
    days: 8,
    context: 'workshop',
    purpose: 'maintenance',
    photos: 2,
  },
  { startsDaysAgo: 63, days: 12, context: 'site', pick: 2, photos: 3 },
  {
    startsDaysAgo: 46,
    days: 2,
    context: 'workshop',
    purpose: 'parking',
    photos: 1,
  },
  { startsDaysAgo: 40, days: 9, context: 'site', pick: 0, photos: 2 },
  {
    startsDaysAgo: 27,
    days: 5,
    context: 'workshop',
    purpose: 'maintenance',
    photos: 3,
  },
  // Exits 10 days ago, and the workshop entry right below starts the very
  // next day: an immediate transition, so no outside-gap segment shows here.
  { startsDaysAgo: 18, days: 8, context: 'site', pick: 1, photos: 2 },
  {
    startsDaysAgo: 9,
    days: 3,
    context: 'workshop',
    purpose: 'parking',
    photos: 2,
  },
  // Closed (not open) so the equipment reads as currently outside, which
  // produces the trailing open-ended gap from this exit through today.
  { startsDaysAgo: 4, days: 2, context: 'site', pick: 2, photos: 3 },
]

// A fixed instant keeps the preview stable between renders and languages.
const DEMO_NOW = new Date('2026-09-19T09:30:00+03:00').getTime()
const DAY_MS = 24 * 60 * 60 * 1000

function at(daysAgo: number, hour: number): string {
  const day = new Date(DEMO_NOW - daysAgo * DAY_MS)
  day.setHours(hour, daysAgo % 60, 0, 0)
  return day.toISOString()
}

function buildDemoMovements(lang: DemoLang): TimelineMovement[] {
  const movements: TimelineMovement[] = []
  VISIT_SCRIPT.forEach((visit, index) => {
    const site = visit.context === 'site'
    const pick = visit.pick ?? 0
    const company = site ? COMPANIES[pick % COMPANIES.length][lang] : null
    const project = site ? PROJECTS[pick % PROJECTS.length][lang] : null
    const foreman = site ? FOREMEN[pick % FOREMEN.length][lang] : null
    const driver = site ? DRIVERS[pick % DRIVERS.length][lang] : null
    const photos = visit.photos ?? 0

    if (visit.entry !== false)
      movements.push({
        id: `mv-${index}-in`,
        movement_context: visit.context,
        movement_type: 'entry',
        recorded_at: at(visit.startsDaysAgo, 7),
        company_name: company,
        project_name: project,
        workshop_purpose: site ? null : (visit.purpose ?? 'maintenance'),
        supervisor_name: foreman,
        driver_name: driver,
        photo_count: photos,
      })

    if (visit.days !== null)
      movements.push({
        id: `mv-${index}-out`,
        movement_context: visit.context,
        movement_type: 'exit',
        recorded_at: at(visit.startsDaysAgo - visit.days, 16),
        company_name: company,
        project_name: project,
        workshop_purpose: null,
        supervisor_name: foreman,
        // EXIT carries the latest driver after an auditable change.
        driver_name:
          site && visit.exitDriver !== undefined
            ? DRIVERS[visit.exitDriver % DRIVERS.length][lang]
            : driver,
        photo_count: Math.max(0, photos - 1),
      })
  })
  return movements
}

function toSuggestion(
  equipment: DemoEquipment,
  lang: DemoLang,
): EquipmentSuggestion {
  return {
    id: equipment.id,
    code: equipment.code,
    type_name: equipment.type[lang],
    plate_number: equipment.plate,
    chassis_number: equipment.chassis,
    state: equipment.state,
  }
}

function matches(equipment: DemoEquipment, query: string, lang: DemoLang) {
  const term = query.trim().toLowerCase()
  if (!term) return false
  return [
    equipment.code,
    equipment.plate,
    equipment.chassis,
    equipment.type[lang],
  ].some((field) => field.toLowerCase().includes(term))
}

const COPY = {
  ar: {
    title: 'استعلام معدة',
    lead: 'حقل بحث واحد: اكتب كود المعدة او اللوحة او الشاصي او النوع، اختر معدة واحدة، ويظهر تاريخها كاملا كخط زمني.',
    picked: 'المعدة المختارة',
    change: 'تغيير المعدة',
    empty: 'ابدا بالبحث عن معدة',
    emptyDesc: 'اكتب حرفين على الاقل لعرض الاقتراحات، مثل A120 او 1234.',
    tryIt: 'جرب: A120 (تاريخ كامل) او A742 (بدون حركات)',
    statesTitle: 'الحالات الاخرى',
    loadingLabel: 'اثناء تحميل الاقتراحات',
    errorLabel: 'عند فشل تحميل التاريخ',
    noHistoryLabel: 'معدة بدون حركات',
  },
  en: {
    title: 'Equipment inquiry',
    lead: 'One search field: type a code, plate, chassis, or type, pick a single equipment, and its full history opens as a timeline.',
    picked: 'Selected equipment',
    change: 'Change equipment',
    empty: 'Start by searching for equipment',
    emptyDesc:
      'Type at least two characters to see suggestions, e.g. A120 or 1234.',
    tryIt: 'Try: A120 (full history) or A742 (no movements)',
    statesTitle: 'Other states',
    loadingLabel: 'While suggestions load',
    errorLabel: 'When the history fails to load',
    noHistoryLabel: 'Equipment with no movements',
  },
} satisfies Record<DemoLang, Record<string, string>>

export function EquipmentInquiryShowcase() {
  const [lang, setLang] = useState<DemoLang>('ar')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<EquipmentSuggestion | null>(null)
  const [openedPhoto, setOpenedPhoto] = useState<string | null>(null)

  const copy = COPY[lang]
  const direction = lang === 'ar' ? 'rtl' : 'ltr'

  // Stands in for the debounced RPC a real screen calls.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    if (!query.trim()) {
      setDebounced('')
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      setDebounced(query)
      setLoading(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  const suggestions = useMemo(
    () =>
      DEMO_EQUIPMENT.filter((item) => matches(item, debounced, lang))
        .slice(0, 20)
        .map((item) => toSuggestion(item, lang)),
    [debounced, lang],
  )

  const movements = useMemo(() => {
    if (selected?.id !== HISTORY_EQUIPMENT_ID) return []
    return buildDemoMovements(lang)
  }, [selected, lang])

  const demoMovements = useMemo(() => buildDemoMovements(lang), [lang])

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">استعلام معدة (فكرة للمراجعة)</h3>
          <p className="text-xs text-muted">
            حقل بحث واحد مع اقتراحات، ثم خط زمني لتاريخ المعدة مجمع في زيارات:
            الدخول والخروج المقابل له يظهران كقطعة واحدة. البيانات هنا تجريبية
            فقط، والاقتراح يبحث محليا بتاخير 200 جزء من الثانية بدل استدعاء
            السيرفر.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={lang === 'ar' ? 'primary' : 'outline'}
            onClick={() => setLang('ar')}
          >
            عربي
          </Button>
          <Button
            size="sm"
            variant={lang === 'en' ? 'primary' : 'outline'}
            onClick={() => setLang('en')}
          >
            English
          </Button>
        </div>
      </div>

      <div dir={direction} lang={lang} className="space-y-4">
        <Card className="space-y-4">
          <SectionHeader
            title={copy.title}
            description={copy.lead}
            action={
              selected && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelected(null)
                    setQuery('')
                    setOpenedPhoto(null)
                  }}
                >
                  {copy.change}
                </Button>
              )
            }
          />

          <div className="max-w-xl">
            <EquipmentSuggestSearch
              query={query}
              onQueryChange={setQuery}
              suggestions={suggestions}
              loading={loading}
              selected={selected}
              onPick={(suggestion) => {
                setSelected(suggestion)
                setQuery(suggestion.code)
                setOpenedPhoto(null)
              }}
            />
            <p className="mt-1.5 text-xs text-muted">{copy.tryIt}</p>
          </div>

          {!selected ? (
            <EmptyState
              icon={<Search size={28} aria-hidden="true" />}
              title={copy.empty}
              description={copy.emptyDesc}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="text-muted">{copy.picked}: </span>
                <span className="font-semibold" dir="ltr">
                  {selected.code}
                </span>
                <span className="text-muted">
                  {' · '}
                  {selected.type_name}
                </span>
              </p>
              <EquipmentTimeline
                movements={movements}
                now={DEMO_NOW}
                onOpenPhoto={setOpenedPhoto}
              />
              {openedPhoto && (
                <p className="text-xs text-muted">
                  onOpenPhoto: <span dir="ltr">{openedPhoto}</span>
                </p>
              )}
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted">{copy.statesTitle}</p>
          <div className="grid gap-3 lg:grid-cols-2">
            <Block label={copy.loadingLabel}>
              <div className="max-w-xl">
                <EquipmentSuggestSearch
                  query="A1"
                  onQueryChange={() => {}}
                  suggestions={[]}
                  loading
                  onPick={() => {}}
                />
              </div>
            </Block>
            <Block label={copy.errorLabel}>
              <ErrorState onRetry={() => {}} />
            </Block>
          </div>
          <Block label={copy.noHistoryLabel}>
            <EquipmentTimeline movements={[]} now={DEMO_NOW} />
          </Block>
          <p className="text-xs text-muted" dir={direction}>
            {lang === 'ar'
              ? `مجموع الحركات التجريبية للمعدة A120: ${demoMovements.length} حركة خلال ثمانية اشهر، تشمل فترات خروج بين الزيارات (اطولها 5 ايام واخرها ما زال مفتوحا حتى اليوم)، واعادة دخول في اليوم التالي مباشرة بدون فترة خروج، وخروج قديم بدون دخول مسجل.`
              : `A120 demo history: ${demoMovements.length} movements over eight months, including outside-gap periods between visits (the longest is 5 days, and the latest is still open through today), one next-day re-entry with no gap at all, and one legacy exit with no entry.`}
          </p>
        </div>
      </div>
    </section>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  )
}
