import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Ban, CircleDashed, MapPin, ParkingCircle, Wrench } from 'lucide-react'
import type { TranslationKey } from '@/i18n/translations'
import type { InquiryStateKey } from '@/lib/inquiryYear'

// The look of the inquiry page (owner 2026-10-26, approved on /ui-kit
// «نموذج صفحة الاستعلام الجديدة»): one colour per state («كل لون يرمز
// لحالة معينة»), light («فتّح الالوان»), flat — no gradient and no coloured
// border («مو طبيعي سوء القريديانت», «الحدود مش كويسة») — on borderless
// surfaces with a soft shadow.

/** `fill` is a light tile, `tint` an icon circle, `stroke` the icon and the
 *  day colour. */
export interface InquiryColors {
  fill: string
  tint: string
  stroke: string
}

/** A chart shade lightened toward the page. */
function light(token: string): string {
  return `color-mix(in srgb, ${token} 55%, var(--bg))`
}

export const INQUIRY_STATE_COLORS: Record<InquiryStateKey, InquiryColors> = {
  site: {
    fill: light('var(--chart-1)'),
    tint: 'var(--chart-1)',
    stroke: 'var(--chart-stroke-1)',
  },
  maintenance: {
    fill: light('var(--chart-2)'),
    tint: 'var(--chart-2)',
    stroke: 'var(--chart-stroke-2)',
  },
  parking: {
    fill: light('var(--chart-3)'),
    tint: 'var(--chart-3)',
    stroke: 'var(--chart-stroke-3)',
  },
  out_of_service: {
    fill: 'var(--danger-soft)',
    tint: light('var(--danger)'),
    stroke: 'var(--danger)',
  },
  unrecorded: {
    fill: light('var(--chart-4)'),
    tint: 'var(--chart-4)',
    stroke: 'var(--chart-stroke-4)',
  },
}

export const INQUIRY_STATE_LABEL: Record<InquiryStateKey, TranslationKey> = {
  // «تعمل», as the state badge says (owner 2026-10-27: «وحد النصوص تبع
  // قائمة تعمل» › «تعمل»).
  site: 'inquiryStateSite',
  maintenance: 'inquiryStateMaintenance',
  parking: 'inquiryStateParking',
  out_of_service: 'inquiryStateOutOfService',
  unrecorded: 'inquiryStateUnrecorded',
}

/** A day's or a ring part's colour: a stay's strong colour, the light grey
 *  of «بدون تسجيل» (owner: «خلي الرمادي في اخر 12 شهر افتح»), or the frame
 *  colour before the unit existed and after today. */
export function inquiryDayColor(state: InquiryStateKey | 'before' | 'future'): string {
  if (state === 'before' || state === 'future') return 'var(--surface)'
  if (state === 'unrecorded') return INQUIRY_STATE_COLORS.unrecorded.fill
  return INQUIRY_STATE_COLORS[state].stroke
}

/** The page's state of a derived equipment state: working = a project, the
 *  workshop states by purpose (unclassified counts as maintenance), and
 *  available = «بدون تسجيل»; null for an unknown value. */
export function inquiryKeyOfEquipmentState(state: unknown): InquiryStateKey | null {
  if (state === 'working') return 'site'
  if (state === 'maintenance' || state === 'unclassified') return 'maintenance'
  if (state === 'parking' || state === 'out_of_service') return state
  if (state === 'available') return 'unrecorded'
  return null
}

/**
 * The small dot of a unit's state beside its code (in the suggestions and
 * the recent searches), named for screen readers; nothing for an unknown
 * state.
 */
export function InquiryStateDot({
  state,
  label,
}: {
  state: unknown
  label: string | null
}) {
  const key = inquiryKeyOfEquipmentState(state)
  if (!key) return null
  return (
    <span
      role="img"
      aria-label={label ?? undefined}
      title={label ?? undefined}
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: INQUIRY_STATE_COLORS[key].stroke }}
    />
  )
}

export function inquiryStateIcon(key: InquiryStateKey, size: number): ReactNode {
  const Icon =
    key === 'site'
      ? MapPin
      : key === 'parking'
        ? ParkingCircle
        : key === 'out_of_service'
          ? Ban
          : key === 'maintenance'
            ? Wrench
            : CircleDashed
  return <Icon size={size} />
}

/** Borderless surface with a soft shadow. */
export const INQUIRY_SURFACE = 'rounded-2xl bg-bg shadow-sm'

/** A box or pill inside a filled card: a lighter shade of that card's own
 *  colour (owner 2026-10-27: «المربعات الي داخل المربعات الملونة … نخليها
 *  الدرجة … الافتح من نفس الكارد الاب»; it was a translucent white that
 *  read as grey). A darker shade (15% of the strong colour) was tried and
 *  set aside: «لا خليها افتح خلاص». */
export function inquiryInnerFill(colors: Pick<InquiryColors, 'fill'>): CSSProperties {
  return { backgroundColor: `color-mix(in srgb, ${colors.fill} 40%, var(--bg))` }
}

/** The stagger of the n-th block of the answer (`.inq-rise`). */
export function inquiryRise(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, 14) * 70}ms` }
}

/** A round tile in a colour's tint with the icon in its strong colour. */
export function InquiryIconTile({
  colors,
  size = 32,
  children,
}: {
  colors: Pick<InquiryColors, 'tint' | 'stroke'>
  size?: number
  children: ReactNode
}) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.tint,
        color: colors.stroke,
      }}
    >
      {children}
    </span>
  )
}

/** A card heading with a neutral icon circle. */
export function InquiryCardTitle({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-hover text-muted"
      >
        {icon}
      </span>
      {children}
    </h3>
  )
}

/** Counts a number up from zero when the answer arrives (straight to the
 *  value for a reader who asked for reduced motion). */
export function useCountUp(value: number, duration = 900): number {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration)
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return shown
}
