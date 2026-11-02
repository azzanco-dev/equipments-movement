import { useI18n } from '@/i18n/I18nContext'
import { quantityLabel } from '@/lib/sales'

/**
 * The contract quantity of a client PO line («6 اشهر», «400 ساعة») with the
 * thin remaining bar under it. Phase 1 tracks no consumption, so the bar is
 * a PLACEHOLDER drawn full with a muted «المتبقي يتابع لاحقا» (no invented
 * number); a line without a ceiling reads «بدون سقف».
 */
export function QuantityCell({
  quantity,
  unit,
  compact = false,
}: {
  quantity: number | string | null | undefined
  unit: string | null | undefined
  compact?: boolean
}) {
  const { t, lang } = useI18n()
  const label = quantityLabel(quantity, unit, lang)
  if (!label)
    return <span className="text-xs text-muted">{t('clientPoNoQuantity')}</span>
  return (
    <span
      className={`flex min-w-0 flex-col gap-1 ${compact ? 'w-28' : 'w-full'}`}
    >
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-fg">{label}</span>
        {!compact && (
          <span className="text-muted">{t('clientPoRemainingLater')}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
      >
        <span
          className="block h-full w-full rounded-full"
          style={{ backgroundColor: 'var(--chart-stroke-2)' }}
        />
      </span>
    </span>
  )
}
