import { cn } from './cn'

export type SkeletonVariant = 'block' | 'text' | 'circle'

export interface SkeletonProps {
  variant?: SkeletonVariant
  className?: string
}

/**
 * Loading placeholder on the surface token with a subtle pulse. The pulse
 * respects `prefers-reduced-motion` through the global rule in index.css
 * that shortens every animation to near-zero for that preference.
 */
export function Skeleton({ variant = 'block', className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-surface',
        variant === 'block' && 'rounded-lg',
        variant === 'text' && 'h-3.5 rounded',
        variant === 'circle' && 'rounded-full',
        className,
      )}
    />
  )
}
