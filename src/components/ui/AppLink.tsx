import {
  forwardRef,
  type AnchorHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useRouter } from 'next/navigation'

/**
 * A plain left click with no modifier key: the only click the app handles
 * itself. Ctrl / Cmd / Shift / Alt clicks and the middle button keep the
 * browser's own behaviour (a new tab or window).
 */
export function isPlainLeftClick(
  event: Pick<
    MouseEvent,
    'button' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
  >,
) {
  return (
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

/** Opens an app path in a new tab (a modified or middle click on a row). */
export function openInNewTab(href: string) {
  window.open(href, '_blank', 'noopener')
}

export interface AppLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** The app path, e.g. `/purchasing/…`. */
  href: string
  /** Runs instead of `router.push(href)` on a plain left click, for callers
   *  that already navigate their own way (the sidebar). */
  onNavigate?: () => void
}

/**
 * A real link inside the app (owner 2026-10-25, «click يمين … new tab او
 * ctrl»): a plain click navigates on the client like the buttons it
 * replaces, while right click › open in new tab, Ctrl / Cmd click and the
 * middle button open a new tab as on any site. It carries no style of its
 * own: give it classes, or wrap it as `<Button asChild>`.
 */
export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(
  function AppLink({ href, onNavigate, onClick, target, ...props }, ref) {
    const router = useRouter()
    const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (event.defaultPrevented || target || !isPlainLeftClick(event)) return
      event.preventDefault()
      if (onNavigate) onNavigate()
      else router.push(href)
    }
    return (
      <a
        ref={ref}
        href={href}
        target={target}
        onClick={handleClick}
        {...props}
      />
    )
  },
)
