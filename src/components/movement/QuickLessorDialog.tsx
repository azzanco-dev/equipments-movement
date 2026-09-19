import { useI18n } from '@/i18n/I18nContext'
import { Button, Dialog, Field, Input } from '@/components/ui'

export interface QuickLessorDraft {
  open: boolean
  name: string
  error: string
}

export const EMPTY_QUICK_LESSOR: QuickLessorDraft = {
  open: false,
  name: '',
  error: '',
}

export interface QuickLessorDialogProps {
  value: QuickLessorDraft
  onChange: (value: QuickLessorDraft) => void
  saving: boolean
  onClose: () => void
  onSave: () => void
}

/** Quick-create for an external supplier, opened from the supplier selector. */
export function QuickLessorDialog({
  value,
  onChange,
  saving,
  onClose,
  onSave,
}: QuickLessorDialogProps) {
  const { t } = useI18n()
  return (
    <Dialog
      open={value.open}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('addNewSupplier')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!value.name.trim()}
            onClick={onSave}
          >
            {saving ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <Field label={t('lessorName')} required error={value.error || undefined}>
        {(control) => (
          <Input
            {...control}
            value={value.name}
            placeholder={t('lessorNamePlaceholder')}
            onChange={(event) =>
              onChange({ ...value, name: event.target.value, error: '' })
            }
            autoFocus
          />
        )}
      </Field>
    </Dialog>
  )
}
