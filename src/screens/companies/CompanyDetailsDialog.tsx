import { PartyDetailsDialog } from '@/components/parties/PartyDetailsDialog'
import { useI18n } from '@/i18n/I18nContext'
import { formatShortAddress } from '@/lib/partyFields'
import type { Company } from '@/lib/types'

export interface CompanyDetailsDialogProps {
  /** The company shown; null closes the dialog. */
  company: Company | null
  onOpenChange: (open: boolean) => void
  /** Omitted without `companies_projects.edit`. */
  onEdit?: () => void
}

/** A client's facts (EM-260, 0175): both names, «بيانات رسمية» and
 *  «بيانات الاتصال». */
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
      heading={
        company && (
          <>
            {company.name_ar}
            <span className="block text-sm font-normal text-muted" dir="ltr">
              {company.name_en}
            </span>
          </>
        )
      }
      onEdit={onEdit}
      sections={[
        {
          title: 'partyOfficialSection',
          items: [
            { label: t('taxNumber'), value: company?.tax_number, dir: 'ltr' },
            {
              label: t('commercialRegister'),
              value: company?.commercial_register,
              dir: 'ltr',
            },
            { label: t('city'), value: company?.city },
            { label: t('address'), value: company?.address },
            {
              label: t('shortAddress'),
              value: company?.short_address
                ? formatShortAddress(company.short_address)
                : null,
              dir: 'ltr',
            },
          ],
        },
        {
          title: 'partyContactSection',
          items: [
            { label: t('contactPerson'), value: company?.contact_person },
            {
              label: t('contactNumber'),
              value: company?.contact_number,
              dir: 'ltr',
            },
            { label: t('email'), value: company?.email, dir: 'ltr' },
          ],
        },
      ]}
    />
  )
}
