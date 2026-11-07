import { Building2, FileText, Landmark, Phone } from 'lucide-react'
import { PartyDetailsDialog } from '@/components/parties/PartyDetailsDialog'
import { BankLogo } from '@/components/banks/BankLogo'
import { useI18n } from '@/i18n/I18nContext'
import {
  LESSOR_COMPLETENESS_FIELDS,
  partyCompleteness,
} from '@/lib/partyCompleteness'
import { formatIban, formatShortAddress, telHref } from '@/lib/partyFields'
import type { Lessor } from '@/lib/types'

export interface LessorDetailsDialogProps {
  /** The supplier shown; null closes the dialog. */
  lessor: Lessor | null
  onOpenChange: (open: boolean) => void
  /** Omitted without `lessors.edit`. */
  onEdit?: () => void
}

/** A supplier's facts (EM-260, 0175): «بيانات رسمية», «بيانات الاتصال»,
 *  «بيانات البنك», in the redesigned dialog (owner 2026-11-05). */
export function LessorDetailsDialog({
  lessor,
  onOpenChange,
  onEdit,
}: LessorDetailsDialogProps) {
  const { t } = useI18n()
  return (
    <PartyDetailsDialog
      open={lessor !== null}
      onOpenChange={onOpenChange}
      title="lessorDetailsDialogTitle"
      size="lg"
      icon={<Building2 size={22} />}
      heading={lessor?.name}
      completeness={
        lessor
          ? partyCompleteness(lessor, LESSOR_COMPLETENESS_FIELDS)
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
              value: lessor?.commercial_register,
              ltr: true,
              copy: true,
            },
            {
              label: t('taxNumber'),
              value: lessor?.tax_number,
              ltr: true,
              copy: true,
            },
            {
              label: t('shortAddress'),
              value: lessor?.short_address,
              display: lessor?.short_address
                ? formatShortAddress(lessor.short_address)
                : undefined,
              ltr: true,
              copy: true,
            },
            { label: t('address'), value: lessor?.address, wide: true },
          ],
        },
        {
          title: 'partyContactSection',
          icon: <Phone size={16} />,
          items: [
            { label: t('contactPerson'), value: lessor?.contact_person },
            {
              label: t('contactNumber'),
              value: lessor?.contact_number,
              ltr: true,
              copy: true,
              href: telHref(lessor?.contact_number),
            },
            {
              label: t('email'),
              value: lessor?.email,
              ltr: true,
              copy: true,
              href: lessor?.email ? `mailto:${lessor.email}` : undefined,
              wide: true,
            },
          ],
        },
        {
          title: 'partyBankSection',
          icon: <Landmark size={16} />,
          items: [
            {
              label: t('bankName'),
              value: lessor?.bank_name,
              icon: lessor?.bank_name ? (
                <BankLogo name={lessor.bank_name} size="md" />
              ) : undefined,
            },
            {
              label: t('iban'),
              value: lessor?.iban,
              display: lessor?.iban ? formatIban(lessor.iban) : undefined,
              ltr: true,
              copy: true,
            },
          ],
        },
      ]}
    />
  )
}
