import { Badge } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { quotationValidity } from '@/lib/quotations'

/**
 * «ساري» / «منتهي» beside «صالح لغاية» (owner 2026-11-17, «بادج ساري منتهي
 * حسب الصلاحية»): green while the Saudi today is on or before the date, grey
 * after it. Display only — computed from the date on the screen; nothing is
 * stored, filtered or locked by it, and the PDF does not print it.
 */
export function QuotationValidityBadge({
  validUntil,
}: {
  validUntil: string | null | undefined
}) {
  const { t } = useI18n()
  const validity = quotationValidity(validUntil)
  if (!validity) return null
  return (
    <Badge tone={validity === 'valid' ? 'success' : 'neutral'} size="sm">
      {t(
        validity === 'valid'
          ? 'quotationValidityValid'
          : 'quotationValidityExpired',
      )}
    </Badge>
  )
}
