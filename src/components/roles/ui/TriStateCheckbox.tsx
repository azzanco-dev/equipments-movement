import { Checkbox as RadixCheckbox } from 'radix-ui'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/components/ui'

export type TriState = 'all' | 'some' | 'none'

/**
 * Group checkbox with an indeterminate state (the «select all» of a permission
 * group). Built on Radix directly because the shared Checkbox has no
 * indeterminate rendering yet; same 20 px box and primary tokens.
 */
export function TriStateCheckbox({
  state,
  disabled,
  label,
  onChange,
}: {
  state: TriState
  disabled?: boolean
  label: string
  onChange: (on: boolean) => void
}) {
  return (
    <RadixCheckbox.Root
      checked={state === 'some' ? 'indeterminate' : state === 'all'}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={() => onChange(state !== 'all')}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-bg text-primary-contrast transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
      )}
    >
      <RadixCheckbox.Indicator>
        {state === 'some' ? (
          <Minus size={13} strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check size={13} strokeWidth={3} aria-hidden="true" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}
