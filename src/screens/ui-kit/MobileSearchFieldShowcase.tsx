import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Field, cn, type FieldControlProps } from '@/components/ui'
import { floatingPanel } from '@/components/ui/popover'

// «حقل بحث للجوال» (owner 2026-10-26). After the trials (a forced scroll to
// 100 px, then a list pinned to the screen) jumped on his phone, he pointed
// at shadcn's combobox (Base UI) — smooth, no odd jumps — and chose «نجرب
// طريقتهم». So this field follows Base UI's way:
//   * the search box IS the field: a press focuses it and the phone opens
//     its keyboard;
//   * the lift without jumps (owner 2026-10-26: «حل لرفع الحقل لفوق بدون
//     مشاكل ونقزات»): the jumps came from two movers — the phone scrolls to
//     a newly focused box while our code scrolled too. So on a tap on a
//     phone, a hidden box placed exactly where the field will rest (100 px
//     from the top) takes the focus in the tap: the keyboard opens and, the
//     focused box being already in view high up, the phone does not scroll.
//     One smooth scroll of ours brings the field to that place; when it has
//     stopped, the focus moves to the field (the keyboard stays open, what
//     was typed meanwhile is carried over). With a mouse, or a field
//     already high, the field just takes the focus;
//   * the list hangs from the field in the layout (`position: absolute`,
//     `top: 100%` of a box around the field, 2 px gap): it is always right
//     under the field and moves with the page natively; its place is never
//     measured (in page coordinates it landed far below on his phone);
//   * its height is the room left down to the keyboard (max 320), and it
//     flips above the field when the room below is short and above is
//     larger (Base UI's collision avoidance); both are re-read when the page
//     scrolls or the keyboard changes the visible area.
// Sample page only; AsyncSearchSelect and the screens are untouched.

/** Between the field and its list. */
const EDGE = 2
/** The list stays this far from the keyboard (or the screen's edge). */
const SCREEN_GAP = 8
const LIST_MAX = 320
/** The list never gets shorter than this, even with little room. */
const LIST_MIN = 120
/** Below this much room under the field, the list may open above it. */
const FLIP_BELOW = 160
/** Where the field rests after a tap on a phone: this far from the top of
 *  the visible area. */
const LIFT_TO = 100
/** A touch that moved more than this is a scroll, not a tap. */
const TAP_SLOP = 10

let proxy: HTMLInputElement | null = null

/** The hidden box that holds the focus (and the keyboard) while the field
 *  is on its way up. Focusable, so neither hidden nor display: none. */
function focusProxy() {
  if (!proxy) {
    proxy = document.createElement('input')
    proxy.type = 'text'
    proxy.tabIndex = -1
    proxy.setAttribute('aria-hidden', 'true')
    proxy.autocomplete = 'off'
    proxy.style.cssText =
      'position:fixed;opacity:0;font-size:16px;caret-color:transparent;' +
      'border:0;padding:0;margin:0;pointer-events:none;top:-100px;left:0;width:1px;height:1px'
    document.body.appendChild(proxy)
  }
  return proxy
}

function isPhone() {
  return window.matchMedia('(max-width: 767px)').matches
}

type Metrics = {
  top: number
  bottom: number
  list: string | null
  rectTop: number
  fixedTop: number
  viewTop: number
  viewHeight: number
  scrollY: number
}

let probe: HTMLDivElement | null = null

