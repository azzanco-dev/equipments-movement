import { useEffect, useState, type ReactNode } from 'react'
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import {
  installmentReasonFormSchema,
  validateWithSchema,
} from '@/lib/formValidation'
import {
  installmentErrorMessage,
  INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS,
  INSTALLMENT_REASON_MAX,
} from '@/lib/installments'
import {
  cancelInstallmentContract,
  voidInstallmentPayment,
} from '@/lib/installmentsData'
import {
  installmentErrorToken,
  type InstallmentContractRow,
  type InstallmentPaymentRow,
  type InstallmentReasonFormValues,
  type InstallmentUnit,
} from '@/lib/installmentsView'
import type { RpcResult } from '@/lib/purchasingData'
import { Money, UnitTags } from './cells'

/**
 * The void-payment and cancel-contract dialogs (the approved /ui-kit
 * pieces): what is affected, then a REQUIRED reason of at most 500
 * characters. The database decides (`void_installment_payment`,
 * `cancel_installment_contract`, `installments.manage`); a refusal shows its
 * mapped message here and asks the page to refetch.
 */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  summary,
  confirmLabel,
  onSubmit,
  onDone,
  onRefused,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  summary: ReactNode
  confirmLabel: string
  onSubmit: (reason: string) => Promise<RpcResult<null>>
  onDone: () => void
  /** Refused for a reason other than the reason itself. */
  onRefused?: () => void
}) {
  const { t } = useI18n()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<TranslationKey | null>(null)
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setReason('')
    setError(null)
    setFormError(null)
    setSaving(false)
  }, [open])

  const submit = async () => {
    if (saving) return
    const found = validateWithSchema<InstallmentReasonFormValues>(
      installmentReasonFormSchema,
      { reason },
    )
    setFormError(null)
    setError(found.reason ?? null)
    if (found.reason) return
    setSaving(true)
    const result = await onSubmit(reason)
    setSaving(false)
    if (result.error) {
      if (installmentErrorToken(result.error) === 'reason_required')
        setError('instErrReasonRequired')
      else {
        setFormError(installmentErrorMessage(result.error))
        onRefused?.()
      }
      return
    }
    onDone()
  }

  return (
    <Dialog
      open={open}
      size="sm"
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('instBackOut')}
          </Button>
          <Button variant="danger" loading={saving} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {formError && <Notice tone="danger">{t(formError)}</Notice>}
        <div className="rounded-lg border bg-surface p-3 text-sm">
          {summary}
        </div>
        <Field
          name="reason"
          label={t('instReason')}
          required
          error={error ? t(error) : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={INSTALLMENT_REASON_MAX}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

/** «الغاء سداد»: the amount goes back on the installments it covered and
 *  the payment stays in the list, voided. */
export function VoidInstallmentPaymentDialog({
  payment,
  contractNumber,
  onOpenChange,
  onDone,
  onRefused,
}: {
  /** The payment voided; null = the dialog is closed. */
  payment: InstallmentPaymentRow | null
  contractNumber: string
  onOpenChange: (open: boolean) => void
  onDone: () => void
  onRefused?: () => void
}) {
  const { t } = useI18n()
  return (
    <ReasonDialog
      open={payment !== null}
      onOpenChange={onOpenChange}
      title={t('instVoidTitle')}
      description={t('instVoidDesc')}
      confirmLabel={t('instVoidConfirm')}
      onSubmit={(reason) =>
        payment
          ? voidInstallmentPayment(payment.id, reason)
          : Promise.resolve({ data: null, error: null })
      }
      onDone={onDone}
      onRefused={onRefused}
      summary={
        payment && (
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <bdi dir="ltr">{contractNumber}</bdi> ·{' '}
              <bdi dir="ltr">{formatDate(payment.paid_on)}</bdi> ·{' '}
              {t(INSTALLMENT_PAYMENT_METHOD_LABEL_KEYS[payment.method])}
            </span>
            <Money value={payment.amount} className="font-semibold" />
          </span>
        )
      }
    />
  )
}

/** «الغاء العقد»: for a contract entered by mistake only; refused once a
 *  payment is posted, and the cancelled contract stays in the list. */
export function CancelInstallmentContractDialog({
  open,
  onOpenChange,
  contract,
  units,
  onDone,
  onRefused,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contract: Pick<
    InstallmentContractRow,
    'id' | 'contract_number' | 'description' | 'equipment_count'
  >
  units: readonly InstallmentUnit[]
  onDone: () => void
  onRefused?: () => void
}) {
  const { t } = useI18n()
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('instCancelTitle')}
      description={t('instCancelDesc')}
      confirmLabel={t('instCancelTitle')}
      onSubmit={(reason) => cancelInstallmentContract(contract.id, reason)}
      onDone={onDone}
      onRefused={onRefused}
      summary={
        <span className="flex flex-col gap-1">
          <span className="font-semibold">{contract.description}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <bdi dir="ltr">{contract.contract_number}</bdi>
            {contract.equipment_count > 0 && (
              <UnitTags units={units} count={contract.equipment_count} />
            )}
          </span>
        </span>
      }
    />
  )
}
