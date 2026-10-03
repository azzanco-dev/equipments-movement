import { Fragment } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from '@/components/ui'
import {
  previousCodeEntries,
  type EquipmentCodeChange,
} from '@/lib/equipmentCodeHistory'

export interface PreviousCodesLineProps {
  changes: readonly EquipmentCodeChange[]
  currentCode: string | null | undefined
  /** The history read failed: say so instead of hiding the line. */
  error?: boolean
  className?: string
}

/**
 * «ارقام سابقة: A115 (حتى 20/09/2026)» under an equipment's identity, on the
 * equipment detail page and the inquiry page. Hidden when the unit never
 * changed its code. Codes are isolated LTR runs; the day is Saudi time.
 */
export function PreviousCodesLine({
  changes,
  currentCode,
  error = false,
  className,
}: PreviousCodesLineProps) {
  const { t } = useI18n()
  if (error)
    return (
      <p className={cn('text-sm text-muted', className)} role="status">
        {t('previousCodesLoadError')}
      </p>
    )
  const entries = previousCodeEntries(changes, currentCode)
  if (entries.length === 0) return null
  return (
    <p className={cn('text-sm text-muted', className)}>
      <span>{t('previousCodesLabel')}</span>{' '}
      {entries.map((entry, index) => (
        <Fragment key={entry.code}>
          {index > 0 && ' · '}
          <bdi dir="ltr" className="font-medium text-fg">
            {entry.code}
          </bdi>
          {entry.until && (
            <>
              {' ('}
              {t('previousCodeUntil').replace('{date}', entry.until)}
              {')'}
            </>
          )}
        </Fragment>
      ))}
    </p>
  )
}
