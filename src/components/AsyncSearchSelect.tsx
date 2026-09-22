import { useEffect, useRef, useState } from 'react'
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
}

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
  ...aria
}: AsyncSearchSelectProps) {
  const { t } = useI18n()
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

  const select = (option: AsyncSearchSelectOption) => {
    onChange(option.value, option)
    setOpen(false)
  }

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
            style={{ borderColor: 'var(--border)' }}
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
        {showCreateAction && onCreate && (
          <button
            type="button"
            className="w-full shrink-0 border-t px-3.5 py-2 text-start text-sm font-semibold hover:bg-surface-hover"
            onClick={() => {
              onCreate(query.trim())
              setOpen(false)
            }}
          >
            {createLabel ?? `+ ${query.trim()}`}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
