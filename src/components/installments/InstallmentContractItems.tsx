import { Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  itemRowError,
  newItemRow,
  INSTALLMENT_ITEMS_MAX,
  INSTALLMENT_ITEM_NAME_MAX,
  type InstallmentItemFormRow,
} from '@/lib/installmentPlan'

/**
 * «بنود العقد» (owner 2026-11-23, «الاشياء الي داخله في العقد, ممكن تكون
 * معدات وممكن شي اخر, مثلا حط البند والعدد»): one line per item — its name
 * as typed and its count —, a bin on each and «اضافة بند» under them. A
 * line without a name is left out of the save.
 */
export function InstallmentContractItems({
  rows,
  onChange,
  showErrors,
  disabled,
}: {
  rows: readonly InstallmentItemFormRow[]
  onChange: (rows: InstallmentItemFormRow[]) => void
  showErrors: boolean
  disabled?: boolean
}) {
  const { t } = useI18n()

  const patch = (key: string, values: Partial<InstallmentItemFormRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...values } : row)))

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, index) => {
            const error = showErrors ? itemRowError(row) : null
            return (
              <li key={row.key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    className="min-w-0 flex-1"
                    aria-label={`${t('instItemName')} ${index + 1}`}
                    aria-invalid={error === 'instItemErrName' || undefined}
                    placeholder={t('instItemNamePlaceholder')}
                    disabled={disabled}
                    maxLength={INSTALLMENT_ITEM_NAME_MAX}
                    value={row.name}
                    onChange={(event) =>
                      patch(row.key, { name: event.target.value })
                    }
                  />
                  <Input
                    className="w-20 shrink-0 text-center sm:w-24"
                    aria-label={`${t('instItemQuantity')} ${index + 1}`}
                    aria-invalid={error === 'instItemErrQuantity' || undefined}
                    dir="ltr"
                    inputMode="decimal"
                    disabled={disabled}
                    value={row.quantity}
                    onChange={(event) =>
                      patch(row.key, { quantity: event.target.value })
                    }
                  />
                  <IconButton
                    variant="ghost"
                    label={t('instItemRemove')}
                    icon={<Trash2 size={15} aria-hidden="true" />}
                    disabled={disabled}
                    onClick={() =>
                      onChange(rows.filter((other) => other.key !== row.key))
                    }
                  />
                </div>
                {error && (
                  <p className="text-xs text-danger" role="alert">
                    {t(error)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {rows.length < INSTALLMENT_ITEMS_MAX && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={() => onChange([...rows, newItemRow(crypto.randomUUID())])}
        >
          {t('instItemAdd')}
        </Button>
      )}
    </div>
  )
}
