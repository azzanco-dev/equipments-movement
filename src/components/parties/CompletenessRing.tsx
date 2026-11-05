import { Tooltip } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { Completeness, CompletenessTone } from '@/lib/partyCompleteness'

// Light shades (owner 2026-11-05, «خلي الالوان فاتحة»): --warning read as
// red next to --danger, so the ring has its own soft tokens in index.css.
const TONE_COLOR: Record<CompletenessTone, string> = {
  danger: 'var(--progress-low)',
  warning: 'var(--progress-mid)',
  success: 'var(--progress-high)',
}

const SIZE = 32
const STROKE = 4
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * The data-completeness ring of a list row (owner 2026-11-05, suppliers
 * first): a thin circle filled to the share of the filled fields, red /
 * yellow / green by `completenessTone`, the percent in the middle, and the
 * missing fields in its tooltip. Screen readers get one sentence.
 */
export function CompletenessRing({ value }: { value: Completeness }) {
  const { t } = useI18n()
  const color = TONE_COLOR[value.tone]
  const summary = t('completenessSummary')
    .replace('{percent}', String(value.percent))
    .replace('{filled}', String(value.filled))
    .replace('{total}', String(value.total))
  const tooltip = (
    <div className="max-w-60 space-y-1 text-start">
      <div className="font-semibold">{summary}</div>
      {value.missing.length > 0 && (
        <div>
          {t('completenessMissing')}{' '}
          {value.missing.map((key) => t(key)).join('، ')}
        </div>
      )}
    </div>
  )
  return (
    <Tooltip content={tooltip}>
      <span
        role="img"
        tabIndex={0}
        aria-label={summary}
        className="relative inline-flex shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden="true"
          className="-rotate-90"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--border)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - value.percent / 100)}
          />
        </svg>
        <span
          aria-hidden="true"
          className="absolute text-[10px] font-semibold tabular-nums text-[var(--fg)]"
        >
          {value.percent}
        </span>
      </span>
    </Tooltip>
  )
}
