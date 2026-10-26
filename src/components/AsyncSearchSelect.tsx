import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import type { SelectOption } from '@/lib/selectOption'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { cn } from '@/components/ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/FloatingPopover'
import { floatingPanel } from '@/components/ui/popover'
import { useIsPhone, visibleArea } from '@/lib/visibleArea'

/**
 * `SelectOption` plus an optional secondary line, e.g. a driver's id/mobile
 * number under their name. Purely additive, so existing callers that only
 * pass `{ value, label }` keep working unchanged.
 */
export interface AsyncSearchSelectOption extends SelectOption {
  /** Rendered under the label in muted text (list) — never in the trigger. */
  description?: string
  /**
   * Optional state chip next to the label in the list, e.g. equipment that is
   * currently inside a site. Rendered with the shared `Badge`.
   */
  badge?: { label: string; tone: BadgeTone }
}

/** Plain-text tooltip built from label/description, for truncated text. */
function optionTitle(
  option?: AsyncSearchSelectOption | null,
): string | undefined {
  if (!option) return undefined
  return (
    [option.label, option.description].filter(Boolean).join(' — ') || undefined
  )
}

interface AsyncSearchSelectProps {
  value: string
  selectedOption?: AsyncSearchSelectOption | null
  onChange: (value: string, option: AsyncSearchSelectOption | null) => void
  loadOptions: (query: string) => Promise<AsyncSearchSelectOption[]>
  placeholder?: string
  className?: string
  disabled?: boolean
  createLabel?: string
  onCreate?: (query: string) => void
  alwaysShowCreate?: boolean
  /** Set by `Field`, so a label points at this control. */
  id?: string
  /** Marks the trigger invalid; `Field` sets this automatically. */
  invalid?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean
  /**
   * On a phone (below 768 px), the behaviour the owner approved on /ui-kit
   * «حقل بحث للجوال» (2026-10-26, see AGENTS.md): the search box is the field
   * itself, the page is never scrolled by code (the phone lifts the focused
   * field), and the list hangs 2 px under the field down to the keyboard
   * (above it only when the room below is short), staying open after the
   * keyboard's «تم». Opt-in per screen; first on the movement entry form.
   * Larger screens keep the popover.
   */
  phoneInline?: boolean
}

/** Between the field and its list (phone mode). */
const INLINE_EDGE = 2
/** The list stays this far from the keyboard or the screen's edge. */
const INLINE_SCREEN_GAP = 8
const INLINE_LIST_MAX = 320
const INLINE_LIST_MIN = 120
/** Below this much room under the field, the list may open above it. */
const INLINE_FLIP_BELOW = 160

/**
 * Searchable relational selector: server-side search, first/best 20 results,
 * ~300 ms debounce, no load-more (unified list architecture).
 *
 * The menu is a shared Radix Popover. It used to be a portal placed by a
 * manual `getBoundingClientRect` calculation refreshed on scroll/resize, and
 * focusing the search input scrolled the page under it, so the menu could end
 * up drawn over its own trigger. Radix now anchors it to the trigger, flips it
 * above when there is no room below, keeps it inside the viewport
 * (`avoidCollisions` + `collisionPadding`), and closes it on outside click or
 * Escape with focus returned to the trigger. The search input is focused with
 * `preventScroll`, so opening the menu never moves the page.
 */
