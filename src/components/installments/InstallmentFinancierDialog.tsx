import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Input, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatIban } from '@/lib/partyFields'
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
import { BankAccountFields } from './BankAccountFields'

/**
 * «اضافة جهة» / «تعديل الجهة»: a financier is a name (a bank, a dealer) and,
 * since 0208, an optional account — the bank of the banks list and the
 * IBAN, as the suppliers have them (owner 2026-11-21). Written directly to
 * `installment_financiers` under its RLS (`installments.manage`) and read
 * back; a repeated name, a bad IBAN or a bank gone from the list shows
 * under its field, a write the policy refused as the form's message.
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
  const [bankName, setBankName] = useState('')
  const [iban, setIban] = useState('')
  const [nameError, setNameError] = useState<TranslationKey | null>(null)
  const [bankError, setBankError] = useState<TranslationKey | null>(null)
  const [ibanError, setIbanError] = useState<TranslationKey | null>(null)
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(financier?.name ?? '')
    setBankName(financier?.bank_name ?? '')
    setIban(financier?.iban ? formatIban(financier.iban) : '')
    setNameError(null)
    setBankError(null)
    setIbanError(null)
    setFormError(null)
    setSaving(false)
    // Only the opening resets the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    if (saving) return
    const found = validateWithSchema<InstallmentFinancierFormValues>(
      installmentFinancierFormSchema,
      { name, bank_name: bankName, iban },
    )
    setFormError(null)
    setNameError(found.name ?? null)
    setBankError(found.bank_name ?? null)
    setIbanError(found.iban ?? null)
    if (found.name || found.bank_name || found.iban) return
    setSaving(true)
    const input = { name, bankName, iban }
    const result = financier
      ? await updateInstallmentFinancier(financier.id, input)
      : await insertInstallmentFinancier(input)
    setSaving(false)
    if (!result.ok) {
      if (result.refused) {
        setFormError('instErrManageRequired')
        return
      }
      const message = installmentErrorMessage(result.error)
      if (message === 'instErrFinancierDuplicate') setNameError(message)
      else if (message === 'instErrBank') setBankError(message)
      else if (message === 'instErrIban') setIbanError(message)
      else setFormError(message)
      return
    }
    onSaved(!financier)
  }

  return (
    <Dialog
      open={open}
      size="md"
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={financier ? t('instFinancierEdit') : t('instFinancierAdd')}
      description={t('instFinancierDialogAccountDesc')}
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
        <BankAccountFields
          bankName={bankName}
          iban={iban}
          onBankName={(value) => {
            setBankName(value)
            setBankError(null)
          }}
          onIban={(value) => {
            setIban(value)
            setIbanError(null)
          }}
          bankError={bankError}
          ibanError={ibanError}
          ibanHint={t('instFinancierIbanHint')}
        />
      </form>
    </Dialog>
  )
}
