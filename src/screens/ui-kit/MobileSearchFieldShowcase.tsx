import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import {
  Badge,
  Field,
  cn,
  type BadgeTone,
  type FieldControlProps,
} from '@/components/ui'
import { PopoverContainerContext } from '@/components/ui/FloatingPopover'
import { floatingPanel } from '@/components/ui/popover'

// «حقل بحث للجوال» (owner 2026-10-26): the idea of the /components trials —
// on a phone the field moves near the top of the visible area and its list
// opens UNDER it, never over the field and never under the keyboard — built
// another way, as a floating list that this field places itself:
//   * no rewriting of a positioning library's output (no fight, no jitter):
//     the list is portaled and `position: fixed`, its top is the field's
//     bottom and its height the room down to the keyboard, both read in the
//     same coordinates (getBoundingClientRect and visualViewport), so no
//     calibration;
//   * one field, its own listeners, only while it is open; no timers;
//   * the field is scrolled once on open and once when the keyboard changes
//     the visible height; the list follows each scroll event;
//   * room is made at the end of the page while open, so a field near the
//     bottom can still reach the top.
// Sample data only; nothing here touches AsyncSearchSelect or the screens.

const MOBILE_QUERY = '(max-width: 767px)'
/** The field's distance from the top of the visible area on a phone. */
const TOP_OFFSET = 100
/** The list's height when the room allows it (the trials' value). */
const PANEL_MAX = 270
const PANEL_MIN = 120
/** Between the field and its list. */
const EDGE = 2
/** Between the list and the keyboard (or the screen's bottom). */
const BOTTOM_GAP = 8
const SIDE_GUTTER = 8

export interface SearchOption {
  value: string
  label: string
  description?: string
  badge?: { label: string; tone: BadgeTone }
}

/** The visible area in the layout viewport's coordinates, the ones
 *  getBoundingClientRect and `position: fixed` use. */
function visibleArea() {
  const view = window.visualViewport
  const top = view?.offsetTop ?? 0
  const height = view?.height ?? window.innerHeight
  return { top, bottom: top + height, height }
}

function isPhone() {
  return window.matchMedia(MOBILE_QUERY).matches
}

interface PanelBox {
  top: number
  left: number
  width: number
  maxHeight: number
}

