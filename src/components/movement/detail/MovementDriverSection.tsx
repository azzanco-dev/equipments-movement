import { useState } from 'react'
import { Phone, RefreshCw, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { formatDateTime } from '@/lib/dateFormat'
import type { MovementDriverChange } from '@/lib/types'
import {
  Button,
  Field,
  InfoGrid,
  Input,
  Notice,
  SectionHeader,
  type InfoGridItem,
} from '@/components/ui'

export interface MovementDriverSectionProps {
  /** Display name of the current driver (latest append on an open ENTRY,
   *  otherwise the row's driver record, otherwise the legacy snapshot). */
  driverName: string | null
  /** Label for the name item: "current driver" once the driver was changed
   *  during the visit, "driver name" otherwise. */
  nameLabel: string
  mobileNumber: string | null
  /** The ENTRY whose append-only driver changes are shown; `null` hides the
   *  history (no paired ENTRY found). */
  entryLogId: string | null
  changes: MovementDriverChange[]
  /** Open site ENTRY and a role that may record a driver change. The
   *  database function re-checks the role and that the visit is open. */
  canChangeDriver: boolean
  loadDrivers: (query: string) => Promise<SelectOption[]>
  /** Refetches the movement after a successful change. */
  onChanged: () => Promise<void>
}

/**
 * wave7-A — driver section of the movement detail page: the current driver
 * (name + tappable mobile), the append-only "change driver" form, and the
 * change history of the visit. The original entry driver stays immutable;
 * `change_active_movement_driver` appends a row and is authoritative.
 */
export function MovementDriverSection({
  driverName,
  nameLabel,
  mobileNumber,
  entryLogId,
  changes,
  canChangeDriver,
  loadDrivers,
  onChanged,
}: MovementDriverSectionProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [newDriverId, setNewDriverId] = useState('')
  const [newDriverOption, setNewDriverOption] = useState<SelectOption | null>(
    null,
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changeDriver = async () => {
    if (!entryLogId || !newDriverId) return
    setBusy(true)
    setError(null)
    const { error: changeError } = await supabase.rpc(
      'change_active_movement_driver',
      {
        p_entry_log_id: entryLogId,
        p_new_driver_id: newDriverId,
        p_note: note.trim() || null,
      },
    )
    setBusy(false)
    if (changeError) {
      setError(t('driverChangeFailed'))
      return
    }
    setOpen(false)
    setNewDriverId('')
    setNewDriverOption(null)
    setNote('')
    await onChanged()
  }

  const items: InfoGridItem[] = [
    {
      key: 'driverName',
      icon: <User size={16} />,
      label: nameLabel,
      value: driverName,
    },
    {
      key: 'driverMobile',
      icon: <Phone size={16} />,
      label: t('mobileNumber'),
      dir: 'ltr',
      value: mobileNumber ? (
        <a
          href={`tel:${mobileNumber}`}
          className="select-text underline-offset-2 hover:underline"
        >
          {mobileNumber}
        </a>
      ) : null,
    },
  ]

  return (
    <section className="space-y-3">
      <SectionHeader
        title={t('movementSectionDriver')}
        action={
          canChangeDriver && entryLogId ? (
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw size={14} />}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {t('changeDriver')}
            </Button>
          ) : undefined
        }
      />
      <InfoGrid items={items} columns={2} />

      {open && canChangeDriver && entryLogId && (
        <div className="space-y-3 rounded-lg border bg-surface p-4">
          <Field label={t('newDriver')} required>
            {() => (
              <AsyncSearchSelect
                value={newDriverId}
                selectedOption={newDriverOption}
                onChange={(value, option) => {
                  setNewDriverId(value)
                  setNewDriverOption(option)
                }}
                loadOptions={loadDrivers}
                placeholder={t('selectDriver')}
              />
            )}
          </Field>
          <Field label={t('notes')}>
            {(control) => (
              <Input
                {...control}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('notesPlaceholder')}
              />
            )}
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!newDriverId}
              loading={busy}
              onClick={changeDriver}
            >
              {t('save')}
            </Button>
          </div>
        </div>
      )}

      {entryLogId && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted">
            {t('driverChangeHistory')}
          </h4>
          {changes.length === 0 ? (
            <p className="text-sm text-muted">{t('noDriverChanges')}</p>
          ) : (
            <ul className="space-y-2">
              {changes.map((change) => (
                <li
                  key={change.id}
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  <div className="grid gap-1 sm:grid-cols-2">
                    <p>
                      <span className="text-muted">{t('previousDriver')}:</span>{' '}
                      <span className="font-medium" dir="auto">
                        {change.previous_driver_name ?? '—'}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted">{t('newDriver')}:</span>{' '}
                      <span className="font-medium" dir="auto">
                        {change.new_driver_name}
                      </span>
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatDateTime(change.changed_at)}
                    {change.changer?.full_name
                      ? ` — ${change.changer.full_name}`
                      : ''}
                  </p>
                  {change.note && (
                    <p className="mt-1 whitespace-pre-wrap text-xs">
                      {change.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
