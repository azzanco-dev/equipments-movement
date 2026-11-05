import { bankInitials, bankLogoOf } from '@/lib/bankLogos'
import { cn } from '@/components/ui'

const SIZES = {
  sm: 'h-7 w-12',
  md: 'h-9 w-16',
  lg: 'h-12 w-24',
} as const

/**
 * A bank's logo in a fixed tile, so wide wordmarks and square marks line up
 * (owner 2026-11-05, on /ui-kit first). A white logo sits on a dark tile; a
 * bank without a file shows its initials. The tile is white (dark for a
 * white logo) in both themes, since the logos are drawn for it.
 */
export function BankLogo({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const logo = bankLogoOf(name)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border px-1',
        SIZES[size],
        !logo
          ? 'bg-[var(--surface)]'
          : logo.onDark
            ? 'border-transparent bg-[var(--logo-tile-dark)]'
            : 'bg-[var(--logo-tile)]',
        className,
      )}
    >
      {logo ? (
        <img
          src={logo.src}
          alt=""
          className="max-h-full max-w-full object-contain"
          loading="lazy"
        />
      ) : (
        <span className="text-xs font-semibold text-muted">
          {bankInitials(name)}
        </span>
      )}
    </span>
  )
}
