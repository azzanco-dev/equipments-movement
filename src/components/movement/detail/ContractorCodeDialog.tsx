import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import {
  CONTRACTOR_CODE_MAX_LENGTH,
  contractorCodeErrorKey,
  contractorCodeUnchanged,
  isValidContractorCode,
  normalizeContractorCode,
} from '@/lib/contractorCodeEdit'
import { Button, Dialog, Field, Input, Notice } from '@/components/ui'

export interface ContractorCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  logId: string
  currentCode: string | null
  /** Refetches the movement after a successful save. */
  onSaved: () => Promise<void>
}

/**
 * wave7-A — the foreman's edit of the contractor code on HIS OWN open site
 * ENTRY (migration 0093), moved out of `MovementDetail` unchanged. The
 * database is authoritative: `update_entry_contractor_code` re-checks the
 * role, the ownership of the entry and that the visit is still open, and it
 * writes that single column only. The audit row is written by the existing
 * `audit_entry_exit_logs` trigger with the foreman as the actor.
 */
export function ContractorCodeDialog({
  open,
  onOpenChange,
  logId,
  currentCode,
  onSaved,
}: ContractorCodeDialogProps) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill from the saved code every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setValue(currentCode ?? '')
    setError(null)
  }, [open, currentCode])

  const save = async () => {
    if (!isValidContractorCode(value)) {
      setError(t('contractorCodeTooLong'))
      return
    }
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc(
      'update_entry_contractor_code',
      {
        p_log_id: logId,
        p_code: normalizeContractorCode(value),
      },
    )
    setBusy(false)
    if (rpcError) {
      setError(t(contractorCodeErrorKey(rpcError.message)))
      return
    }
    onOpenChange(false)
    await onSaved()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('editContractorCode')}
      description={t('dialogDescContractorCodeEdit')}
      size="sm"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={contractorCodeUnchanged(value, currentCode)}
            onClick={save}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label={t('contractorEquipmentCode')}>
          {(control) => (
            <Input
              {...control}
              type="text"
              dir="ltr"
              value={value}
              maxLength={CONTRACTOR_CODE_MAX_LENGTH}
              placeholder={t('contractorCodePlaceholder')}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
