import { useCallback, useMemo, useState } from 'react'
import { BankLogo } from '@/components/banks/BankLogo'
import { formatIban } from '@/lib/partyFields'
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Notice,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { installmentErrorMessage } from '@/lib/installments'
import {
  deleteInstallmentFinancier,
  fetchFinancierContractRows,
} from '@/lib/installmentsData'
import {
  figuresOf,
  financierFigures,
  type InstallmentFinancierRow,
} from '@/lib/installmentsView'
import { Money } from './cells'
import { useLoad } from './useLoad'

/**
 * «الجهات»: the banks and dealers the contracts are owed to, each with its
 * active contracts and what they still owe (ONE bounded read of the
 * contract summaries, grouped by `financierFigures`). `installments.manage`
 * adds, renames and deletes; a financier with contracts is not deleted (the
 * database refuses it, `installment_contracts_financier_id_fkey`).
 */
export function InstallmentsFinanciersTab({
  financiers,
  version,
  canManage,
  onAdd,
  onRename,
  onDeleted,
}: {
  financiers: readonly InstallmentFinancierRow[]
  version: number
  canManage: boolean
  onAdd: () => void
  onRename: (financier: InstallmentFinancierRow) => void
  onDeleted: () => void
}) {
  const { t } = useI18n()
  const [deleting, setDeleting] = useState<InstallmentFinancierRow | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<TranslationKey | null>(null)

  const loader = useCallback(
    (signal: AbortSignal) => fetchFinancierContractRows(signal),
    [],
  )
  const load = useLoad(loader, version)
  const figures = useMemo(
    () => financierFigures(load.data?.rows ?? []),
    [load.data],
  )
  // With a capped read a financier may have contracts the figures do not
  // see: the delete stays open and the database answers.
  const complete = load.status === 'ready' && !load.data?.partial

  const remove = async () => {
    if (!deleting || removing) return
    setRemoving(true)
    const result = await deleteInstallmentFinancier(deleting.id)
    setRemoving(false)
    setDeleting(null)
    if (!result.ok) {
      setError(
        result.refused
          ? 'instErrManageRequired'
          : installmentErrorMessage(result.error),
      )
      return
    }
    setError(null)
    onDeleted()
  }

  const columns: DataTableColumn<InstallmentFinancierRow>[] = [
    {
      key: 'name',
      header: t('instFinancierName'),
      // 0208: the account as a muted line under the name (no new column:
      // the tables stay narrow).
      cell: (item) => (
        <span className="flex items-start gap-2">
          <Building2
            size={14}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-muted"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold">{item.name}</span>
            {(item.bank_name || item.iban) && (
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {item.bank_name && (
                  <span className="inline-flex items-center gap-1.5">
                    <BankLogo name={item.bank_name} size="sm" />
                    {item.bank_name}
                  </span>
                )}
                {item.iban && (
                  <bdi dir="ltr" className="tabular-nums">
                    {formatIban(item.iban)}
                  </bdi>
                )}
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'contracts',
      header: t('instActiveContracts'),
      align: 'center',
      cell: (item) =>
        load.data ? (
          <span className="tabular-nums">
            {figuresOf(figures, item.id).activeContracts}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'remaining',
      header: t('instRemaining'),
      align: 'end',
      cell: (item) =>
        load.data ? (
          <Money value={figuresOf(figures, item.id).remaining} />
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('actions')}</span>,
            align: 'end' as const,
            cell: (item: InstallmentFinancierRow) => {
              const used = complete && figuresOf(figures, item.id).contracts > 0
              return (
                <span className="inline-flex items-center gap-1">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={t('instFinancierEditOf').replace(
                      '{name}',
                      item.name,
                    )}
                    icon={<Pencil size={15} aria-hidden="true" />}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRename(item)
                    }}
                  />
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={(used
                      ? t('instFinancierDeleteBlockedOf')
                      : t('instFinancierDeleteOf')
                    ).replace('{name}', item.name)}
                    title={used ? t('instFinancierDeleteBlocked') : undefined}
                    disabled={used}
                    icon={
                      <Trash2
                        size={15}
                        aria-hidden="true"
                        className={used ? undefined : 'text-danger'}
                      />
                    }
                    onClick={(event) => {
                      event.stopPropagation()
                      setDeleting(item)
                    }}
                  />
                </span>
              )
            },
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('instFinanciersDesc')}</p>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={onAdd}
          >
            {t('instFinancierAdd')}
          </Button>
        )}
      </div>
      {error && (
        <Notice tone="danger" size="compact" onDismiss={() => setError(null)}>
          {t(error)}
        </Notice>
      )}
      {load.status === 'failed' && (
        <ErrorState
          description={t('instFinancierFiguresLoadError')}
          onRetry={load.reload}
        />
      )}
      {load.data?.partial && (
        <Notice tone="warning" size="compact">
          {t('instPartialFigures')}
        </Notice>
      )}
      {load.status !== 'failed' && (
        <DataTable
          cellTextClassName="text-[13px]"
          cellClassName="py-3"
          columns={columns}
          rows={[...financiers]}
          rowKey={(item) => item.id}
          caption={t('instTabFinanciers')}
          onRowClick={canManage ? onRename : undefined}
          empty={<EmptyState title={t('instNoFinanciers')} />}
          className="rounded-xl border bg-bg"
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t('instFinancierDeleteTitle')}
        description={
          deleting
            ? t('instFinancierDeleteDesc').replace('{name}', deleting.name)
            : ''
        }
        confirmLabel={t('delete')}
        cancelLabel={t('instBackOut')}
        tone="danger"
        loading={removing}
        onConfirm={remove}
      />
    </div>
  )
}
