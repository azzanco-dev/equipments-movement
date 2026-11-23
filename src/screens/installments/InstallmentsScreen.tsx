import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  CalendarDays,
  Clock,
  FileText,
  List,
  Plus,
  Wallet,
} from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { SetFirstDueDateDialog } from '@/components/installments/InstallmentDateDialogs'
import { InstallmentFinancierDialog } from '@/components/installments/InstallmentFinancierDialog'
import {
  InstallmentPaymentDialog,
  type InstallmentPaymentTarget,
} from '@/components/installments/InstallmentPaymentDialog'
import { InstallmentsCalendarTab } from '@/components/installments/InstallmentsCalendarTab'
import { InstallmentsContractsTab } from '@/components/installments/InstallmentsContractsTab'
import { InstallmentsDashboardTab } from '@/components/installments/InstallmentsDashboardTab'
import { InstallmentsDuesTab } from '@/components/installments/InstallmentsDuesTab'
import { InstallmentsFinanciersTab } from '@/components/installments/InstallmentsFinanciersTab'
import { takeInstallmentFlash } from '@/components/installments/flash'
import { useInstallmentsUrl } from '@/components/installments/useInstallmentsUrl'
import { useLoad } from '@/components/installments/useLoad'
import {
  AppLink,
  Badge,
  Button,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastProvider,
  useToast,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  fetchInstallmentContractsCount,
  fetchInstallmentFinanciers,
  fetchInstallmentOverview,
} from '@/lib/installmentsData'
import {
  amountOf,
  INSTALLMENTS_URL_KEYS,
  type InstallmentContractRow,
  type InstallmentDueRow,
  type InstallmentFinancierRow,
  type InstallmentsTab,
} from '@/lib/installmentsView'

/** The dialogs the page opens. */
export type InstallmentsDialog =
  | { kind: 'first_due'; contract: InstallmentContractRow }
  | {
      kind: 'pay'
      contract: InstallmentPaymentTarget | null
      amount?: number
      /** A first payment or the VAT row is paid first (0209). */
      targetId?: string
    }
  | { kind: 'financier'; financier: InstallmentFinancierRow | null }

/**
 * «الاقساط» (/installments, migration 0203; the /ui-kit mockup the owner
 * approved on 2026-11-18, «اعتمد وابني»): ONE page with its header and five
 * tabs — «اللوحة» (the default), «التقويم», «الاستحقاقات», «العقود», «الجهات
 * التمويلية» (the unified page approved in Figma on 2026-11-21) — on the
 * real views. The page is a HIDDEN nav entry (owner: «لاتضيف للسايد بار, خلي
 * الوصول له عبر الرابط»), gated on `installments.view`; the write actions
 * show for `installments.manage` only, and the database checks the key again
 * in every function. The tab, the search, the filters and the pages live in
 * the URL, so Back restores them.
 */
export function InstallmentsScreen() {
  // The successes show their Toasts through this provider; no shell
  // provides one.
  return (
    <ToastProvider>
      <InstallmentsScreenInner />
    </ToastProvider>
  )
}

