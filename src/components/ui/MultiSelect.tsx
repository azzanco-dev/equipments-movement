import { forwardRef, useId, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Checkbox } from './Checkbox'
import { cn } from './cn'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from './FloatingPopover'

export interface MultiSelectOption {
  /** Must be a non-empty, unique string. */
  value: string
  label: string
  /** Secondary line under the label inside the panel only. */
  description?: ReactNode
  disabled?: boolean
}

export interface MultiSelectProps {
  options: MultiSelectOption[]
  /** Selected values. An empty array means "everything", never "nothing". */
  value: string[]
  onValueChange: (value: string[]) => void
  /**
   * Trigger text when nothing is selected. Defaults to "الكل" — an empty
   * selection is deliberately read as "no filter", which is what every list
   * and every report in this system does with a cleared filter.
   */
  allLabel?: string
  /**
   * Trigger text once more than `summaryAfter` options are selected, for
   * example "3 ملاك". Receives the count so the caller can use its own
   * plural noun; without it the shared "%n محددة" wording is used.
   */
  summaryLabel?: (count: number) => string
  /** Above this many selected options the trigger summarizes. Default 2. */
  summaryAfter?: number
  /** Renders the selected options as removable chips under the trigger. */
  chips?: boolean
  /** `sm` is the 28 px table/toolbar size, mirroring Button and Select. */
  size?: 'sm' | 'md'
  disabled?: boolean
  /** Marks the field invalid; Field sets this automatically. */
  invalid?: boolean
  id?: string
  /** Sizing/spacing for the control as a whole; the trigger fills it. */
  className?: string
  /** Extra classes for the trigger button itself. */
  triggerClassName?: string
  /** Extra classes for the floating panel (a wider list, for example). */
  contentClassName?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

const triggerSizes: Record<NonNullable<MultiSelectProps['size']>, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-10 md:h-9',
}

/**
 * Multi-select on Radix Popover with a checkbox list.
 *
 * Radix `Select` is single-value by design, so a multi-select is a popover
 * holding real `Checkbox` controls rather than a select with a fake "multiple"
 * mode: each row is a labelled checkbox, so Tab reaches it, Space toggles it,
 * and a screen reader announces "checked" instead of a selected option that
 * unselects the previous one.
 *
 * The trigger never grows with the selection: one or two choices are named,
 * more are summarized ("3 ملاك"), and the full list stays in the panel. That
 * keeps the control the same height as every other shared control (40 px on
 * mobile, 36 px from md up) no matter how many options are on.
 *
 * Styling is tokens only and every inset uses logical properties, so the
 * control mirrors correctly in RTL without a direction prop — `I18nProvider`
 * already supplies Radix's direction.
 */
export const MultiSelect = forwardRef<HTMLButtonElement, MultiSelectProps>(
  function MultiSelect(
    {
      options,
      value,
      onValueChange,
      allLabel,
      summaryLabel,
      summaryAfter = 2,
      chips = false,
      size = 'md',
      disabled,
      invalid,
      id,
      className,
      triggerClassName,
      contentClassName,
      ...aria
    },
    ref,
  ) {
    const { t } = useI18n()
    const listId = useId()
    const [open, setOpen] = useState(false)

    // Only values the caller actually offers may reach the trigger or the
    // callback, so a stale value (an option removed while it was selected)
    // can never be shown as a label the user cannot clear.
    const selected = useMemo(() => {
      const known = new Set(options.map((option) => option.value))
      return value.filter((entry) => known.has(entry))
    }, [options, value])
    const selectedSet = useMemo(() => new Set(selected), [selected])

    const toggle = (option: string, checked: boolean) => {
      // Emitted in the options' own order rather than click order, so the same
      // selection always serializes to the same URL.
      const next = new Set(selectedSet)
      if (checked) next.add(option)
      else next.delete(option)
      onValueChange(
        options.map((entry) => entry.value).filter((entry) => next.has(entry)),
      )
    }

    const emptyLabel = allLabel ?? t('multiSelectAll')
    const triggerLabel =
      selected.length === 0
        ? emptyLabel
        : selected.length <= summaryAfter
          ? selected
              .map(
                (entry) =>
                  options.find((option) => option.value === entry)?.label ??
                  entry,
              )
              .join('، ')
          : (summaryLabel?.(selected.length) ??
            t('multiSelectCount').replace('{count}', String(selected.length)))

    return (
      <div className={cn('min-w-0', chips && 'space-y-1.5', className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={ref}
              id={id}
              type="button"
              disabled={disabled}
              aria-invalid={invalid || undefined}
              className={cn(
                'input select-trigger flex w-full items-center justify-between gap-2 text-start',
                triggerSizes[size],
                selected.length === 0 && 'text-placeholder',
                triggerClassName,
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
            className={cn(
              'flex max-h-[min(var(--radix-popover-content-available-height),22rem)] w-[min(20rem,90vw)] flex-col p-0',
              contentClassName,
            )}
          >
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {options.map((option) => {
                const checked = selectedSet.has(option.value)
                const optionId = `${listId}-${option.value}`
                return (
                  <li key={option.value}>
                    {/* The label is a sibling linked with `htmlFor` rather
                        than a wrapper around the checkbox: a label that wraps
                        its own control has to suppress its activation
                        behaviour to avoid toggling twice, and that rule is
                        exactly the kind of browser detail worth not relying
                        on inside a popover. */}
                    <div
                      className={cn(
                        'flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-surface-hover',
                        option.disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <Checkbox
                        id={optionId}
                        checked={checked}
                        disabled={option.disabled}
                        onCheckedChange={(next) =>
                          toggle(option.value, next === true)
                        }
                        className="mt-0.5"
                      />
                      <label
                        htmlFor={optionId}
                        className={cn(
                          'flex min-w-0 flex-col gap-0.5',
                          option.disabled
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer',
                        )}
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
              })}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t p-1">
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => onValueChange([])}
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

        {chips && selected.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {selected.map((entry) => {
              const option = options.find((item) => item.value === entry)
              return (
                <li key={entry}>
                  <button
                    type="button"
                    onClick={() => toggle(entry, false)}
                    className="inline-flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-xs transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>{option?.label ?? entry}</span>
                    <X size={12} aria-hidden="true" className="text-muted" />
                    <span className="sr-only">{t('multiSelectRemove')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  },
)