function MobileSearchField({
  control,
  value,
  onChange,
  loadOptions,
  placeholder,
  createLabel,
  onCreate,
  invalid,
  onMetrics,
}: {
  /** From `Field`: the id, the description and the invalid state. */
  control?: FieldControlProps
  value: SearchOption | null
  onChange: (option: SearchOption) => void
  loadOptions: (query: string) => Promise<SearchOption[]>
  placeholder: string
  createLabel?: string
  onCreate?: (query: string) => void
  invalid?: boolean
  /** The test page's readout: field → top, field → keyboard, list height. */
  onMetrics?: (metrics: {
    top: number
    keyboard: number
    panel: number
  }) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const container = useContext(PopoverContainerContext)
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<PanelBox | null>(null)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SearchOption[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const isInvalid = invalid ?? control?.invalid
  /** Focuses the search box once, when the list mounts — inside the press
   *  that opened it, so the phone's keyboard opens. A stable callback, so a
   *  later render never pulls the focus back from the options. */
  const focusSearch = useCallback((element: HTMLInputElement | null) => {
    element?.focus({ preventScroll: true })
  }, [])

  // Server-side search in the real field: first 20, ~300 ms debounce.
  useEffect(() => {
    if (!open) return
    let current = true
    setLoading(true)
    setFailed(false)
    const timer = window.setTimeout(
      async () => {
        try {
          const next = await loadOptions(query.trim())
          if (current) setOptions(next.slice(0, 20))
        } catch {
          if (current) {
            setOptions([])
            setFailed(true)
          }
        } finally {
          if (current) setLoading(false)
        }
      },
      query ? 300 : 0,
    )
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [open, query, loadOptions, retry])

  /** Where the list goes now: under the field, as tall as the room down to
   *  the keyboard allows. On a computer it may open above when there is
   *  more room there; on a phone never (the field is moved instead). */
  const measure = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const area = visibleArea()
    const phone = isPhone()
    const below = area.bottom - (rect.bottom + EDGE) - BOTTOM_GAP
    const above = rect.top - EDGE - area.top - BOTTOM_GAP
    const width = Math.min(
      Math.max(rect.width, 256),
      window.innerWidth - SIDE_GUTTER * 2,
    )
    // Lined up with the field's start (its right edge in Arabic), kept
    // inside the screen.
    const rtl = window.getComputedStyle(trigger).direction === 'rtl'
    const left = Math.min(
      Math.max(rtl ? rect.right - width : rect.left, SIDE_GUTTER),
      window.innerWidth - width - SIDE_GUTTER,
    )
    const maxDesktop = 320
    const openAbove = !phone && below < 200 && above > below
    const room = openAbove ? above : below
    const maxHeight = Math.max(
      PANEL_MIN,
      Math.min(phone ? PANEL_MAX : maxDesktop, room),
    )
    // The list's height at the new limit: the limit itself while its results
    // overflow (they will fill it), else its current height.
    const list = listRef.current
    const overflowing = !list || list.scrollHeight > list.clientHeight + 1
    const panelHeight = overflowing
      ? maxHeight
      : Math.min(maxHeight, panelRef.current?.offsetHeight ?? maxHeight)
    const next: PanelBox = {
      top: openAbove ? rect.top - EDGE - panelHeight : rect.bottom + EDGE,
      left,
      width,
      maxHeight,
    }
    setBox((prev) =>
      prev &&
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.left - next.left) < 0.5 &&
      prev.width === next.width &&
      prev.maxHeight === next.maxHeight
        ? prev
        : next,
    )
    onMetrics?.({
      top: Math.round(rect.top - area.top),
      keyboard: Math.round(area.bottom - rect.bottom),
      panel: Math.round(panelHeight),
    })
  }, [onMetrics])

  /** The field near the top of the visible area (a phone only). The browser
   *  does the arithmetic of the visible area and the keyboard itself. */
  const bringToTop = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger || !isPhone()) return
    const rect = trigger.getBoundingClientRect()
    const area = visibleArea()
    if (Math.abs(rect.top - area.top - TOP_OFFSET) <= 4) return
    trigger.style.scrollMarginTop = `${TOP_OFFSET}px`
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    trigger.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [])

  // While open: follow the field on every scroll / resize of the page or
  // the visible area, right in the event (no frame of lag), and move it to
  // the top again when the keyboard changes the visible height. Scrolling
  // inside the list is ignored. Room at the end of the page lets a low field
  // reach the top.
  useLayoutEffect(() => {
    if (!open) return
    const body = document.body
    const previousPadding = body.style.paddingBottom
    if (isPhone()) body.style.paddingBottom = `${window.innerHeight}px`
    measure()
    bringToTop()
    let height = Math.round(visibleArea().height)
    const schedule = () => {
      const now = Math.round(visibleArea().height)
      if (now !== height) {
        height = now
        bringToTop()
      }
      measure()
    }
    const onScroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        panelRef.current?.contains(event.target)
      )
        return
      schedule()
    }
    const view = window.visualViewport
    view?.addEventListener('resize', schedule)
    view?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    })
    return () => {
      view?.removeEventListener('resize', schedule)
      view?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', onScroll, { capture: true })
      body.style.paddingBottom = previousPadding
    }
  }, [open, measure, bringToTop])

  // The list's content changed (results arrived): its height may shrink.
  useLayoutEffect(() => {
    if (open) measure()
  }, [open, options, loading, failed, measure])

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    setQuery('')
    setBox(null)
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [])

  // A press outside the field and its list closes it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      )
        return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, close])

  const moveFocus = (from: HTMLElement | null, step: 1 | -1) => {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-option]',
      ) ?? [],
    )
    if (!items.length) return
    const at = from ? items.indexOf(from as HTMLButtonElement) : -1
    const next = at < 0 ? (step === 1 ? 0 : items.length - 1) : at + step
    if (next < 0) return
    items[Math.min(next, items.length - 1)]?.focus({ preventScroll: true })
  }

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(
        event.target === event.currentTarget.querySelector('input')
          ? null
          : (event.target as HTMLElement),
        event.key === 'ArrowDown' ? 1 : -1,
      )
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={control?.id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={control?.['aria-describedby']}
        aria-required={control?.['aria-required']}
        aria-invalid={isInvalid || undefined}
        // Opening and focusing the search box happen in this same press, so
        // the phone's keyboard opens at once.
        onClick={() => {
          if (open) {
            close(false)
            return
          }
          // The list's place is known before it renders, so it shows (and
          // its search box can take the focus) in this same press.
          measure()
          setOpen(true)
        }}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-bg px-3 text-base outline-none transition-colors focus-visible:border-fg md:h-9 md:text-sm',
          open && 'border-fg',
        )}
        style={isInvalid ? { borderColor: 'var(--danger)' } : undefined}
      >
        <span className={cn('min-w-0 truncate', !value && 'text-muted')}>
          {value ? value.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            onKeyDown={onPanelKeyDown}
            className={cn(floatingPanel, 'fixed flex flex-col !p-0')}
            style={{
              top: box?.top ?? -9999,
              left: box?.left ?? 0,
              width: box?.width,
              maxHeight: box?.maxHeight ?? PANEL_MAX,
            }}
          >
            <div className="relative shrink-0 border-b">
              <Search
                size={14}
                aria-hidden="true"
                className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                ref={focusSearch}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث برقم المعدة او نوعها"
                className="w-full bg-transparent py-2.5 pe-3 ps-9 text-base outline-none md:text-sm"
              />
            </div>
            <div
              ref={listRef}
              role="listbox"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              {loading ? (
                <p className="flex items-center justify-center gap-2 px-3 py-5 text-sm text-muted">
                  <Loader2
                    size={16}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  جار البحث…
                </p>
              ) : failed ? (
                <div className="space-y-2 px-3 py-4 text-center text-sm text-muted">
                  <p>تعذر تحميل النتائج.</p>
                  <button
                    type="button"
                    className="font-medium text-fg underline"
                    onClick={() => setRetry((count) => count + 1)}
                  >
                    اعادة المحاولة
                  </button>
                </div>
              ) : options.length === 0 ? (
                <p className="px-3 py-5 text-center text-sm text-muted">
                  لا نتائج
                </p>
              ) : (
                options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-option
                    role="option"
                    aria-selected={option.value === value?.value}
                    onClick={() => {
                      onChange(option)
                      close(true)
                    }}
                    className="flex w-full items-start justify-between gap-2 px-3.5 py-2.5 text-start text-sm outline-none hover:bg-surface-hover focus-visible:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'truncate',
                            option.value === value?.value && 'font-semibold',
                          )}
                        >
                          {option.label}
                        </span>
                        {option.badge && (
                          <Badge tone={option.badge.tone} size="sm">
                            {option.badge.label}
                          </Badge>
                        )}
                      </span>
                      {option.description && (
                        <span className="block truncate text-xs text-muted">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {option.value === value?.value && (
                      <Check
                        size={15}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                      />
                    )}
                  </button>
                ))
              )}
            </div>
            {onCreate && createLabel && (
              <button
                type="button"
                className="w-full shrink-0 border-t px-3.5 py-2.5 text-start text-sm font-semibold hover:bg-surface-hover"
                onClick={() => {
                  onCreate(query.trim())
                  close(true)
                }}
              >
                {createLabel}
              </button>
            )}
          </div>,
          container ?? document.body,
        )}
    </>
  )
}

