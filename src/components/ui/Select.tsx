import { forwardRef, type ReactNode } from 'react'
import { Select as RadixSelect } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from './cn'
import { floatingItem, floatingPanel } from './popover'

export interface SelectOption {
  /** Must be a non-empty string (Radix reserves '' for "no value"). */
  value: string
  label: ReactNode
  /**
   * Secondary line rendered under the label in muted text (e.g. an id or
   * phone number next to a name). Shown in the dropdown item only, never
   * mirrored into the trigger.
   */
  description?: ReactNode
  disabled?: boolean
}

/** Builds a plain-text tooltip from an option's label/description when both
 * are strings, so a truncated trigger or item still exposes the full text. */
function optionTitle(option: SelectOption | undefined): string | undefined {
  if (!option) return undefined
  const parts = [option.label, option.description].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  )
  return parts.length ? parts.join(' — ') : undefined
}

export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  options: SelectOption[]
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
}

/** Accessible select on Radix, matching the shared Input height and focus. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      value,
      defaultValue,
      onValueChange,
      options,
      placeholder,
      disabled,
      invalid,
      id,
      name,
      className,
      ...aria
    },
    ref,
  ) {
    const selected = options.find(
      (option) => option.value === (value ?? defaultValue),
    )
    const triggerTitle = optionTitle(selected)
    return (
      <RadixSelect.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
      >
        <RadixSelect.Trigger
          ref={ref}
          id={id}
          aria-invalid={invalid || undefined}
          className={cn(
            'input select-trigger flex h-10 items-center justify-between gap-2 text-start md:h-9',
            'data-[placeholder]:text-placeholder data-[placeholder]:text-[13px]',
            className,
          )}
          {...aria}
        >
          <span className="min-w-0 truncate-safe" title={triggerTitle}>
            <RadixSelect.Value placeholder={placeholder} />
          </span>
          <RadixSelect.Icon className="shrink-0 text-muted">
            <ChevronDown size={16} aria-hidden="true" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className={cn(
              floatingPanel,
              'max-h-[min(var(--radix-select-content-available-height),20rem)] min-w-[var(--radix-select-trigger-width)] max-w-[min(24rem,90vw)]',
            )}
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  title={optionTitle(option)}
                  className={cn(floatingItem, '!items-start pe-8')}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <RadixSelect.ItemText>
                      <span className="block min-w-0 whitespace-normal break-words text-start">
                        {option.label}
                      </span>
                    </RadixSelect.ItemText>
                    {option.description && (
                      <span className="block min-w-0 truncate-safe text-xs text-muted">
                        {option.description}
                      </span>
                    )}
                  </span>
                  <RadixSelect.ItemIndicator className="absolute end-2 top-2 inline-flex items-center">
                    <Check size={15} aria-hidden="true" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    )
  },
)
