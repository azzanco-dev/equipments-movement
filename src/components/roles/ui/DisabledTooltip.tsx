import type { ReactNode } from 'react'
import { Tooltip } from '@/components/ui'

/** Wraps a disabled control so its tooltip still shows (a disabled button
 *  receives no pointer events). Renders the child alone when `note` is null. */
export function DisabledTooltip({
  note,
  children,
}: {
  note: string | null
  children: ReactNode
}) {
  if (!note) return <>{children}</>
  return (
    <Tooltip content={note}>
      <span tabIndex={0} className="inline-flex rounded-lg">
        {children}
      </span>
    </Tooltip>
  )
}
