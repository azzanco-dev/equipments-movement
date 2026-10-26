import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Field, type FieldControlProps } from '@/components/ui'

// «حقل بحث للجوال» (owner 2026-10-26), step by step. The owner's brief:
//   1. a press on the field opens it and focuses its search box;
//   2. the page scrolls so the field sits near the top and its list under it,
//      in the room down to the keyboard;
//   3. when the user scrolls down and the list starts to be covered, the list
//      shows above the field.
// Step now (owner: «الغ القائمة الان»): the press only moves the field to
// 100 px from the top of the visible area — no list. The readout shows the
// distances live. Sample page only; AsyncSearchSelect and the screens are
// untouched.

/** The field's distance from the top of the visible area after a press. */
const TOP_OFFSET = 100

type Metrics = { top: number; bottom: number }

/** The visible area in the coordinates getBoundingClientRect uses. */
function visibleArea() {
  const view = window.visualViewport
  const top = view?.offsetTop ?? 0
  return { top, bottom: top + (view?.height ?? window.innerHeight) }
}

function PressToTopField({
  control,
  placeholder,
  onMetrics,
}: {
  control?: FieldControlProps
  placeholder: string
  onMetrics: (metrics: Metrics) => void
}) {
  const fieldRef = useRef<HTMLButtonElement>(null)

  // The readout follows every scroll and every change of the visible area
  // (the keyboard), in the event itself.
  useEffect(() => {
    const update = () => {
      const field = fieldRef.current
      if (!field) return
      const rect = field.getBoundingClientRect()
      const area = visibleArea()
      onMetrics({
        top: Math.round(rect.top - area.top),
        bottom: Math.round(area.bottom - rect.bottom),
      })
    }
    update()
    const view = window.visualViewport
    view?.addEventListener('resize', update)
    view?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, { capture: true, passive: true })
    return () => {
      view?.removeEventListener('resize', update)
      view?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, { capture: true })
    }
  }, [onMetrics])

  /** The browser does the arithmetic of the visible area itself. */
  const bringToTop = () => {
    const field = fieldRef.current
    if (!field) return
    field.style.scrollMarginTop = `${TOP_OFFSET}px`
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    field.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  return (
    <button
      ref={fieldRef}
      id={control?.id}
      type="button"
      aria-describedby={control?.['aria-describedby']}
      onClick={bringToTop}
      className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-bg px-3 text-base outline-none transition-colors focus-visible:border-fg md:h-9 md:text-sm"
    >
      <span className="min-w-0 truncate text-muted">{placeholder}</span>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="shrink-0 text-muted"
      />
    </button>
  )
}

function Readout({ metrics }: { metrics: Metrics | null }) {
  const rows: [string, number | undefined][] = [
    ['المسافة بين الحقل واعلى الشاشة', metrics?.top],
    ['المسافة بين الحقل واسفل الشاشة او الكيبورد', metrics?.bottom],
  ]
  return (
    <div className="mb-2 grid gap-1 rounded-lg border bg-surface px-3 py-2 text-xs text-muted">
      {rows.map(([label, number]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <span>{label}</span>
          <bdi className="font-medium text-fg">
            {number === undefined ? '—' : `${number}px`}
          </bdi>
        </div>
      ))}
    </div>
  )
}

export function MobileSearchFieldShowcase() {
  const [first, setFirst] = useState<Metrics | null>(null)
  const [second, setSecond] = useState<Metrics | null>(null)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        الخطوة الحالية: الضغط على الحقل يرفعه الى 100 بكسل من اعلى الشاشة، بلا
        قائمة.
      </p>

      <div className="flex min-h-[70vh] flex-col justify-center">
        <div className="mx-auto w-full max-w-sm">
          <Readout metrics={first} />
          <Field label="المعدة">
            {(control) => (
              <PressToTopField
                control={control}
                placeholder="اختر معدة"
                onMetrics={setFirst}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm">
        <Readout metrics={second} />
        <Field label="السائق">
          {(control) => (
            <PressToTopField
              control={control}
              placeholder="اختر سائقا"
              onMetrics={setSecond}
            />
          )}
        </Field>
      </div>
      {/* Room after the last field, so it too can reach the top. */}
      <div aria-hidden="true" className="h-[70vh]" />
    </div>
  )
}