// --- Sample data -------------------------------------------------------------

const TYPES = [
  'رافعة شوكية',
  'قلاب',
  'بوبكات',
  'شيول',
  'مان لفت',
  'مولد كهرباء',
  'ضاغط هواء',
  'حفار',
]
const PROJECTS = [
  'الدرعية · شركة المباني',
  'القدية · مجد الوفاء',
  'طريق الملك خالد · ساليني',
]
const SAMPLE: SearchOption[] = Array.from({ length: 30 }, (_, index) => ({
  value: `u${index}`,
  label: `${['A', 'TK', 'F', 'B'][index % 4]}${120 + index * 7} — ${TYPES[index % TYPES.length]}`,
  description: PROJECTS[index % PROJECTS.length],
  badge:
    index % 5 === 0
      ? { label: 'داخل موقع', tone: 'entry' as const }
      : index % 7 === 0
        ? { label: 'في الورشة', tone: 'warning' as const }
        : undefined,
}))

async function loadSample(query: string): Promise<SearchOption[]> {
  await new Promise((resolve) => window.setTimeout(resolve, 250))
  const q = query.toLowerCase()
  return q
    ? SAMPLE.filter(
        (option) =>
          option.label.toLowerCase().includes(q) ||
          (option.description ?? '').includes(q),
      )
    : SAMPLE
}

