import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'

/**
 * A field changed and not saved yet (owner 2026-11-05, «ايش رايك تعلم لون على
 * الحقل الي تعدل, قبل التعديل؟» → «Yes, colour them», then «خليه ازرق»): a
 * light blue border and tint from `--info` on the control, and a blue dot
 * beside its label. An invalid field keeps its red border (`.input[aria-invalid]`
 * is more specific), and focus keeps the primary ring.
 */
export const CHANGED_CONTROL_CLASS =
  'border-[color-mix(in_srgb,var(--info)_55%,transparent)] bg-[var(--info-soft)]'

/** The field's label with the «معدل» dot while it is changed. */
export function ChangedLabel({
  label,
  changed,
}: {
  label: ReactNode
  changed: boolean
}) {
  const { t } = useI18n()
  if (!changed) return <>{label}</>
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--info)]"
      />
      <span className="sr-only">{t('fieldChanged')}</span>
    </span>
  )
}
