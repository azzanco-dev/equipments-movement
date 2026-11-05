import { PartyDetailsDialog } from '@/components/parties/PartyDetailsDialog'
import { useI18n } from '@/i18n/I18nContext'
import { formatIban, formatShortAddress } from '@/lib/partyFields'
import type { Lessor } from '@/lib/types'

export interface LessorDetailsDialogProps {
  /** The supplier shown; null closes the dialog. */
  lessor: Lessor | null
  onOpenChange: (open: boolean) => void
  /** Omitted without `lessors.edit`. */
  onEdit?: () => void
}

/** A supplier's facts (EM-260, 0175): «بيانات رسمية», «بيانات الاتصال»,
 *  «بيانات البنك». */
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
      heading={lessor?.name}
      onEdit={onEdit}
      sections={[
        {
          title: 'partyOfficialSection',
          items: [
            { label: t('taxNumber'), value: lessor?.tax_number, dir: 'ltr' },
            {
              label: t('commercialRegister'),
              value: lessor?.commercial_register,
              dir: 'ltr',
            },
            { label: t('address'), value: lessor?.address },
            {
              label: t('shortAddress'),
              value: lessor?.short_address
                ? formatShortAddress(lessor.short_address)
                : null,
              dir: 'ltr',
            },
          ],
        },
        {
          title: 'partyContactSection',
          items: [
            { label: t('contactPerson'), value: lessor?.contact_person },
            {
              label: t('contactNumber'),
              value: lessor?.contact_number,
              dir: 'ltr',
            },
            { label: t('email'), value: lessor?.email, dir: 'ltr' },
          ],
        },
        {
          title: 'partyBankSection',
          items: [
            { label: t('bankName'), value: lessor?.bank_name },
            {
              label: t('iban'),
              value: lessor?.iban ? formatIban(lessor.iban) : null,
              dir: 'ltr',
            },
          ],
        },
      ]}
    />
  )
}