export function AsyncSearchSelect({
  value,
  selectedOption,
  onChange,
  loadOptions,
  placeholder = '—',
  className = '',
  disabled = false,
  createLabel,
  onCreate,
  alwaysShowCreate = false,
  id,
  invalid,
  phoneInline = false,
  ...aria
}: AsyncSearchSelectProps) {
  const { t } = useI18n()
  const isPhone = useIsPhone()
  const inline = phoneInline && isPhone
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<AsyncSearchSelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const requestId = ++requestRef.current
    setLoading(true)
    setLoadError(false)
    const timer = window.setTimeout(
      async () => {
        setLoading(true)
        try {
          const next = await loadOptions(query.trim())
          if (requestId === requestRef.current) setOptions(next.slice(0, 20))
        } catch {
          if (requestId === requestRef.current) {
            setOptions([])
            setLoadError(true)
          }
        } finally {
          if (requestId === requestRef.current) setLoading(false)
        }
      },
      query ? 300 : 0,
    )
    return () => {
      window.clearTimeout(timer)
      requestRef.current = requestId + 1
    }
  }, [open, query, loadOptions, retry])

  const showCreateAction = Boolean(
    onCreate && (alwaysShowCreate || query.trim()),
  )

  /** Down/Up walk the option buttons; Down from the search input enters the
   *  list, Up from its first option returns to the search input. */
  const moveFocus = (from: HTMLElement | null, step: 1 | -1) => {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-option="true"]',
      ) ?? [],
    )
    if (!items.length) return
    const current = from ? items.indexOf(from as HTMLButtonElement) : -1
    const next =
      current < 0 ? (step === 1 ? 0 : items.length - 1) : current + step
    if (next < 0) {
      inputRef.current?.focus({ preventScroll: true })
      return
    }
    items[Math.min(next, items.length - 1)]?.focus({ preventScroll: true })
  }

  // --- Phone mode (phoneInline) ------------------------------------------
  const wrapRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const [inlineBox, setInlineBox] = useState<{
    side: 'below' | 'above'
    maxHeight: number
  } | null>(null)

  /** Closes the list and puts the keyboard away. */
  const closeInline = useCallback(() => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }, [])

  /** The list's side and height from the room between the field and the
   *  keyboard; its place is never measured (it hangs from the field). */
  const placeInline = useCallback(() => {
    const field = fieldRef.current
    if (!field) return
    const rect = field.getBoundingClientRect()
    const area = visibleArea()
    const below = area.bottom - rect.bottom - INLINE_EDGE - INLINE_SCREEN_GAP
    const above = rect.top - area.top - INLINE_EDGE - INLINE_SCREEN_GAP
    const side = below < INLINE_FLIP_BELOW && above > below ? 'above' : 'below'
    const maxHeight = Math.max(
      INLINE_LIST_MIN,
      Math.min(INLINE_LIST_MAX, side === 'below' ? below : above),
    )
    setInlineBox((prev) =>
      prev && prev.side === side && Math.abs(prev.maxHeight - maxHeight) < 0.5
        ? prev
        : { side, maxHeight },
    )
  }, [])

  // While open: the side and the height follow every page scroll and every
  // change of the visible area (the keyboard).
  useLayoutEffect(() => {
    if (!inline || !open) return
    placeInline()
    const view = window.visualViewport
    view?.addEventListener('resize', placeInline)
    view?.addEventListener('scroll', placeInline)
    window.addEventListener('resize', placeInline)
    window.addEventListener('scroll', placeInline, {
      capture: true,
      passive: true,
    })
    return () => {
      view?.removeEventListener('resize', placeInline)
      view?.removeEventListener('scroll', placeInline)
      window.removeEventListener('resize', placeInline)
      window.removeEventListener('scroll', placeInline, { capture: true })
    }
  }, [inline, open, placeInline])

  // A press outside the field and its list closes it (not the keyboard's
  // «تم», which only blurs).
  useEffect(() => {
    if (!inline || !open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) closeInline()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true)
  }, [inline, open, closeInline])

  const select = (option: AsyncSearchSelectOption) => {
    onChange(option.value, option)
    if (inline) closeInline()
    else setOpen(false)
  }

  const optionsBody = (
    <div
      ref={listRef}
      className="min-h-0 flex-1 overscroll-contain overflow-y-auto"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        moveFocus(
          event.target as HTMLElement,
          event.key === 'ArrowDown' ? 1 : -1,
        )
      }}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-3 py-5 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" />
          {t('loading')}
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="space-y-2 px-3 py-4 text-center text-sm text-muted"
        >
          <p>{t('optionsLoadError')}</p>
          <button
            type="button"
            className="btn-outline"
            onClick={() => setRetry((current) => current + 1)}
          >
            {t('retry')}
          </button>
        </div>
      ) : options.length === 0 ? (
        <div className="px-3 py-5 text-center text-sm text-muted">
          {t('noResults')}
        </div>
      ) : (
        options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-option="true"
            title={optionTitle(option)}
            onClick={() => select(option)}
            className={`flex w-full items-start justify-between gap-2 px-3.5 py-2 text-start text-sm hover:bg-surface-hover focus-visible:bg-surface-hover ${option.value === value ? 'font-semibold' : ''}`}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="min-w-0 whitespace-normal break-words">
                  {option.label}
                </span>
                {option.badge && (
                  <Badge tone={option.badge.tone} size="sm">
                    {option.badge.label}
                  </Badge>
                )}
              </span>
              {option.description && (
                <span className="min-w-0 truncate-safe text-xs font-normal text-muted">
                  {option.description}
                </span>
              )}
            </span>
            {option.value === value && (
              <Check size={14} className="mt-0.5 shrink-0" />
            )}
          </button>
        ))
      )}
    </div>
  )

  const createAction = showCreateAction && onCreate && (
    <button
      type="button"
      className="w-full shrink-0 border-t px-3.5 py-2 text-start text-sm font-semibold hover:bg-surface-hover"
      onClick={() => {
        onCreate(query.trim())
        if (inline) closeInline()
        else setOpen(false)
      }}
    >
      {createLabel ?? `+ ${query.trim()}`}
    </button>
  )

  if (inline)
    return (
      // The list hangs from this box: always right under (or above) the
      // field, moving with the page natively.
      <div ref={wrapRef} className={cn('relative', className)}>
        <div
          ref={fieldRef}
          // A press anywhere on the box focuses the search (its keyboard).
          onPointerDown={(event) => {
            if (disabled) return
            if (event.target !== inputRef.current) {
              event.preventDefault()
              inputRef.current?.focus()
            }
          }}
          className={cn(
            'flex h-8 w-full cursor-text items-center gap-2 rounded-lg border bg-transparent px-3 transition-colors',
            disabled && 'cursor-not-allowed opacity-60',
          )}
          style={{
            borderColor: invalid
              ? 'var(--danger)'
              : open
                ? 'var(--fg)'
                : 'var(--border)',
          }}
        >
          <input
            ref={inputRef}
            id={id}
            type="search"
            role="combobox"
            enterKeyHint="search"
            autoComplete="off"
            disabled={disabled}
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            {...aria}
            // Closed: the chosen option; open: the search, with the chosen
            // option as its hint.
            value={open ? query : (selectedOption?.label ?? '')}
            title={open ? undefined : optionTitle(selectedOption)}
            placeholder={
              open ? (selectedOption?.label ?? t('searchInList')) : placeholder
            }
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setOpen(true)}
            // The keyboard's «تم» blurs with nothing after it: the list
            // stays. Focus moving to another control closes it.
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null
              if (next && !wrapRef.current?.contains(next)) {
                setOpen(false)
                setQuery('')
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeInline()
              else if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveFocus(null, 1)
              }
            }}
            className="min-w-0 flex-1 truncate-safe bg-transparent text-sm outline-none placeholder:text-[13px] placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="flex shrink-0 items-center gap-1">
            {value && !open && !disabled && (
              <span
                role="button"
                tabIndex={0}
                aria-label={t('clear')}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onChange('', null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onChange('', null)
                }}
                className="rounded p-0.5 hover:bg-surface-hover"
              >
                <X size={14} />
              </span>
            )}
            <ChevronDown
              size={16}
              className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </span>
        </div>
        {open && inlineBox && (
          <div
            role="listbox"
            // The search keeps the focus (and the keyboard stays) while the
            // list is pressed or scrolled.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              floatingPanel,
              'absolute inset-x-0 flex flex-col !p-0',
              inlineBox.side === 'below' ? 'top-full' : 'bottom-full',
            )}
            style={{
              maxHeight: inlineBox.maxHeight,
              [inlineBox.side === 'below' ? 'marginTop' : 'marginBottom']:
                INLINE_EDGE,
            }}
          >
            {optionsBody}
            {createAction}
          </div>
        )}
      </div>
    )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <div className={`relative ${className}`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            {...aria}
            className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3 py-0 text-sm outline-none transition-colors focus:border-black disabled:cursor-not-allowed disabled:opacity-60 dark:focus:border-white"
            // Inline, so it wins over the focus utilities; the danger colour
            // is what `aria-invalid` shows on every other control.
            style={{
              borderColor: invalid ? 'var(--danger)' : 'var(--border)',
            }}
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate-safe text-start',
                !selectedOption && 'text-placeholder text-[13px]',
              )}
              title={optionTitle(selectedOption)}
            >
              {selectedOption?.label ?? placeholder}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {value && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t('clear')}
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange('', null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onChange('', null)
                  }}
                  className="rounded p-0.5 hover:bg-surface-hover"
                >
                  <X size={14} />
                </span>
              )}
              <ChevronDown
                size={16}
                className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </span>
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        data-select-portal="true"
        side="bottom"
        align="start"
        sideOffset={4}
        avoidCollisions
        collisionPadding={8}
        // Radix would focus the panel itself on open; focus the search box
        // instead, without scrolling the page under the menu.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus({ preventScroll: true })
        }}
        className="flex max-h-[min(var(--radix-popover-content-available-height),20rem)] w-[max(var(--radix-popover-trigger-width),16rem)] min-w-[var(--radix-popover-trigger-width)] max-w-[min(24rem,90vw)] flex-col !p-0"
      >
        <div className="relative shrink-0 border-b">
          <Search
            size={14}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveFocus(null, 1)
              }
            }}
            placeholder={t('searchInList')}
            className="w-full bg-transparent py-2 ps-9 pe-3 text-sm outline-none"
          />
        </div>
        {optionsBody}
        {createAction}
      </PopoverContent>
    </Popover>
  )
}
