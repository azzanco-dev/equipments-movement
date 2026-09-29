import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import {
  Checkbox,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@/components/ui'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { useI18n } from '@/i18n/I18nContext'

/** Relational selectors show the first/best 20 matches, never more. */
const OPTION_LIMIT = 20
/** Same pause as the other relational selectors before a typed search. */
const SEARCH_DEBOUNCE_MS = 300

export interface AsyncMultiSelectProps {
  /** Selected ids. An empty array means "everything", never "nothing". */
  value: string[]
  /**
   * Labels the caller already knows for the selected ids (picked here, or
   * resolved from the URL). An id without a label is still selected; the
   * trigger then summarizes by count instead of printing a raw id.
   */
  selectedOptions: AsyncSearchSelectOption[]
  onValueChange: (value: string[], options: AsyncSearchSelectOption[]) => void
  /** Server-side search; called with '' when the panel opens. */
  loadOptions: (query: string) => Promise<AsyncSearchSelectOption[]>
  /** Trigger text when nothing is selected. Defaults to "الكل". */
  allLabel?: string
  /** Above this many selected options the trigger summarizes. Default 2. */
  summaryAfter?: number
  /** `sm` is the 28 px table/toolbar size, mirroring `MultiSelect`. */
  size?: 'sm' | 'md'
  disabled?: boolean
  invalid?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

const triggerSizes: Record<
  NonNullable<AsyncMultiSelectProps['size']>,
  string
> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-10 md:h-9',
}

/**
 * `MultiSelect` for a relational field that is too large to preload.
 *
 * Same trigger, checkbox rows and Clear / Done footer as the shared
 * `MultiSelect`, plus the search box of `AsyncSearchSelect`: the first 20
 * matches come from the server, a typed search waits ~300 ms, and there is no
 * load-more (unified list architecture). Options that are selected but not in
 * the current results stay listed on top, so a selection can always be undone
 * without searching for it again.
 *
 * The emitted ids are sorted, so the same selection always serializes to the
 * same URL whatever order it was clicked in.
 */
export function AsyncMultiSelect({
  value,
  selectedOptions,
  onValueChange,
  loadOptions,
  allLabel,
  summaryAfter = 2,
  size = 'md',
  disabled,
  invalid,
  id,
  className,
  ...aria
}: AsyncMultiSelectProps) {
  const { t } = useI18n()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<AsyncSearchSelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const requestId = ++requestRef.current
    setLoading(true)
    setLoadError(false)
    const timer = window.setTimeout(
      async () => {
        try {
          const next = await loadOptions(query.trim())
          if (requestId === requestRef.current)
            setOptions(next.slice(0, OPTION_LIMIT))
        } catch {
          // The raw PostgREST message never reaches the user.
          if (requestId === requestRef.current) {
            setOptions([])
            setLoadError(true)
          }
        } finally {
          if (requestId === requestRef.current) setLoading(false)
        }
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => {
      window.clearTimeout(timer)
      requestRef.current = requestId + 1
    }
  }, [open, query, loadOptions, retry])

  const selectedSet = useMemo(() => new Set(value), [value])
  const known = useMemo(() => {
    const map = new Map<string, AsyncSearchSelectOption>()
    for (const option of selectedOptions) map.set(option.value, option)
    for (const option of options) map.set(option.value, option)
    return map
  }, [options, selectedOptions])

  // Selected rows missing from the current results are pinned above them.
  const pinned = value
    .filter((entry) => !options.some((option) => option.value === entry))
    .map((entry) => known.get(entry))
    .filter((option): option is AsyncSearchSelectOption => !!option)
  const rows = [...pinned, ...options]

  const emit = (next: Set<string>) => {
    const ids = Array.from(next).sort()
    onValueChange(
      ids,
      ids
        .map((entry) => known.get(entry))
        .filter((option): option is AsyncSearchSelectOption => !!option),
    )
  }

  const toggle = (entry: string, checked: boolean) => {
    const next = new Set(selectedSet)
    if (checked) next.add(entry)
    else next.delete(entry)
    emit(next)
  }

  const labels = value.map((entry) => known.get(entry)?.label)
  const triggerLabel =
    value.length === 0
      ? (allLabel ?? t('multiSelectAll'))
      : value.length <= summaryAfter && labels.every(Boolean)
        ? labels.join('، ')
        : t('multiSelectCount').replace('{count}', String(value.length))

  return (
    <div className={cn('min-w-0', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              'input select-trigger flex w-full items-center justify-between gap-2 text-start',
              triggerSizes[size],
              value.length === 0 && 'text-placeholder',
            )}
            {...aria}
          >
            <span className="min-w-0 truncate-safe" title={triggerLabel}>
              {triggerLabel}
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="shrink-0 text-muted"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          // Focus the search box instead of the panel, without scrolling the
          // page (or the dialog) under the menu.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus({ preventScroll: true })
          }}
          className="flex max-h-[min(var(--radix-popover-content-available-height),22rem)] w-[min(20rem,90vw)] flex-col p-0"
        >
          <div className="relative shrink-0 border-b">
            <Search
              size={14}
              aria-hidden="true"
              className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchInList')}
              aria-label={t('searchInList')}
              className="w-full bg-transparent py-2 pe-3 ps-9 text-sm outline-none"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {pinned.map((option) => (
              <OptionRow
                key={`pinned-${option.value}`}
                id={`${listId}-p-${option.value}`}
                option={option}
                checked
                onToggle={toggle}
              />
            ))}
            {loading ? (
              <li className="flex items-center justify-center gap-2 px-3 py-5 text-sm text-muted">
                <Loader2
                  size={16}
                  aria-hidden="true"
                  className="animate-spin"
                />
                {t('loading')}
              </li>
            ) : loadError ? (
              <li
                role="alert"
                className="space-y-2 px-3 py-4 text-center text-sm text-muted"
              >
                <p>{t('optionsLoadError')}</p>
                <button
                  type="button"
                  className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-surface-hover"
                  onClick={() => setRetry((current) => current + 1)}
                >
                  {t('retry')}
                </button>
              </li>
            ) : rows.length === 0 ? (
              <li className="px-3 py-5 text-center text-sm text-muted">
                {t('noResults')}
              </li>
            ) : (
              options.map((option) => (
                <OptionRow
                  key={option.value}
                  id={`${listId}-${option.value}`}
                  option={option}
                  checked={selectedSet.has(option.value)}
                  onToggle={toggle}
                />
              ))
            )}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t p-1">
            <button
              type="button"
              disabled={value.length === 0}
              onClick={() => emit(new Set())}
              className="rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {t('clear')}
            </button>
            <PopoverClose asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Check size={13} aria-hidden="true" />
                {t('multiSelectDone')}
              </button>
            </PopoverClose>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function OptionRow({
  id,
  option,
  checked,
  onToggle,
}: {
  id: string
  option: AsyncSearchSelectOption
  checked: boolean
  onToggle: (value: string, checked: boolean) => void
}) {
  return (
    <li>
      {/* Label as a sibling linked with `htmlFor`, as in `MultiSelect`. */}
      <div className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-surface-hover">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(next) => onToggle(option.value, next === true)}
          className="mt-0.5"
        />
        <label
          htmlFor={id}
          className="flex min-w-0 cursor-pointer flex-col gap-0.5"
        >
          <span className="block min-w-0 whitespace-normal break-words text-start">
            {option.label}
          </span>
          {option.description && (
            <span className="block min-w-0 text-xs text-muted">
              {option.description}
            </span>
          )}
        </label>
      </div>
    </li>
  )
}
