import type { ReactNode } from 'react'
import { Edit2 } from 'lucide-react'
import {
  Button,
  DescriptionList,
  Dialog,
  type DescriptionListItem,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'

export interface PartyDetailsSection {
  title: TranslationKey
  items: DescriptionListItem[]
}

export interface PartyDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: TranslationKey
  /** The supplier's or the client's name, bold at the top. */
  heading: ReactNode
  sections: readonly PartyDetailsSection[]
  /** Omitted without the edit key: no «تعديل». */
  onEdit?: () => void
}

/**
 * The read-only facts of a supplier or a client (EM-260, 0175): every
 * reader of the list sees the tax number, the CR, the address, the contacts
 * (and a supplier's bank) here; the lists stay narrow (owner). Empty values
 * show «—»; numbers read left to right.
 */
export function PartyDetailsDialog({
  open,
  onOpenChange,
  title,
  heading,
  sections,
  onEdit,
}: PartyDetailsDialogProps) {
  const { t } = useI18n()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(title)}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          {onEdit && (
            <Button
              variant="primary"
              icon={<Edit2 size={16} aria-hidden="true" />}
              onClick={onEdit}
            >
              {t('edit')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-base font-semibold">{heading}</p>
        {sections.map((section) => (
          <section key={section.title} className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-semibold">{t(section.title)}</h3>
            <DescriptionList columns={2} items={section.items} />
          </section>
        ))}
      </div>
    </Dialog>
  )
}
