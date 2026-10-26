import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search } from 'lucide-react'
import { Field, cn, type FieldControlProps } from '@/components/ui'
import { floatingPanel } from '@/components/ui/popover'

// «حقل بحث للجوال» (owner 2026-10-26), step by step. The owner's brief:
//   1. a press on the field opens it and focuses its search box;
//   2. the page scrolls so the field sits near the top and its list under it,
//      in the room down to the keyboard;
//   3. when the user scrolls down and the list starts to be covered, the list
//      shows above the field.
// Done so far: the field is a search box, so a press focuses it and the
// phone's keyboard opens natively; on focus the field moves to 100 px from
// the top of the visible area, and again when the keyboard changes the
// visible height; the list opens in the slot under the field's resting
// place (2 px), as tall as the room down to the keyboard less 16 px, pinned
// to the screen (a page scroll does not move it). Step 3 comes next. Sample page only;
// AsyncSearchSelect and the screens are untouched.

/** The field's distance from the top of the visible area after a press. */
const TOP_OFFSET = 100
/** Between the field and its list. */
const EDGE = 2
/** The list ends this far above the keyboard: the field-to-keyboard room
 *  less 16 px in all (owner 2026-10-26: room 426 → list about 410). */
const KEYBOARD_GAP = 14
const LIST_MIN = 120

type Metrics = {
  top: number
  bottom: number
  list: number | null
  /** The raw readings behind the distances. */
  rectTop: number
  fixedTop: number
  viewTop: number
  viewHeight: number
  scrollY: number
}

let probe: HTMLDivElement | null = null

/**
 * The visible area in getBoundingClientRect's coordinates, whatever a phone
 * measures from (owner 2026-10-26: on his phone rect.top already counts from
 * the visible area, so subtracting visualViewport.offsetTop again gave a
 * negative distance). A `position: fixed` probe at top 0 marks where the
 * layout viewport's top is in those coordinates — 0 on most browsers, minus
 * the visible area's offset where rects follow the visible area — and the
 * visible area starts offsetTop below it either way.
 */
function geometry() {
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
  }
  const view = window.visualViewport
  const fixedTop = probe.getBoundingClientRect().top
  const top = fixedTop + (view?.offsetTop ?? 0)
  const height = view?.height ?? window.innerHeight
  return {
    fixedTop,
    top,
    bottom: top + height,
    height,
    offset: view?.offsetTop ?? 0,
  }
}

const TYPES = [
  'رافعة شوكية',
  'قلاب',
  'بوبكات',
  'شيول',
  'مان لفت',
  'مولد كهرباء',
  'حفار',
]
const SAMPLE = Array.from({ length: 30 }, (_, index) => ({
  value: `u${index}`,
  label: `${['A', 'TK', 'F', 'B'][index % 4]}${120 + index * 7} — ${TYPES[index % TYPES.length]}`,
}))

