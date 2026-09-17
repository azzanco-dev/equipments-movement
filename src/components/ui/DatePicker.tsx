import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
} from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  translations,
  type Language,
  type TranslationKey,
} from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import { saudiDateKey } from '@/lib/saudiTime'
import {
  addDaysToDateKey,
  addMonths,
  addMonthsToDateKey,
  buildMonthGrid,
  compareDateKeys,
  endOfWeek,
  isValidDateKey,
  parseDateKey,
  startOfWeek,
} from '@/lib/calendar'
import { Popover, PopoverContent, PopoverTrigger } from './FloatingPopover'
import { cn } from './cn'

// Gregorian calendar with Latin digits regardless of the interface language,
// matching the rest of the app's date handling (never a Hijri calendar).
const LOCALE: Record<Language, string> = {
  ar: 'ar-SA-u-ca-gregory-nu-latn',
  en: 'en-US-u-ca-gregory-nu-latn',
}

function monthYearLabel(year: number, month: number, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

// 1970-01-04 was a Sunday; UTC keeps this free of local DST quirks.
function weekdayShortLabels(lang: Language): string[] {
  const formatter = new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short' })
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(Date.UTC(1970, 0, 4 + i))),
  )
}

function dayLongLabel(dateKey: string, lang: Language): string {
  const parts = parseDateKey(dateKey)
  if (!parts) return dateKey
  return new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)))
}

// Resolves this control's own labels (clear, today, month/year nav) from the
// same `lang` used for month/day names, instead of the ambient i18n context.
// Both default to the ambient language, but an explicit `lang` override (for
// side-by-side locale previews) then affects labels and dates together.
function translateFor(lang: Language) {
  return (key: TranslationKey) =>
    translations[lang][key] ?? translations.ar[key] ?? key
}

function inRange(dateKey: string, min?: string, max?: string): boolean {
  if (min && compareDateKeys(dateKey, min) < 0) return false
  if (max && compareDateKeys(dateKey, max) > 0) return false
  return true
}

export interface DatePickerProps {
  /** Selected date key (YYYY-MM-DD), or '' for no selection. */
  value: string
  onChange: (value: string) => void
  /** Inclusive bounds as date keys. */
  min?: string
  max?: string
  placeholder?: string
  disabled?: boolean
  /** Marks the field invalid; Field sets this automatically. */
  invalid?: boolean
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean
  /**
   * Overrides the ambient interface language for month/day names and this
   * control's own labels. Defaults to the current i18n language; mainly
   * useful for side-by-side locale previews.
   */
  lang?: Language
}

