import { forwardRef, type ReactNode } from 'react'
import { Select as RadixSelect } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from './cn'
import { floatingItem, floatingPanel } from './popover'

export interface SelectOption {
  /** Must be a non-empty string (Radix reserves '' for "no value"). */
  value: string
  label: ReactNode
  disabled?: boolean
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
            'input flex h-10 items-center justify-between gap-2 text-start md:h-9',
            'data-[placeholder]:text-muted',
            className,
          )}
          {...aria}
        >
          <span className="min-w-0 truncate">
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
              'max-h-[min(var(--radix-select-content-available-height),20rem)] min-w-[var(--radix-select-trigger-width)]',
            )}
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(floatingItem, 'pe-8')}
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="absolute end-2 inline-flex items-center">
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