function Readout({
  metrics,
}: {
  metrics: { top: number; keyboard: number; panel: number } | null
}) {
  const rows: [string, number | undefined][] = [
    ['المسافة بين الحقل واعلى الشاشة', metrics?.top],
    ['المسافة بين الحقل والكيبورد', metrics?.keyboard],
    ['ارتفاع القائمة', metrics?.panel],
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
  const [first, setFirst] = useState<SearchOption | null>(null)
  const [second, setSecond] = useState<SearchOption | null>(null)
  const [firstMetrics, setFirstMetrics] = useState<{
    top: number
    keyboard: number
    panel: number
  } | null>(null)
  const [secondMetrics, setSecondMetrics] = useState<{
    top: number
    keyboard: number
    panel: number
  } | null>(null)

  return (
    <div className="space-y-6">
      <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
        <li>
          على الجوال: الضغط على الحقل يفتح القائمة والكيبورد معا، ويرفع الحقل
          الى 100 بكسل من اعلى الشاشة.
        </li>
        <li>
          القائمة تحت الحقل دائما بفاصل 2 بكسل، وارتفاعها 270 او المساحة الى
          الكيبورد ايهما اقل. لا تغطي الحقل ولا تنزل تحت الكيبورد.
        </li>
        <li>
          الحقل الثاني اسفل القسم: يرتفع ايضا لان الصفحة تفسح له مكانا وهو
          مفتوح.
        </li>
        <li>على الكمبيوتر: قائمة عادية تحت الحقل، او فوقه اذا ضاق المكان.</li>
      </ul>

      <div className="flex min-h-[70vh] flex-col justify-center">
        <div className="mx-auto w-full max-w-sm">
          <Readout metrics={firstMetrics} />
          <Field label="المعدة" required>
            {(control) => (
              <MobileSearchField
                control={control}
                value={first}
                onChange={setFirst}
                loadOptions={loadSample}
                placeholder="اختر معدة"
                createLabel="اضافة معدة جديدة +"
                onCreate={() => undefined}
                onMetrics={setFirstMetrics}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm pb-4">
        <Readout metrics={secondMetrics} />
        <Field label="السائق" error={second ? undefined : 'السائق مطلوب.'}>
          {(control) => (
            <MobileSearchField
              control={control}
              value={second}
              onChange={setSecond}
              loadOptions={loadSample}
              placeholder="اختر سائقا"
              onMetrics={setSecondMetrics}
            />
          )}
        </Field>
      </div>
    </div>
  )
}
