import type { CSSProperties } from 'react'
import { AppLink } from '@/components/ui'
import { isSupplierPoDraftRef } from '@/lib/purchasing'

/** The green pill of a PO number (the SPO pill of «المعدات في المشاريع»). */
const PO_PILL_STYLE: CSSProperties = {
  color: 'var(--success)',
  backgroundColor: 'var(--success-soft)',
}

/** The same pill, muted: the OTHER side's PO on a row (the supplier PO on
 *  the client list), so the row's own PO stays the green one. */
const MUTED_PILL_STYLE: CSSProperties = {
  color: 'var(--muted)',
  backgroundColor: 'var(--surface-hover)',
}

/** A supplier PO's DRAFT REFERENCE (`DRAFT-0565`, migration 0190): grey, so
 *  it never reads as an issued PO number (owner 2026-11-11, «غير لون بادج
 *  الدرافت … البادج الي عبارة عن DRAFT-0565»). The neutral badge's colours. */
const DRAFT_PILL_STYLE: CSSProperties = {
  color: 'var(--fg)',
  backgroundColor: 'var(--surface-hover)',
}

/** The colours of a PO number pill: green for an issued number, grey for a
 *  draft reference. Shared by every screen that draws the pill itself. */
export function poPillStyle(number: string | null | undefined): CSSProperties {
  return isSupplierPoDraftRef(number) ? DRAFT_PILL_STYLE : PO_PILL_STYLE
}

const PILL =
  'inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold'

/**
 * A PO number as a round pill. With `href` it is a real link (owner
 * 2026-10-25: right click › new tab, Ctrl click) that navigates on the
 * client through `onNavigate`; without one, plain text in the pill.
 */
export function PoPill({
  number,
  href,
  onNavigate,
  muted = false,
  className,
}: {
  number: string
  href?: string
  onNavigate?: () => void
  muted?: boolean
  className?: string
}) {
  const style = muted ? MUTED_PILL_STYLE : poPillStyle(number)
  if (!href)
    return (
      <span className={`${PILL} ${className ?? ''}`} style={style}>
        <bdi dir="ltr">{number}</bdi>
      </span>
    )
  return (
    <AppLink
      href={href}
      onNavigate={onNavigate}
      className={`${PILL} underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${className ?? ''}`}
      style={style}
    >
      <bdi dir="ltr">{number}</bdi>
    </AppLink>
  )
}
