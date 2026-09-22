import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Alert } from '@/components/Alert'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import {
  MOVEMENT_NOTES_MAX_LENGTH,
  isValidMovementNotes,
  movementAdminErrorKey,
  movementEditUnchanged,
  normalizeMovementNotes,
  type MovementDriverEditMode,
} from '@/lib/movementAdmin'
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui'

export interface MovementEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  movementId: string
  notes: string | null | undefined
  driverId: string | null | undefined
  driverName: string | null | undefined
  /** Which driver path applies — see `movementDriverEditMode`. */
  driverMode: MovementDriverEditMode
  /**
   * The ENTRY that owns the append-only driver-change history; required when
   * `driverMode` is `driver_change`.
   */
  driverEntryId: string | null
  loadDrivers: (query: string) => Promise<SelectOption[]>
  /** Refetches the movement after a successful (or partial) save. */
  onSaved: () => void | Promise<void>
}

/**
 * wave6-J3 — admin edit of a movement's note and driver.
 *
 * The database is authoritative. The note goes through
 * `admin_update_movement_details` (migration 0104), which writes `notes`,
 * `driver_id` and `driver_name` and nothing else. The driver of an OPEN site
 * visit is never rewritten: that change goes through the append-only
 * `change_active_movement_driver` (migration 0040) exactly as the visit card
 * does, so the entry driver stays immutable and every change stays auditable.
 *
 * The two writes are separate statements, so a driver failure after the note
 * was already stored is reported as a partial success — never as a total
 * failure — and the movement is refetched either way.
 */
export function MovementEditDialog({
  open,
  onOpenChange,
  movementId,
  notes,
  driverId,
  driverName,
  driverMode,
  driverEntryId,
  loadDrivers,
  onSaved,
}: MovementEditDialogProps) {
  const { t } = useI18n()
  const [notesValue, setNotesValue] = useState('')
  const [driver, setDriver] = useState<SelectOption | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset from the movement every time the dialog opens, so a cancelled edit
  // never leaves stale values behind.
  useEffect(() => {
    if (!open) return
    setNotesValue(notes ?? '')
    setDriver(
      driverId && driverName ? { value: driverId, label: driverName } : null,
    )
    setError(null)
  }, [open, notes, driverId, driverName])

  const driverEditable = driverMode !== 'unsupported'
  const selectedDriverId = driver?.value ?? null
  const driverChanged = Boolean(
    driverEditable &&
    selectedDriverId &&
    selectedDriverId !== (driverId ?? null),
  )
  const unchanged = movementEditUnchanged({
    notes: notesValue,
    currentNotes: notes,
    driverId: driverEditable ? selectedDriverId : null,
    currentDriverId: driverId,
  })

  const save = async () => {
    if (!isValidMovementNotes(notesValue)) {
      setError(t('movementNotesTooLong'))
      return
    }
    setBusy(true)
    setError(null)

    const notesChanged =
      normalizeMovementNotes(notesValue) !== (notes?.trim() || null)
    // An open site visit keeps its entry driver: the append-only RPC handles
    // the driver, the details endpoint handles the note only.
    const appendOnlyDriver = driverChanged && driverMode === 'driver_change'
    let failureKey: string | null = null

    try {
      if (notesChanged || (driverChanged && !appendOnlyDriver)) {
        const { data: session } = await supabase.auth.getSession()
        const response = await fetch(`/api/movements/${movementId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${session.session?.access_token ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'details',
            notes: normalizeMovementNotes(notesValue),
            driver_id: appendOnlyDriver
              ? null
              : driverChanged
                ? selectedDriverId
                : null,
            driver_name: null,
          }),
        })
        if (!response.ok) {
          const result = (await response.json().catch(() => null)) as {
            error?: string
          } | null
          failureKey = t(movementAdminErrorKey(result?.error, 'update'))
        }
      }

      if (!failureKey && appendOnlyDriver && driverEntryId) {
        const { error: changeError } = await supabase.rpc(
          'change_active_movement_driver',
          {
            p_entry_log_id: driverEntryId,
            p_new_driver_id: selectedDriverId,
            p_note: null,
          },
        )
        // Raw PostgreSQL text never reaches the user.
        if (changeError) failureKey = t('driverChangeFailed')
      }
    } catch (cause) {
      console.error('Movement edit request failed', cause)
      failureKey = t('movementEditFailed')
    } finally {
      setBusy(false)
    }

    // Refetch either way: part of the edit may already be stored.
    await onSaved()
    if (failureKey) {
      setError(failureKey)
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={t('editMovement')}
      description={t('movementEditDialogDesc')}
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={unchanged}
            onClick={save}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert type="error">{error}</Alert>}
        <Field label={t('notes')}>
          {(control) => (
            <Textarea
              {...control}
              value={notesValue}
              maxLength={MOVEMENT_NOTES_MAX_LENGTH}
              placeholder={t('notesPlaceholder')}
              onChange={(event) => setNotesValue(event.target.value)}
            />
          )}
        </Field>
        {driverEditable ? (
          <>
            <Field label={t('driverName')}>
              {() => (
                <AsyncSearchSelect
                  value={selectedDriverId ?? ''}
                  selectedOption={driver}
                  onChange={(_, option) => setDriver(option)}
                  loadOptions={loadDrivers}
                  placeholder={t('selectDriver')}
                />
              )}
            </Field>
            {driverMode === 'driver_change' && (
              <Notice tone="info" size="compact">
                {t('movementEditOpenVisitDriverHint')}
              </Notice>
            )}
          </>
        ) : (
          <Notice tone="info" size="compact">
            {t('movementAdminDriverNotSupported')}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}
