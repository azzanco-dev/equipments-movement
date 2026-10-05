import { useMemo, useState } from 'react'
import { Button } from '@/components/ui'
import { ProjectsMap } from '@/components/map/ProjectsMap'
import type { ProjectsMapPoint, ProjectsMapUnplaced } from '@/lib/projectsMap'

// Review of the PROJECTS MAP idea on /ui-kit. Sample data only: approximate
// real coordinates around Riyadh and made-up counts. A real screen keeps the
// same component and feeds it the units currently inside each project.

const DEMO_POINTS: ProjectsMapPoint[] = [
  {
    id: 'qiddiya',
    name: 'القدية',
    lat: 24.585,
    lng: 46.33,
    count: 41,
    kind: 'project',
  },
  {
    id: 'diriyah',
    name: 'الدرعية',
    lat: 24.737,
    lng: 46.575,
    count: 24,
    kind: 'project',
  },
  {
    id: 'murabba',
    name: 'المربع الجديد',
    lat: 24.8,
    lng: 46.6,
    count: 18,
    kind: 'project',
  },
  {
    id: 'park',
    name: 'حديقة الملك سلمان',
    lat: 24.73,
    lng: 46.72,
    count: 15,
    kind: 'project',
  },
  {
    id: 'thumamah',
    name: 'الثمامة',
    lat: 24.95,
    lng: 46.83,
    count: 12,
    kind: 'project',
  },
  {
    id: 'airport',
    name: 'مطار الملك سلمان',
    lat: 24.957,
    lng: 46.7,
    count: 9,
    kind: 'project',
  },
  {
    id: 'janadriyah',
    name: 'الجنادرية',
    lat: 24.87,
    lng: 46.97,
    count: 6,
    kind: 'project',
  },
  {
    id: 'workshop',
    name: 'الورشة',
    lat: 24.56,
    lng: 46.8,
    count: 7,
    kind: 'workshop',
  },
]

const DEMO_UNPLACED: ProjectsMapUnplaced[] = [
  { id: 'kharj-road', name: 'مشروع طريق الخرج', count: 5 },
  { id: 'malqa', name: 'مشروع حي الملقا', count: 3 },
]

// Stable empty arrays, so switching scenarios is the only thing that makes
// the map rebuild its markers.
const NO_POINTS: ProjectsMapPoint[] = []
const NO_UNPLACED: ProjectsMapUnplaced[] = []

type Scenario = 'demo' | 'unplaced-only' | 'empty'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'demo', label: 'بيانات تجريبية' },
  { id: 'unplaced-only', label: 'مشاريع بدون موقع فقط' },
  { id: 'empty', label: 'لا توجد معدات' },
]

export function ProjectsMapShowcase() {
  const [scenario, setScenario] = useState<Scenario>('demo')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const points = scenario === 'demo' ? DEMO_POINTS : NO_POINTS
  const unplaced = scenario === 'empty' ? NO_UNPLACED : DEMO_UNPLACED

  const selected = useMemo(() => {
    if (!selectedId) return null
    const point = points.find((item) => item.id === selectedId)
    if (point) return { name: point.name, count: point.count, kind: point.kind }
    const row = unplaced.find((item) => item.id === selectedId)
    return row
      ? { name: row.name, count: row.count, kind: 'unplaced' as const }
      : null
  }, [points, unplaced, selectedId])

  const kindLabel = {
    project: 'مشروع',
    workshop: 'الورشة',
    unplaced: 'مشروع بدون موقع',
  } as const

  return (
    <section aria-labelledby="projects-map-title" className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="projects-map-title" className="font-semibold">
            خريطة المشاريع (نموذج)
          </h3>
          <p className="text-xs text-muted">
            خريطة حقيقية للرياض بشوارعها، وعلى كل مشروع دائرة بعدد المعدات
            الموجودة داخله الان. البيانات هنا تجريبية والمواقع تقريبية. اضغط على
            دائرة لاختيارها.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={scenario === item.id ? 'primary' : 'outline'}
              onClick={() => {
                setScenario(item.id)
                setSelectedId(null)
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <ProjectsMap
        points={points}
        unplaced={unplaced}
        selectedId={selectedId}
        onSelect={(id) =>
          setSelectedId((current) => (current === id ? null : id))
        }
      />

      <p
        aria-live="polite"
        className="rounded-lg border bg-surface px-3 py-2 text-sm"
      >
        {selected ? (
          <>
            <span className="font-semibold">{selected.name}</span>
            <span className="text-muted"> · {kindLabel[selected.kind]} · </span>
            <span className="font-semibold">{selected.count}</span>
            <span className="text-muted"> معدة داخله الان (onSelect)</span>
          </>
        ) : (
          <span className="text-muted">
            لم يتم اختيار موقع. اضغط على دائرة او على مشروع بدون موقع.
          </span>
        )}
      </p>
    </section>
  )
}
