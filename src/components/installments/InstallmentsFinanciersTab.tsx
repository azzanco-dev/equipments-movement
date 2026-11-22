import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Notice,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import { installmentErrorMessage } from '@/lib/installments'
import {
  financiersOverview,
  financierTone,
  remainingShare,
} from '@/lib/installmentsBoard'
import {
  deleteInstallmentFinancier,
  fetchFinancierContractRows,
} from '@/lib/installmentsData'
import {
  activeCountWords,
  figuresOf,
  financierFigures,
  type FinancierFigures,
  type InstallmentFinancierRow,
} from '@/lib/installmentsView'
import { BankAccountLine } from './BankAccountFields'
import { FigureCard, FinancierTile } from './boardParts'
import { Money } from './cells'
import { useLoad } from './useLoad'

/**
 * «الجهات التمويلية» (owner 2026-11-22, «اعتمد تصميم الجهات التمويلية»: the
 * Figma frame «الاقساط / الموحد / الجهات التمويلية»): four figure cards —
 * the financiers, the active contracts, what they still owe with the
 * largest financier's share, and the financiers without an IBAN —, then ONE
 * CARD per financier in its colour (the same tone as on the dues and the
 * contracts): its active contracts, «حساب السداد» (the bank with its logo
 * and the IBAN with a copy button, or a dashed «لا يوجد حساب مسجل» with
 * «اضافة الحساب»), «عقود الجهة» (the contracts tab searched by its name)
 * with its next due date, and last, at the foot, what it is owed with its
 * share and a bar (owner 2026-11-22: «المتبقي» last, smaller cards). The
 * figures come from ONE bounded read of the contract summaries
 * (`financierFigures`). `installments.manage` adds, edits and deletes; a
 * financier with contracts is not deleted (the database refuses it,
 * `installment_contracts_financier_id_fkey`), and a dashed tile closes the
 * grid with «اضافة جهة».
 */
