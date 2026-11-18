import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Input, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  installmentFinancierFormSchema,
  validateWithSchema,
} from '@/lib/formValidation'
import {
  installmentErrorMessage,
  INSTALLMENT_FINANCIER_NAME_MAX,
} from '@/lib/installments'
import {
  insertInstallmentFinancier,
  updateInstallmentFinancier,
} from '@/lib/installmentsData'
import type {
  InstallmentFinancierFormValues,
  InstallmentFinancierRow,
} from '@/lib/installmentsView'

/**
 * «اضافة جهة» / «تعديل اسم الجهة»: a financier is a name only (a bank, a
 * dealer). Written directly to `installment_financiers` under its RLS
 * (`installments.manage`) and read back; a repeated name shows under the
 * field, a write the policy refused as the form's message.
 */
export function InstallmentFinancierDialog({
  open,
  onOpenChange,
  financier = null,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The financier renamed; null = a new one. */
  financier?: InstallmentFinancierRow | null
  onSaved: (created: boolean) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<TranslationKey | null>(null)
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(financier?.name ?? '')
    setNameError(null)
    setFormError(null)
    setSaving(false)
    // Only the opening resets the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    if (saving) return
    const found = validateWithSchema<InstallmentFinancierFormValues>(
      installmentFinancierFormSchema,
      { name },
    )
    setFormError(null)
    setNameError(found.name ?? null)
    if (found.name) return
    setSaving(true)
    const result = financier
      ? await updateInstallmentFinancier(financier.id, name)
      : await insertInstallmentFinancier(name)
    setSaving(false)
    if (!result.ok) {
      if (result.refused) {
        setFormError('instErrManageRequired')
        return
      }
      const message = installmentErrorMessage(result.error)
      if (message === 'instErrFinancierDuplicate') setNameError(message)
      else setFormError(message)
      return
    }
    onSaved(!financier)
  }

  return (
    <Dialog
      open={open}
      size="sm"
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={financier ? t('instFinancierRename') : t('instFinancierAdd')}
      description={t('instFinancierDialogDesc')}
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('instDialogCancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {formError && <Notice tone="danger">{t(formError)}</Notice>}
        <Field
          name="name"
          label={t('instFinancierName')}
          required
          error={nameError ? t(nameError) : undefined}
        >
          {(control) => (
            <Input
              {...control}
              autoFocus
              maxLength={INSTALLMENT_FINANCIER_NAME_MAX}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
            />
          )}
        </Field>
      </form>
    </Dialog>
  )
}