function InstallmentsScreenInner() {
  const { t } = useI18n()
  const toast = useToast()
  const { can } = usePermissions()
  // Fails closed: `can` answers false until the permissions are ready.
  const canManage = can('installments.manage')
  const { state, update } = useInstallmentsUrl()
  const [dialog, setDialog] = useState<InstallmentsDialog | null>(null)
  // Bumped after every write: each read of the page runs again.
  const [version, setVersion] = useState(0)

  // The message of the contract page that opened this one (a deleted
  // contract, 0207).
  useEffect(() => {
    const flash = takeInstallmentFlash()
    if (flash) toast({ title: t(flash.message), tone: flash.tone })
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loader = useCallback(async (signal: AbortSignal) => {
    const [overview, contractsCount, financiers] = await Promise.all([
      fetchInstallmentOverview(signal),
      fetchInstallmentContractsCount(signal),
      fetchInstallmentFinanciers(signal),
    ])
    return { overview, contractsCount, financiers }
  }, [])
  const load = useLoad(loader, version)
  const data = load.data

  const setTab = (tab: InstallmentsTab) =>
    update({ [INSTALLMENTS_URL_KEYS.tab]: tab === 'dashboard' ? null : tab })
  const showDues = () => update({ [INSTALLMENTS_URL_KEYS.tab]: 'dues' })

  /** A write succeeded: close its dialog, read again, say so. */
  // A payment whose receipt could not be attached is still saved: say so,
  // and that the receipt can be attached from its card.
  const paymentSaved = ({
    receiptError,
  }: {
    receiptError: TranslationKey | null
  }) => {
    if (!receiptError) {
      done('instToastPaymentRecorded')
      return
    }
    setDialog(null)
    setVersion((current) => current + 1)
    toast({
      title: t('instToastPaymentRecordedNoReceipt'),
      description: `${t(receiptError)} ${t('instReceiptAttachLater')}`,
      tone: 'warning',
    })
  }
  const done = (message: TranslationKey) => {
    setDialog(null)
    setVersion((current) => current + 1)
    toast({ title: t(message), tone: 'success' })
  }
  const refresh = () => setVersion((current) => current + 1)
  const payRow = (row: InstallmentDueRow) =>
    setDialog({
      kind: 'pay',
      contract: {
        id: row.contract_id,
        contract_number: row.contract_number,
        description: row.description,
        financier_name: row.financier_name,
      },
      amount: amountOf(row.remaining_amount),
      // An installment stays oldest first.
      targetId: row.kind === 'installment' ? undefined : row.id,
    })
  const payContract = (contract: InstallmentContractRow) =>
    setDialog({
      kind: 'pay',
      contract: {
        id: contract.id,
        contract_number: contract.contract_number,
        description: contract.description,
        financier_name: contract.financier_name,
      },
      amount:
        contract.next_due_amount === null
          ? undefined
          : amountOf(contract.next_due_amount),
      targetId:
        contract.next_due_id && contract.next_due_kind !== 'installment'
          ? contract.next_due_id
          : undefined,
    })
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null)
  }

  const actions = canManage ? (
    <>
      <Button
        variant="outline"
        icon={<Wallet size={16} aria-hidden="true" />}
        onClick={() => setDialog({ kind: 'pay', contract: null })}
      >
        {t('instPayTitle')}
      </Button>
      <Button asChild variant="primary">
        <AppLink href="/installments/new">
          <Plus size={16} aria-hidden="true" />
          {t('instContractNew')}
        </AppLink>
      </Button>
    </>
  ) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('installments')}
        description={t('installmentsDesc')}
        actions={actions}
      />

      {load.status === 'failed' ? (
        <ErrorState
          description={t('instPageLoadError')}
          onRetry={load.reload}
        />
      ) : !data ? (
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only" role="status">
            {t('loading')}
          </span>
          <Skeleton className="h-9 w-72 max-w-full" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Tabs
          value={state.tab}
          onValueChange={(next) => setTab(next as InstallmentsTab)}
          className="space-y-4"
        >
          {/* The approved design «نموذج 5» (owner 2026-11-21, «اعتمد 5»):
              frameless buttons with an icon, the open one black like a
              primary button, between two lines; it scrolls sideways on a
              phone. The order and «التقويم» are the unified page of the same
              day: اللوحة, التقويم, الاستحقاقات, العقود, الجهات التمويلية. */}
          <div className="border-b pb-3">
            <TabsList variant="buttons" aria-label={t('instTabsLabel')}>
              <TabsTrigger value="dashboard">
                <List size={16} aria-hidden="true" />
                {t('instTabDashboard')}
              </TabsTrigger>
              <TabsTrigger value="calendar">
                <CalendarDays size={16} aria-hidden="true" />
                {t('instTabCalendar')}
              </TabsTrigger>
              <TabsTrigger value="dues">
                <Clock size={16} aria-hidden="true" />
                {t('instTabDues')}
                {data.overview.overdue_count > 0 && (
                  <Badge size="sm" tone="danger">
                    {data.overview.overdue_count}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="contracts">
                <FileText size={16} aria-hidden="true" />
                {t('instTabContracts')}
                <span className="text-xs tabular-nums opacity-70">
                  {data.contractsCount}
                </span>
              </TabsTrigger>
              <TabsTrigger value="financiers">
                <Building2 size={16} aria-hidden="true" />
                {t('instTabFinanciers')}
                <span className="text-xs tabular-nums opacity-70">
                  {data.financiers.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </div>
          {/* Only the open tab is mounted (and reads): what each one shows
              is kept in the URL, so nothing is lost on a switch. */}
          <TabsContent value="dashboard" className="mt-0">
            <InstallmentsDashboardTab
              overview={data.overview}
              financiers={data.financiers}
              version={version}
              canManage={canManage}
              onPay={payRow}
              onShowDues={showDues}
            />
          </TabsContent>
          <TabsContent value="calendar" className="mt-0">
            <InstallmentsCalendarTab
              version={version}
              canManage={canManage}
              onPay={payRow}
            />
          </TabsContent>
          <TabsContent value="contracts" className="mt-0">
            <InstallmentsContractsTab
              state={state}
              update={update}
              financiers={data.financiers}
              totalContracts={data.contractsCount}
              version={version}
              canManage={canManage}
              onPay={payContract}
              onSetFirstDue={(contract) =>
                setDialog({ kind: 'first_due', contract })
              }
            />
          </TabsContent>
          <TabsContent value="dues" className="mt-0">
            <InstallmentsDuesTab
              state={state}
              update={update}
              financiers={data.financiers}
              version={version}
              canManage={canManage}
              onPay={payRow}
            />
          </TabsContent>
          <TabsContent value="financiers" className="mt-0">
            <InstallmentsFinanciersTab
              financiers={data.financiers}
              version={version}
              canManage={canManage}
              onAdd={() => setDialog({ kind: 'financier', financier: null })}
              onRename={(financier) =>
                setDialog({ kind: 'financier', financier })
              }
              onDeleted={() => done('instToastFinancierDeleted')}
              onOpenContracts={(financier) =>
                update({
                  [INSTALLMENTS_URL_KEYS.tab]: 'contracts',
                  [INSTALLMENTS_URL_KEYS.contractChip]: null,
                  [INSTALLMENTS_URL_KEYS.contractSearch]: financier.name,
                })
              }
            />
          </TabsContent>
        </Tabs>
      )}

      {/* The dialogs, each open while `dialog` names it. A success reads
          the page again and shows its Toast; a refusal stays in its dialog.
          A contract is added on its own page (/installments/new, 0209). */}
      {canManage && (
        <>
          <SetFirstDueDateDialog
            contract={dialog?.kind === 'first_due' ? dialog.contract : null}
            onOpenChange={closeDialog}
            onDone={() => done('instToastFirstDueSet')}
            onStale={refresh}
          />
          <InstallmentPaymentDialog
            open={dialog?.kind === 'pay'}
            onOpenChange={closeDialog}
            contract={dialog?.kind === 'pay' ? dialog.contract : null}
            initialAmount={dialog?.kind === 'pay' ? dialog.amount : undefined}
            targetId={dialog?.kind === 'pay' ? dialog.targetId : undefined}
            onSaved={paymentSaved}
            onStale={refresh}
          />
          <InstallmentFinancierDialog
            open={dialog?.kind === 'financier'}
            onOpenChange={closeDialog}
            financier={dialog?.kind === 'financier' ? dialog.financier : null}
            onSaved={(created) =>
              done(
                created
                  ? 'instToastFinancierAdded'
                  : 'instToastFinancierRenamed',
              )
            }
          />
        </>
      )}
    </div>
  )
}