export function InstallmentsFinanciersTab({
  financiers,
  version,
  canManage,
  onAdd,
  onRename,
  onDeleted,
  onOpenContracts,
}: {
  financiers: readonly InstallmentFinancierRow[]
  version: number
  canManage: boolean
  onAdd: () => void
  onRename: (financier: InstallmentFinancierRow) => void
  onDeleted: () => void
  /** «عقود الجهة»: the contracts tab searched by the financier's name. */
  onOpenContracts: (financier: InstallmentFinancierRow) => void
}) {
  const { t, lang } = useI18n()
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
  const overview = useMemo(
    () => (load.data ? financiersOverview(financiers, figures) : null),
    [financiers, figures, load.data],
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

  const topName = overview?.top
    ? (financiers.find((row) => row.id === overview.top?.financierId)?.name ??
      '')
    : ''

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard
          tone="success"
          icon={<Building2 size={20} />}
          title={t('instTabFinanciers')}
          value={financiers.length}
          foot={
            overview
              ? t('instFinWithActive').replace(
                  '{count}',
                  String(overview.withActive),
                )
              : undefined
          }
        />
        <FigureCard
          tone="neutral"
          icon={<FileText size={20} />}
          title={t('instActiveContractsTitle')}
          value={overview ? overview.activeContracts : '—'}
          foot={
            overview
              ? t('instFinAtFinanciers').replace(
                  '{count}',
                  String(overview.withActive),
                )
              : undefined
          }
        />
        <FigureCard
          tone="info"
          icon={<Clock size={20} />}
          title={t('instRemainingOnContracts')}
          value={overview ? <Money value={overview.remaining} /> : '—'}
          foot={
            overview?.top
              ? t('instFinTopShare')
                  .replace('{name}', topName)
                  .replace('{percent}', String(overview.top.share))
              : undefined
          }
        />
        <FigureCard
          tone={overview && overview.withoutIban > 0 ? 'warning' : 'neutral'}
          icon={<AlertTriangle size={20} />}
          title={t('instFinNoIbanTitle')}
          value={financiers.filter((row) => !row.iban).length}
          foot={
            financiers.some((row) => !row.iban)
              ? t('instFinNoIbanHint')
              : t('instFinNoIbanNone')
          }
        />
      </div>

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

      {financiers.length === 0 && !canManage ? (
        <EmptyState title={t('instNoFinanciers')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {financiers.map((financier) => (
            <FinancierCard
              key={financier.id}
              financier={financier}
              tone={financierTone(financiers, financier.id)}
              figures={load.data ? figuresOf(figures, financier.id) : null}
              total={overview?.remaining ?? 0}
              canManage={canManage}
              deleteBlocked={
                complete && figuresOf(figures, financier.id).contracts > 0
              }
              lang={lang}
              onEdit={() => onRename(financier)}
              onDelete={() => setDeleting(financier)}
              onOpenContracts={() => onOpenContracts(financier)}
            />
          ))}
          {canManage && (
            <button
              type="button"
              onClick={onAdd}
              className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full bg-surface text-muted"
              >
                <Plus size={18} />
              </span>
              <span className="text-[13px] font-bold">
                {t('instFinancierAdd')}
              </span>
              <span className="text-[11px] text-muted">
                {t('instFinAddTileDesc')}
              </span>
            </button>
          )}
        </div>
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

/** One financier as a card (the Figma frame, 2026-11-22). */
function FinancierCard({
  financier,
  tone,
  figures,
  total,
  canManage,
  deleteBlocked,
  lang,
  onEdit,
  onDelete,
  onOpenContracts,
}: {
  financier: InstallmentFinancierRow
  tone: number
  /** null while the figures load. */
  figures: FinancierFigures | null
  total: number
  canManage: boolean
  deleteBlocked: boolean
  lang: 'ar' | 'en'
  onEdit: () => void
  onDelete: () => void
  onOpenContracts: () => void
}) {
  const { t, dir } = useI18n()
  const account =
    financier.bank_name || financier.iban
      ? {
          bankName: financier.bank_name ?? null,
          iban: financier.iban ?? null,
          own: false,
        }
      : null
  const share = figures ? remainingShare(figures.remaining, total) : 0
  const Forward = dir === 'rtl' ? ChevronLeft : ChevronRight

  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-xl border bg-bg p-3">
      <header className="flex items-start gap-2">
        <FinancierTile tone={tone} size={28} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[13px] font-bold">{financier.name}</h3>
          <p className="text-[11px] text-muted">
            {!figures
              ? '—'
              : figures.contracts === 0
                ? t('instFinNoContracts')
                : activeCountWords(figures.activeContracts, lang)}
          </p>
        </div>
        {canManage && (
          <span className="inline-flex shrink-0 items-center gap-0.5">
            <IconButton
              size="sm"
              variant="ghost"
              label={t('instFinancierEditOf').replace('{name}', financier.name)}
              icon={<Pencil size={15} aria-hidden="true" />}
              onClick={onEdit}
            />
            <IconButton
              size="sm"
              variant="ghost"
              label={(deleteBlocked
                ? t('instFinancierDeleteBlockedOf')
                : t('instFinancierDeleteOf')
              ).replace('{name}', financier.name)}
              title={deleteBlocked ? t('instFinancierDeleteBlocked') : undefined}
              disabled={deleteBlocked}
              icon={
                <Trash2
                  size={15}
                  aria-hidden="true"
                  className={deleteBlocked ? undefined : 'text-danger'}
                />
              }
              onClick={onDelete}
            />
          </span>
        )}
      </header>

      {account ? (
        <div className="space-y-1 rounded-lg bg-surface px-2.5 py-1.5">
          <p className="text-[11px] text-muted">{t('instAccountTitle')}</p>
          <BankAccountLine account={account} showSource={false} compact />
        </div>
      ) : (
        <div className="space-y-1 rounded-lg border border-dashed px-2.5 py-1.5">
          <p className="text-[11px] text-muted">{t('instAccountTitle')}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted">{t('instNoAccount')}</span>
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} aria-hidden="true" />}
                onClick={onEdit}
              >
                {t('instFinAddAccount')}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[11px]">
        {figures && figures.contracts === 0 ? (
          <span className="text-muted">
            {canManage ? t('instFinCanDelete') : t('instFinNoContracts')}
          </span>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenContracts}
              className="-ms-2"
            >
              {t('instFinContractsLink')}
              <Forward size={14} aria-hidden="true" />
            </Button>
            {figures?.nextDue && (
              <span className="text-muted">
                {t('instNextDue')}{' '}
                <bdi dir="ltr" className="tabular-nums">
                  {formatDate(figures.nextDue)}
                </bdi>
              </span>
            )}
          </>
        )}
      </div>

      <div className="space-y-1 border-t pt-2">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted">{t('instRemaining')}</p>
            <div className="text-[15px] font-bold">
              {figures ? <Money value={figures.remaining} /> : '—'}
            </div>
          </div>
          {figures && (
            <span className="shrink-0 text-[11px] text-muted">
              {t('instShareOfRemaining').replace('{percent}', String(share))}
            </span>
          )}
        </div>
        <div
          className="h-1 overflow-hidden rounded-full bg-surface-hover"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${share}%`,
              backgroundColor: `var(--chart-stroke-${tone})`,
            }}
          />
        </div>
      </div>
    </article>
  )
}
