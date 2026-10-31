import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Alert } from '@/components/Alert'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { Button, Dialog, Field } from '@/components/ui'
import type { TranslationKey } from '@/i18n/translations'
import {
  correctVisitDriver,
  driverCorrectionError,
} from '@/lib/driverCorrection'

/**
 * Migration 0166 (owner 2026-10-31): replaces ONE driver of a project visit —
 * the entry driver (`changeId` null) or the new driver of one change — in
 * place, for `movements.edit_delete`. Not a swap: the swap during an open
 * visit stays «تغيير السائق».
 */
export function DriverCorrectionDialog({
  open,
  onOpenChange,
  entryId,
  changeId,
  currentDriverName,
  loadDrivers,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryId: string
  changeId: string | null
  currentDriverName: string | null
  loadDrivers: (query: string) => Promise<SelectOption[]>
  onSaved: () => void | Promise<void>
}) {
  const { t } = useI18n()
  const [driverId, setDriverId] = useState('')
  const [option, setOption] = useState<SelectOption | null>(null)
  const [fieldError, setFieldError] = useState<TranslationKey | null>(null)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [busy, setBusy] = useState(false)

  // A fresh form every time it opens, for whichever driver it corrects.
  useEffect(() => {
    if (!open) return
    setDriverId('')
    setOption(null)
    setFieldError(null)
    setError(null)
  }, [open, entryId, changeId])

  const save = async () => {
    if (!driverId) {
      setFieldError('selectDriver')
      return
    }
    setBusy(true)
    setError(null)
    const { error: rpcError } = await correctVisitDriver(supabase, {
      entryId,
      changeId,
      driverId,
    })
    setBusy(false)
    if (rpcError) {
      const failure = driverCorrectionError(rpcError.message)
      if (failure.target === 'driver_id') setFieldError(failure.key)
      else setError(failure.key)
      return
    }
    onOpenChange(false)
    await onSaved()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('driverCorrectionTitle')}
      description={t('driverCorrectionDesc')}
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
          <Button variant="primary" loading={busy} onClick={save}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted">{t('driverCorrectionCurrent')}</p>
          <p className="break-words font-medium">
            {currentDriverName ? (
              <bdi>{currentDriverName}</bdi>
            ) : (
              <span className="font-normal text-muted">—</span>
            )}
          </p>
        </div>
        {error && <Alert type="error">{t(error)}</Alert>}
        <Field
          label={t('driverCorrectionNew')}
          name="driver_id"
          required
          error={fieldError && t(fieldError)}
        >
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={driverId}
              selectedOption={option}
              onChange={(value, next) => {
                setDriverId(value)
                setOption(next)
                setFieldError(null)
              }}
              loadOptions={loadDrivers}
              placeholder={t('selectDriver')}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
