import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge, cn } from '@/components/ui'

// Arrangement of /ui-kit: a sticky section index and a collapsible shell per
// showcase. The showcases themselves are untouched; these components only
// wrap them so the page opens short and every section has an anchor.

export type UiKitStatus = 'approved' | 'review'

export type UiKitIndexItem = { id: string; title: string }

export type UiKitIndexGroup = {
  id: string
  title: string
  items: UiKitIndexItem[]
}

const STATUS_LABEL: Record<UiKitStatus, string> = {
  approved: 'معتمد',
  review: 'قيد المراجعة',
}

const STORAGE_PREFIX = 'ui-kit:section:'

function readStoredOpen(id: string): boolean | null {
  try {
    const value = window.localStorage.getItem(STORAGE_PREFIX + id)
    return value === null ? null : value === '1'
  } catch {
    return null
  }
}

function writeStoredOpen(id: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, open ? '1' : '0')
  } catch {
    // Storage may be unavailable (private mode, blocked); the page still works.
  }
}

/** Opens a collapsed section (if the anchor is one) and scrolls to it. */
export function revealSection(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  if (target instanceof HTMLDetailsElement && !target.open) target.open = true
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * The id of the section currently in view, chosen as the first (in `ids`
 * order) whose box crosses the upper part of the viewport.
 */
export function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  const key = ids.join('|')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const ordered = key ? key.split('|') : []
    const visible = new Set<string>()
    const pick = () => {
      const first = ordered.find((id) => visible.has(id))
      if (first) setActive(first)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        pick()
      },
      // Active = the section that crosses the band between 10% and 45% from
      // the top, so a collapsed (short) section counts while it passes there.
      { rootMargin: '-10% 0px -55% 0px', threshold: 0 },
    )
    for (const id of ordered) {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [key])
  return active
}

export function UiKitIndex({
  groups,
  activeId,
  variant,
  className,
}: {
  groups: UiKitIndexGroup[]
  activeId: string | null
  /** `side`: the sticky start-side column; `chips`: the mobile scroll row. */
  variant: 'side' | 'chips'
  className?: string
}) {
  const go = (id: string) => (event: SyntheticEvent) => {
    event.preventDefault()
    revealSection(id)
  }
  if (variant === 'chips') {
    return (
      <nav
        aria-label="اقسام الصفحة"
        className={cn(
          'sticky top-0 z-20 -mx-4 border-b bg-bg px-4 py-2 sm:-mx-6 sm:px-6',
          className,
        )}
      >
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {groups.map((group) => (
            <div key={group.id} className="flex shrink-0 items-center gap-1.5">
              <a
                href={`#${group.id}`}
                onClick={go(group.id)}
                className="shrink-0 whitespace-nowrap px-1 text-xs font-semibold text-muted"
              >
                {group.title}
              </a>
              {group.items.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={go(item.id)}
                  aria-current={activeId === item.id ? 'location' : undefined}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-xs transition-colors',
                    activeId === item.id
                      ? 'nav-active border-transparent'
                      : 'bg-bg text-fg hover:bg-surface-hover',
                  )}
                >
                  {item.title}
                </a>
              ))}
            </div>
          ))}
        </div>
      </nav>
    )
  }
  return (
    <nav
      aria-label="اقسام الصفحة"
      className={cn(
        'sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pe-2 text-sm [scrollbar-width:thin]',
        className,
      )}
    >
      <ol className="space-y-4">
        {groups.map((group) => {
          const groupActive = group.items.some((item) => item.id === activeId)
          return (
            <li key={group.id}>
              <a
                href={`#${group.id}`}
                onClick={go(group.id)}
                className={cn(
                  'block px-2 pb-1 text-xs font-semibold',
                  groupActive ? 'text-fg' : 'text-muted',
                )}
              >
                {group.title}
              </a>
              <ol className="space-y-0.5 border-s ps-1">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={go(item.id)}
                      aria-current={
                        activeId === item.id ? 'location' : undefined
                      }
                      className={cn(
                        'block rounded-md px-2 py-1 text-[13px] leading-5 transition-colors',
                        activeId === item.id
                          ? 'nav-active'
                          : 'text-muted hover:bg-surface-hover hover:text-fg',
                      )}
                    >
                      {item.title}
                    </a>
                  </li>
                ))}
              </ol>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** A heading for one of the three content groups, with its own anchor. */
export function UiKitGroup({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-16">
      <div className="mb-3 border-b pb-2">
        <h2 id={`${id}-title`} className="text-lg font-bold">
          {title}
        </h2>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/**
 * Collapsible shell of one showcase: a consistent header (title, purpose,
 * status badge) on a `<details>` whose open state is remembered per section.
 */
export function UiKitSection({
  id,
  title,
  purpose,
  status,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  purpose: string
  status: UiKitStatus
  defaultOpen?: boolean
  children: ReactNode
}) {
  // The stored state is read after mount so the server and first client
  // render agree (the storage is per browser).
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    const stored = readStoredOpen(id)
    if (stored !== null) setOpen(stored)
  }, [id])

  return (
    <details
      id={id}
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open
        setOpen(next)
        writeStoredOpen(id, next)
      }}
      className="group/section scroll-mt-16 rounded-xl border bg-bg"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform group-open/section:rotate-180"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted">{purpose}</span>
        </span>
        <Badge
          size="sm"
          tone={status === 'approved' ? 'success' : 'neutral'}
          className="shrink-0"
        >
          {STATUS_LABEL[status]}
        </Badge>
      </summary>
      <div className="border-t p-3 sm:p-4">{children}</div>
    </details>
  )
}
