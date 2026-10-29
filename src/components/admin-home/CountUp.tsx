import { useEffect, useRef, useState } from 'react'

/**
 * A statistic that counts up (owner 2026-10-29, «بالنسبة للارقام الاحصائية
 * خليها counter»): from 0 on the first render, then from the number on
 * screen to the new one when it changes (an owner filter), so a refresh never
 * restarts from zero. Straight to the value under reduced motion. Screen
 * readers get the final number only.
 */
export function CountUp({
  value,
  duration = 900,
}: {
  value: number
  duration?: number
}) {
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)

  useEffect(() => {
    const from = shownRef.current
    const set = (next: number) => {
      shownRef.current = next
      setShown(next)
    }
    if (
      from === value ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      set(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      set(Math.round(from + (value - from) * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{value}</span>
    </>
  )
}
