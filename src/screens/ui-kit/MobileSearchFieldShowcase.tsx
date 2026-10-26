import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Field, cn, type FieldControlProps } from '@/components/ui'

// «حقل بحث للجوال» (owner 2026-10-26), step by step. The owner's brief:
//   1. a press on the field opens it and focuses its search box;
//   2. the page scrolls so the field sits near the top and its list under it,
//      in the room down to the keyboard;
//   3. when the user scrolls down and the list starts to be covered, the list
//      shows above the field.
// Steps so far (owner 2026-10-26): no list yet («الغ القائمة الان»); the
// field is a search box, so a press focuses it and the phone's keyboard opens
// natively («الان لما اضغط افتح الكيبورد»); on focus the field moves to 150 px
// from the top of the visible area, and again when the keyboard changes the
// visible height. The readout shows the distances live. Sample page only;
// AsyncSearchSelect and the screens are untouched.

/** The field's distance from the top of the visible area after a press. */
const TOP_OFFSET = 150

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
  const fieldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

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
  const bringToTop = useCallback(() => {
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
  }, [])

  // While the box has the focus: when the keyboard opens (or closes, or
  // changes), the visible height changes, and the field goes back to 150 px
  // in the new visible area. No timers: the event says when.
  useEffect(() => {
    if (!focused) return
    const view = window.visualViewport
    if (!view) return
    let height = Math.round(view.height)
    const onResize = () => {
      const now = Math.round(view.height)
      if (now === height) return
      height = now
      bringToTop()
    }
    view.addEventListener('resize', onResize)
    return () => view.removeEventListener('resize', onResize)
  }, [focused, bringToTop])

  return (
    <div
      ref={fieldRef}
      // A press anywhere on the box focuses the search (its own keyboard).
      onPointerDown={(event) => {
        if (event.target !== inputRef.current) {
          event.preventDefault()
          inputRef.current?.focus()
        }
      }}
      className={cn(
        'flex h-10 w-full cursor-text items-center gap-2 rounded-lg border bg-bg px-3 transition-colors md:h-9',
        focused && 'border-fg',
      )}
    >
      <Search size={15} aria-hidden="true" className="shrink-0 text-muted" />
      <input
        ref={inputRef}
        id={control?.id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-describedby={control?.['aria-describedby']}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          setFocused(true)
          bringToTop()
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') inputRef.current?.blur()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted md:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="shrink-0 text-muted"
      />
    </div>
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
        الخطوة الحالية: الضغط على الحقل يفتح الكيبورد ويرفع الحقل الى 150 بكسل
        من اعلى الشاشة، ويعيده اليها اذا تغير مكان الكيبورد. بلا قائمة.
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
