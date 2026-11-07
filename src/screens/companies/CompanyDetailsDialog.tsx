import { Briefcase, FileText, Phone } from 'lucide-react'
import { PartyDetailsDialog } from '@/components/parties/PartyDetailsDialog'
import { useI18n } from '@/i18n/I18nContext'
import {
  COMPANY_COMPLETENESS_FIELDS,
  partyCompleteness,
} from '@/lib/partyCompleteness'
import { formatShortAddress, telHref } from '@/lib/partyFields'
import type { Company } from '@/lib/types'

export interface CompanyDetailsDialogProps {
  /** The company shown; null closes the dialog. */
  company: Company | null
  onOpenChange: (open: boolean) => void
  /** Omitted without `companies_projects.edit`. */
  onEdit?: () => void
}

/** A client's facts (EM-260, 0175): both names, «بيانات رسمية» and
 *  «بيانات الاتصال», in the redesigned dialog (owner 2026-11-05). */
export function CompanyDetailsDialog({
  company,
  onOpenChange,
  onEdit,
}: CompanyDetailsDialogProps) {
  const { t } = useI18n()
  return (
    <PartyDetailsDialog
      open={company !== null}
      onOpenChange={onOpenChange}
      title="companyDetailsDialogTitle"
      size="lg"
      icon={<Briefcase size={22} />}
      heading={company?.name_ar}
      // Owner 2026-11-05 «اسم الشركة العربي والانقليزي … مفروض يكون تحت
      // بعض»: the English name on the line under the Arabic one, same edge
      // (the line keeps the page direction; only the name reads LTR).
      subheading={company?.name_en && <bdi dir="ltr">{company.name_en}</bdi>}
      completeness={
        company
          ? partyCompleteness(company, COMPANY_COMPLETENESS_FIELDS)
          : undefined
      }
      onEdit={onEdit}
      sections={[
        {
          title: 'partyOfficialSection',
          icon: <FileText size={16} />,
          items: [
            {
              label: t('commercialRegister'),
              value: company?.commercial_register,
              ltr: true,
              copy: true,
            },
            {
              label: t('taxNumber'),
              value: company?.tax_number,
              ltr: true,
              copy: true,
            },
            {
              label: t('shortAddress'),
              value: company?.short_address,
              display: company?.short_address
                ? formatShortAddress(company.short_address)
                : undefined,
              ltr: true,
              copy: true,
            },
            { label: t('address'), value: company?.address, wide: true },
          ],
        },
        {
          title: 'partyContactSection',
          icon: <Phone size={16} />,
          items: [
            { label: t('contactPerson'), value: company?.contact_person },
            {
              label: t('contactNumber'),
              value: company?.contact_number,
              ltr: true,
              copy: true,
              href: telHref(company?.contact_number),
            },
            {
              label: t('email'),
              value: company?.email,
              ltr: true,
              copy: true,
              href: company?.email ? `mailto:${company.email}` : undefined,
              wide: true,
            },
          ],
        },
      ]}
    />
  )
}
