import { ArrowLeft, ArrowRight, FileText } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { AppLink, cn } from '@/components/ui'
import {
  INQUIRY_STATE_COLORS,
  INQUIRY_SURFACE,
  InquiryCardTitle,
  inquiryRise,
} from './inquiryStyle'

/** The PO of the unit's open project visit (`purchasing_site_units`):
 *  null when the unit is inside a project on no PO. */
export type InquiryPo = { id: string; number: string } | null

/**
 * A small card under the equipment facts (owner 2026-10-27: «شيل بادج
 * الPO», then «خليه في كرت مصغر يسار تحت بيانات المعدة»): the PO the unit
 * sits on in its current project, a link to it, or «بدون PO». The screen
 * shows it only to `purchasing.view` readers and only while the unit is
 * inside a project.
 */
export function InquiryPoCard({ po, index }: { po: InquiryPo; index: number }) {
  const { t, lang } = useI18n()
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight
  return (
    <section className={cn(INQUIRY_SURFACE, 'inq-rise space-y-3 p-4')} style={inquiryRise(index)}>
      <InquiryCardTitle icon={<FileText size={14} />}>{t('inquiryPoTitle')}</InquiryCardTitle>
      {po ? (
        <AppLink
          href={`/purchasing/${po.id}`}
          className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:brightness-95"
          style={{ backgroundColor: INQUIRY_STATE_COLORS.site.fill }}
        >
          <bdi dir="ltr" className="font-bold tabular-nums">
            {po.number}
          </bdi>
          <Arrow size={16} aria-hidden="true" className="text-muted" />
        </AppLink>
      ) : (
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ backgroundColor: INQUIRY_STATE_COLORS.maintenance.fill }}
        >
          <p className="text-sm font-semibold">{t('inquiryNoPo')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('inquiryNoPoDesc')}</p>
        </div>
      )}
    </section>
  )
}