/** Single-date picker: token-styled trigger + calendar grid in a Popover. */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  disabled,
  invalid,
  id,
  name,
  className,
  lang: langOverride,
  ...aria
}: DatePickerProps) {
  const { lang: ambientLang } = useI18n()
  const lang = langOverride ?? ambientLang
  const t = translateFor(lang)
  const [open, setOpen] = useState(false)
  // Remounts CalendarPanel (via key) on every open, so its initial view and
  // focus target are always computed fresh from the current value/today
  // during the mount render itself — no effect-ordering race with Radix's
  // own open-focus handling.
  const openKeyRef = useRef(0)

  const handleOpenChange = (next: boolean) => {
    if (next) openKeyRef.current += 1
    setOpen(next)
  }

  const displayValue = isValidDateKey(value) ? formatDate(value) : ''

  return (
    <div className={cn('relative min-w-0', className)}>
      {name && <input type="hidden" name={name} value={value} readOnly />}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              'input select-trigger flex h-10 w-full items-center gap-2 text-start md:h-9',
              value && !disabled && 'pe-8',
            )}
            {...aria}
          >
            <Calendar size={15} className="shrink-0 text-muted" />
            <span
              className={cn(
                'min-w-0 flex-1 truncate-safe',
                !value && 'text-placeholder text-[13px]',
              )}
            >
              {displayValue || placeholder || t('selectDatePlaceholder')}
            </span>
          </button>
        </PopoverTrigger>
        {value && !disabled && (
          <button
            type="button"
            aria-label={t('clear')}
            title={t('clear')}
            onClick={(event) => {
              event.stopPropagation()
              onChange('')
            }}
            className="absolute end-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        )}
        <PopoverContent
          className="w-[280px]"
          align="start"
          // CalendarPanel's own mount-time ref callback already focuses the
          // right day cell (see pendingFocusRef); suppress Radix's default
          // open-focus so it does not steal focus back afterward.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {open && (
            <CalendarPanel
              key={openKeyRef.current}
              value={value}
              min={min}
              max={max}
              lang={lang}
              t={t}
              onSelect={(dateKey) => {
                onChange(dateKey)
                setOpen(false)
              }}
              onClear={() => {
                onChange('')
                setOpen(false)
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

interface CalendarPanelProps {
  value: string
  min?: string
  max?: string
  lang: Language
  t: (key: TranslationKey) => string
  onSelect: (dateKey: string) => void
  onClear: () => void
}

function CalendarPanel({
  value,
  min,
  max,
  lang,
  t,
  onSelect,
  onClear,
}: CalendarPanelProps) {
  const todayKey = saudiDateKey()
  const startKey = isValidDateKey(value) ? value : todayKey
  const startParts = parseDateKey(startKey)!

  const [view, setView] = useState({
    year: startParts.year,
    month: startParts.month,
  })
  const [focusedKey, setFocusedKey] = useState(startKey)
  // Seeded with the starting cell so its own ref callback focuses it as soon
  // as it mounts (see registerCell) — ref callbacks run during the commit
  // phase, ahead of any useEffect, including Radix's own open-focus effect.
  const pendingFocusRef = useRef<string | null>(startKey)
  const cellRefs = useRef(new Map<string, HTMLButtonElement>())

  const grid = useMemo(
    () => buildMonthGrid(view.year, view.month),
    [view.year, view.month],
  )
  const weekdayLabels = useMemo(() => weekdayShortLabels(lang), [lang])
  const monthLabel = monthYearLabel(view.year, view.month, lang)

  const shiftMonth = useCallback((delta: number) => {
    setView((current) => addMonths(current.year, current.month, delta))
  }, [])

  // Ref callback fires during the commit phase, right after the grid above
  // renders the new month's cells, so the target button already exists by
  // the time we ask for it here — no extra effect/render round-trip needed.
  const registerCell = useCallback(
    (dateKey: string) => (el: HTMLButtonElement | null) => {
      if (el) {
        cellRefs.current.set(dateKey, el)
        if (pendingFocusRef.current === dateKey) {
          el.focus()
          pendingFocusRef.current = null
        }
      } else {
        cellRefs.current.delete(dateKey)
      }
    },
    [],
  )

  const moveFocus = (nextKey: string | null) => {
    if (!nextKey) return
    const parts = parseDateKey(nextKey)
    if (!parts) return
    const el = cellRefs.current.get(nextKey)
    if (el) {
      // Already rendered in the current month: focus it directly.
      setFocusedKey(nextKey)
      el.focus()
    } else {
      // Crossing into a different month: the cell will mount only once the
      // grid below re-renders, so ask its ref callback to focus it then.
      pendingFocusRef.current = nextKey
      setFocusedKey(nextKey)
      setView({ year: parts.year, month: parts.month })
    }
  }

  const commit = (dateKey: string) => {
    if (!inRange(dateKey, min, max)) return
    onSelect(dateKey)
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = lang === 'ar'
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        moveFocus(addDaysToDateKey(focusedKey, rtl ? -1 : 1))
        break
      case 'ArrowLeft':
        event.preventDefault()
        moveFocus(addDaysToDateKey(focusedKey, rtl ? 1 : -1))
        break
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(addDaysToDateKey(focusedKey, 7))
        break
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(addDaysToDateKey(focusedKey, -7))
        break
      case 'PageDown':
        event.preventDefault()
        moveFocus(addMonthsToDateKey(focusedKey, 1))
        break
      case 'PageUp':
        event.preventDefault()
        moveFocus(addMonthsToDateKey(focusedKey, -1))
        break
      case 'Home':
        event.preventDefault()
        moveFocus(startOfWeek(focusedKey))
        break
      case 'End':
        event.preventDefault()
        moveFocus(endOfWeek(focusedKey))
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(focusedKey)
        break
      // Escape is handled by the Popover itself; nothing to do here.
    }
  }

  return (
    // floatingPanel sets p-1 for menu-style content; cancel it here so this
    // calendar's own section padding (border + p-2 blocks) lines up flush
    // with the panel edges.
    <div className="-m-1">
      <div className="flex items-center justify-between gap-0.5 border-b p-2">
        <button
          type="button"
          aria-label={t('previousYear')}
          onClick={() => shiftMonth(-12)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
        >
          <ChevronsLeft size={15} className="rtl-flip" />
        </button>
        <button
          type="button"
          aria-label={t('previousMonth')}
          onClick={() => shiftMonth(-1)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
        >
          <ChevronLeft size={15} className="rtl-flip" />
        </button>
        <span className="flex-1 text-center text-sm font-medium">
          {monthLabel}
        </span>
        <button
          type="button"
          aria-label={t('nextMonth')}
          onClick={() => shiftMonth(1)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
        >
          <ChevronRight size={15} className="rtl-flip" />
        </button>
        <button
          type="button"
          aria-label={t('nextYear')}
          onClick={() => shiftMonth(12)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
        >
          <ChevronsRight size={15} className="rtl-flip" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-2 pt-2">
        {weekdayLabels.map((label, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="py-1 text-center text-[11px] font-medium text-muted"
          >
            {label}
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-0.5 p-2"
        onKeyDown={handleGridKeyDown}
      >
        {grid.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} />
          const isSelected = value === cell.dateKey
          const isToday = cell.dateKey === todayKey
          const isFocusTarget = cell.dateKey === focusedKey
          const disabledCell = !inRange(cell.dateKey, min, max)
          return (
            <button
              key={cell.dateKey}
              type="button"
              ref={registerCell(cell.dateKey)}
              tabIndex={isFocusTarget ? 0 : -1}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              aria-disabled={disabledCell || undefined}
              aria-label={dayLongLabel(cell.dateKey, lang)}
              onFocus={() => setFocusedKey(cell.dateKey)}
              onClick={() => commit(cell.dateKey)}
              className={cn(
                'mx-auto flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors',
                disabledCell
                  ? 'cursor-not-allowed text-placeholder'
                  : isSelected
                    ? 'bg-primary text-primary-contrast font-medium'
                    : isToday
                      ? 'bg-surface font-medium'
                      : 'hover:bg-surface-hover',
              )}
            >
              {cell.day}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t p-2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-hover hover:text-fg"
        >
          {t('clear')}
        </button>
        <button
          type="button"
          onClick={() => commit(todayKey)}
          className="rounded-md px-2 py-1 text-xs font-medium hover:bg-surface-hover"
        >
          {t('todayBadge')}
        </button>
      </div>
    </div>
  )
}