/**
 * The visible area in getBoundingClientRect's coordinates, whatever a phone
 * measures from (owner 2026-10-26: on his phone rect.top counts from the
 * visible area). A `position: fixed` probe at top 0 marks the layout
 * viewport's top in those coordinates; the visible area starts offsetTop
 * below it.
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
  const offset = view?.offsetTop ?? 0
  const height = view?.height ?? window.innerHeight
  const top = fixedTop + offset
  return { fixedTop, offset, height, top, bottom: top + height }
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

type ListBox = {
  side: 'below' | 'above'
  maxHeight: number
}

function SearchField({
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
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const touchStart = useRef<{ x: number; y: number } | null>(null)

  /** A tap on a phone: the hidden box takes the focus where the field will
   *  rest, our one scroll brings the field there, then the field takes the
   *  focus back. */
  const liftAndFocus = useCallback(() => {
    const field = fieldRef.current
    const input = inputRef.current
    if (!field || !input) return
    const rect = field.getBoundingClientRect()
    const area = geometry()
    const holder = focusProxy()
    // `position: fixed` counts from the layout viewport's top; the visible
    // area starts offsetTop below it.
    holder.style.top = `${area.offset + LIFT_TO}px`
    holder.style.left = `${rect.left}px`
    holder.style.width = `${rect.width}px`
    holder.style.height = `${rect.height}px`
    holder.value = ''
    holder.focus({ preventScroll: true })
    setOpen(true)

    field.style.scrollMarginTop = `${LIFT_TO}px`
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    field.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })

    // The field has arrived when it has not moved for three frames (or after
    // a second at most); then it takes the focus, with what was typed.
    let last = Number.NaN
    let still = 0
    const started = performance.now()
    const settle = () => {
      const top = field.getBoundingClientRect().top
      still = Math.abs(top - last) < 0.5 ? still + 1 : 0
      last = top
      if (still < 3 && performance.now() - started < 1000) {
        window.requestAnimationFrame(settle)
        return
      }
      if (document.activeElement !== holder) return
      if (holder.value) setQuery(holder.value)
      input.focus({ preventScroll: true })
      holder.value = ''
      holder.style.top = '-100px'
    }
    window.requestAnimationFrame(settle)
  }, [])

  /** Closes the list and puts the keyboard away. */
  const close = useCallback(() => {
    setOpen(false)
    inputRef.current?.blur()
  }, [])

  // The list is not tied to the keyboard (owner 2026-10-26: on the iPhone
  // the keyboard's «تم» hid it): it closes on a press outside the field and
  // its list, on a choice, or on Escape — not when the search loses focus.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, close])
  const [box, setBox] = useState<ListBox | null>(null)

  /** Where the list hangs and how tall it may be, from the room left between
   *  the field and the keyboard (or the screen's edges). */
  const place = useCallback(() => {
    const field = fieldRef.current
    if (!field) return
    const rect = field.getBoundingClientRect()
    const area = geometry()
    const below = area.bottom - rect.bottom - EDGE - SCREEN_GAP
    const above = rect.top - area.top - EDGE - SCREEN_GAP
    const side = below < FLIP_BELOW && above > below ? 'above' : 'below'
    const next: ListBox = {
      side,
      maxHeight: Math.max(
        LIST_MIN,
        Math.min(LIST_MAX, side === 'below' ? below : above),
      ),
    }
    setBox((prev) =>
      prev &&
      prev.side === next.side &&
      Math.abs(prev.maxHeight - next.maxHeight) < 0.5
        ? prev
        : next,
    )
  }, [])

  // While open, the side and the height are re-read on every page scroll
  // and every change of the visible area (the keyboard). The list's place
  // is never measured: it hangs from the field in the layout.
  useLayoutEffect(() => {
    if (!open) return
    place()
    const view = window.visualViewport
    view?.addEventListener('resize', place)
    view?.addEventListener('scroll', place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, { capture: true, passive: true })
    return () => {
      view?.removeEventListener('resize', place)
      view?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, { capture: true })
    }
  }, [open, place])

  // The readout, live on every scroll and visible-area change.
  useEffect(() => {
    const update = () => {
      const field = fieldRef.current
      if (!field) return
      const rect = field.getBoundingClientRect()
      const area = geometry()
      onMetrics({
        top: Math.round(rect.top - area.top),
        bottom: Math.round(area.bottom - rect.bottom),
        list:
          open && box
            ? `${Math.round(box.maxHeight)}px ${box.side === 'below' ? 'تحت' : 'فوق'}`
            : null,
        rectTop: Math.round(rect.top),
        fixedTop: Math.round(area.fixedTop),
        viewTop: Math.round(area.offset),
        viewHeight: Math.round(area.height),
        scrollY: Math.round(window.scrollY),
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
  }, [onMetrics, open, box])

  const q = query.trim().toLowerCase()
  const results = q
    ? SAMPLE.filter((option) => option.label.toLowerCase().includes(q))
    : SAMPLE

  return (
    // The list hangs from this box (owner 2026-10-26: measured in page
    // coordinates it landed far below the field on his phone).
    <div ref={wrapRef} className="relative">
      <div
        ref={fieldRef}
        // A press anywhere on the box focuses the search (its own keyboard).
        onPointerDown={(event) => {
          if (event.pointerType === 'touch') return
          if (event.target !== inputRef.current) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
        // A tap on a phone: lifted without the phone's own scroll (see
        // liftAndFocus). A touch that moved is a scroll and is left alone;
        // a field already high, or already focused, just takes the focus.
        onTouchStart={(event) => {
          const touch = event.touches[0]
          touchStart.current = touch
            ? { x: touch.clientX, y: touch.clientY }
            : null
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current
          const touch = event.changedTouches[0]
          touchStart.current = null
          if (!start || !touch) return
          if (
            Math.abs(touch.clientX - start.x) > TAP_SLOP ||
            Math.abs(touch.clientY - start.y) > TAP_SLOP
          )
            return
          if (!isPhone() || document.activeElement === inputRef.current) return
          const field = fieldRef.current
          if (!field) return
          event.preventDefault()
          const distance = field.getBoundingClientRect().top - geometry().top
          if (distance > LIFT_TO + 8) liftAndFocus()
          else inputRef.current?.focus()
        }}
        className={cn(
          'flex h-10 w-full cursor-text items-center gap-2 rounded-lg border bg-bg px-3 transition-colors md:h-9',
          open && 'border-fg',
        )}
      >
        <Search size={15} aria-hidden="true" className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          id={control?.id}
          type="search"
          role="combobox"
          enterKeyHint="search"
          autoComplete="off"
          aria-describedby={control?.['aria-describedby']}
          aria-expanded={open}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          // The keyboard's «تم» / «Done» blurs with nothing after it: the list
          // stays. Focus moving to another control (Tab) closes it.
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null
            if (next && !wrapRef.current?.contains(next)) setOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close()
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>
      {open && box && (
        <div
          role="listbox"
          // The search keeps the focus (and the keyboard stays) while the
          // list is pressed or scrolled.
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            floatingPanel,
            'absolute inset-x-0 flex flex-col !p-0',
            box.side === 'below' ? 'top-full' : 'bottom-full',
          )}
          style={{
            maxHeight: box.maxHeight,
            [box.side === 'below' ? 'marginTop' : 'marginBottom']: EDGE,
          }}
        >
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
                    close()
                  }}
                  className="block w-full px-3.5 py-2.5 text-start text-sm hover:bg-surface-hover"
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Readout({ metrics }: { metrics: Metrics | null }) {
  const rows: [string, string | undefined][] = [
    [
      'المسافة بين الحقل واعلى الشاشة',
      metrics ? `${metrics.top}px` : undefined,
    ],
    [
      'المسافة بين الحقل والكيبورد',
      metrics ? `${metrics.bottom}px` : undefined,
    ],
    ['القائمة', metrics?.list ?? undefined],
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
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <span>{label}</span>
          <bdi className="font-medium text-fg">{value ?? '—'}</bdi>
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
        الضغط يفتح الكيبورد فورا، ويرفع الحقل الى 100 بكسل من اعلى الشاشة بحركة
        واحدة منا فقط (الجوال لا يحرك الصفحة)، والقائمة تحته حتى الكيبورد، وتبقى
        مع «تم».
      </p>

      <div className="flex min-h-[70vh] flex-col justify-center">
        <div className="mx-auto w-full max-w-sm">
          <Field label="المعدة">
            {(control) => (
              <SearchField
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
            <SearchField
              control={control}
              placeholder="اختر سائقا"
              onMetrics={setSecond}
            />
          )}
        </Field>
        <Readout metrics={second} />
      </div>
      {/* Room after the last field, so the phone can lift it too. */}
      <div aria-hidden="true" className="h-[70vh]" />
    </div>
  )
}
