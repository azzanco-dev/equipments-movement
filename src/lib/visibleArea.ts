import { useEffect, useState } from 'react'

let probe: HTMLDivElement | null = null

/**
 * The visible area (above the keyboard) in getBoundingClientRect's
 * coordinates, whatever a phone measures from: on the iPhone rects count from
 * the visible area, elsewhere from the layout viewport. A `position: fixed`
 * probe at top 0 marks the layout viewport's top in those coordinates, and
 * the visible area starts visualViewport.offsetTop below it either way
 * (owner's iPhone readings, 2026-10-26).
 */
export function visibleArea() {
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
  }
  const view = window.visualViewport
  const top = probe.getBoundingClientRect().top + (view?.offsetTop ?? 0)
  const height = view?.height ?? window.innerHeight
  return { top, bottom: top + height }
}

const PHONE_QUERY = '(max-width: 767px)'

/** True below 768 px (the project's mobile breakpoint), live. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(PHONE_QUERY)
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return phone
}