type ListBox = { top: number; left: number; width: number; height: number }

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
  const [box, setBox] = useState<ListBox | null>(null)

  /**
   * The list's place, pinned to the SCREEN, not to the page (owner
   * 2026-10-26: «ما ابغى القائمة متفاعلة مع السكرول، خليها ثابتة»): the slot
   * under the field's resting place (100 px from the top of the visible
   * area), down to the keyboard less 16 px. Set on focus and when the
   * keyboard changes the visible area; a scroll of the page never moves it.
   */
  const placeList = useCallback(() => {
    const field = fieldRef.current
    if (!field) return
    const rect = field.getBoundingClientRect()
    const area = geometry()
    const slotTop = TOP_OFFSET + rect.height + EDGE
    const height = Math.max(
      LIST_MIN,
      Math.round(area.height - slotTop - KEYBOARD_GAP),
    )
    // `position: fixed` counts from the layout viewport's top, and the
    // visible area starts offsetTop below it.
    const next: ListBox = {
      top: area.offset + slotTop,
      left: rect.left,
      width: rect.width,
      height,
    }
    setBox((prev) =>
      prev &&
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.left - next.left) < 0.5 &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    )
  }, [])

  /** The readout: the field's place in the visible area, live. */
  const measure = useCallback(() => {
    const field = fieldRef.current
    if (!field) return
    const rect = field.getBoundingClientRect()
    const area = geometry()
    onMetrics({
      top: Math.round(rect.top - area.top),
      bottom: Math.round(area.bottom - rect.bottom),
      list: focused && box ? box.height : null,
      rectTop: Math.round(rect.top),
      fixedTop: Math.round(area.fixedTop),
      viewTop: Math.round(area.offset),
      viewHeight: Math.round(area.height),
      scrollY: Math.round(window.scrollY),
    })
  }, [onMetrics, focused, box])

  // The readout: every scroll and every change of the visible area (the
  // keyboard), in the event itself.
  useEffect(() => {
    measure()
    const view = window.visualViewport
    view?.addEventListener('resize', measure)
    view?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { capture: true, passive: true })
    return () => {
      view?.removeEventListener('resize', measure)
      view?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, { capture: true })
    }
  }, [measure])

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
  // changes), the visible height changes, and the field goes back to 100 px
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
      placeList()
    }
    // The visible area itself may pan over the page (a phone with the
    // keyboard open): the list goes with it, so it stays still on screen.
    const onPan = () => placeList()
    placeList()
    view.addEventListener('resize', onResize)
    view.addEventListener('scroll', onPan)
    return () => {
      view.removeEventListener('resize', onResize)
      view.removeEventListener('scroll', onPan)
    }
  }, [focused, bringToTop, placeList])

  const q = query.trim().toLowerCase()
  const results = q
    ? SAMPLE.filter((option) => option.label.toLowerCase().includes(q))
    : SAMPLE

  return (
    <>
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
          aria-expanded={focused}
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
          className={cn(
            'shrink-0 text-muted transition-transform',
            focused && 'rotate-180',
          )}
        />
      </div>
      {focused &&
        box &&
        createPortal(
          <div
            role="listbox"
            // The search keeps the focus (and the keyboard stays) while the
            // list is pressed or scrolled.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(floatingPanel, 'fixed flex flex-col !p-0')}
            style={{
              top: box.top,
              left: box.left,
              width: box.width,
              height: box.height,
            }}
          >
            <p className="shrink-0 border-b px-3 py-1.5 text-[11px] text-muted">
              ارتفاع القائمة <bdi className="text-fg">{box.height}px</bdi>
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {results.length === 0 ? (
                <p className="px-3 py-5 text-center text-sm text-muted">
                  لا نتائج
                </p>
              ) : (
                results.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setQuery(option.label)
                      inputRef.current?.blur()
                    }}
                    className="block w-full px-3.5 py-2.5 text-start text-sm hover:bg-surface-hover"
                  >
                    {option.label}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function Readout({ metrics }: { metrics: Metrics | null }) {
  const rows: [string, number | null | undefined][] = [
    ['المسافة بين الحقل واعلى الشاشة', metrics?.top],
    ['المسافة بين الحقل والكيبورد', metrics?.bottom],
    ['ارتفاع القائمة', metrics?.list],
  ]
  // The raw readings, to see where a wrong distance comes from.
  const raw: [string, number | undefined][] = [
    ['rect.top', metrics?.rectTop],
    ['fixed.top', metrics?.fixedTop],
    ['visualViewport.offsetTop', metrics?.viewTop],
    ['visualViewport.height', metrics?.viewHeight],
    ['scrollY', metrics?.scrollY],
  ]
  return (
    <div className="mt-2 grid gap-1 rounded-lg border bg-surface px-3 py-2 text-xs text-muted">
      {rows.map(([label, number]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <span>{label}</span>
          <bdi className="font-medium text-fg">
            {number === undefined || number === null ? '—' : `${number}px`}
          </bdi>
        </div>
      ))}
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t pt-1 text-[11px]">
        {raw.map(([label, number]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <bdi dir="ltr">{label}</bdi>
            <bdi className="text-fg">{number ?? '—'}</bdi>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MobileSearchFieldShowcase() {
  const [first, setFirst] = useState<Metrics | null>(null)
  const [second, setSecond] = useState<Metrics | null>(null)

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        الخطوة الحالية: الضغط على الحقل يفتح الكيبورد ويرفع الحقل الى 100 بكسل
        من اعلى الشاشة، والقائمة تحته بارتفاع المسافة الى الكيبورد ناقص 16 بكسل.
        الانتقال فوق الحقل عند التمرير في الخطوة التالية.
      </p>

      <div className="flex min-h-[70vh] flex-col justify-center">
        <div className="mx-auto w-full max-w-sm">
          <Field label="المعدة">
            {(control) => (
              <PressToTopField
                control={control}
                placeholder="اختر معدة"
                onMetrics={setFirst}
              />
            )}
          </Field>
          <Readout metrics={first} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm">
        <Field label="السائق">
          {(control) => (
            <PressToTopField
              control={control}
              placeholder="اختر سائقا"
              onMetrics={setSecond}
            />
          )}
        </Field>
        <Readout metrics={second} />
      </div>
      {/* Room after the last field, so it too can reach the top. */}
      <div aria-hidden="true" className="h-[70vh]" />
    </div>
  )
}
