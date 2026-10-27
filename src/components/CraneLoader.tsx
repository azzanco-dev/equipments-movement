import { useI18n } from '@/i18n/I18nContext'

/**
 * The start-up loader (owner 2026-10-27: «ابغا اغيره لكرين ايكون مثلا،
 * متحرك»): a tower crane drawn in the page's tokens — its trolley runs
 * along the jib while the cable lowers and raises the hook, and the load
 * sways a little. Still for a reader who asked for reduced motion
 * (`.crane-*` in src/index.css).
 */
export function CraneLoader({ size = 104 }: { size?: number }) {
  const { t } = useI18n()
  return (
    <svg
      role="status"
      aria-label={t('loading')}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fg"
    >
      {/* Ground and the mast's foot. */}
      <path d="M18 104h84" strokeWidth="2.5" style={{ stroke: 'var(--border)' }} />
      <path d="M34 104h20" strokeWidth="3" />

      {/* The mast: two rails and its lattice. */}
      <path d="M40 104V30M48 104V30" strokeWidth="2.5" />
      <path
        d="M40 96l8-8M40 88l8 0M40 88l8-8M40 80l8 0M40 80l8-8M40 72l8 0M40 72l8-8M40 64l8 0M40 64l8-8M40 56l8 0M40 56l8-8M40 48l8 0M40 48l8-8M40 40l8 0M40 40l8-8"
        strokeWidth="1.2"
        style={{ opacity: 0.55 }}
      />

      {/* The peak and its ties to the jib ends. */}
      <path d="M44 30V14M44 14L16 26M44 14L104 26" strokeWidth="1.5" />

      {/* The jib and the counter-jib, the counterweight and the cab. */}
      <path d="M14 30h96" strokeWidth="3" />
      <rect x="16" y="31" width="12" height="9" rx="1.5" strokeWidth="2" style={{ fill: 'var(--chart-4)' }} />
      <rect x="49" y="31" width="9" height="8" rx="1.5" strokeWidth="2" style={{ fill: 'var(--chart-3)' }} />

      {/* The trolley runs along the jib carrying the cable, hook and load. */}
      <g className="crane-trolley">
        <rect x="60" y="28" width="10" height="5" rx="1.5" strokeWidth="2" style={{ fill: 'var(--bg)' }} />
        <g className="crane-swing">
          <rect className="crane-cable" x="64.4" y="33" width="1.2" height="26" stroke="none" style={{ fill: 'currentColor' }} />
          <g className="crane-hook">
            <path d="M65 59v4a3 3 0 1 1-3-3" strokeWidth="2" />
            <rect
              x="56"
              y="66"
              width="18"
              height="12"
              rx="2"
              strokeWidth="2"
              style={{ fill: 'var(--chart-2)', stroke: 'var(--chart-stroke-2)' }}
            />
          </g>
        </g>
      </g>
    </svg>
  )
}
