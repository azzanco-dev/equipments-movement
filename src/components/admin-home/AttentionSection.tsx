import { useCallback, useMemo, type ReactNode } from 'react'
import {
  ArrowUpLeft,
  BadgeCheck,
  CalendarX2,
  CircleDollarSign,
  FileWarning,
  PowerOff,
  Radio,
  Wrench,
} from 'lucide-react'
import { AppLink, Badge, Button } from '@/components/ui'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { canViewEquipmentLocation } from '@/lib/actionPermissions'
import {
  AWAITING_END_PAGE,
  OUT_OF_SERVICE_LONG_DAYS,
  awaitingApprovalHref,
  awaitingEndHref,
  noPoHref,
  outOfServiceLongHref,
  saudiDayBefore,
  unclassifiedHref,
  unpricedHref,
  visibleAttentionItems,
  type AttentionId,
} from '@/lib/adminAttention'
import { loadAfaqyStats } from '@/lib/afaqy'
import { supabase } from '@/lib/supabase'
import { HomeBlock } from './HomeBlock'
import { ListRowsSkeleton } from './HomeSkeletons'
import { useAdminHomeSection } from './useAdminHomeSection'

type Tone = 'warning' | 'info' | 'danger'

const ITEM: Record<
  AttentionId,
  { label: TranslationKey; hint: TranslationKey; icon: ReactNode; tone: Tone }
> = {
  unclassified: {
    label: 'adminAttentionUnclassified',
    hint: 'adminAttentionUnclassifiedHint',
    icon: <Wrench size={14} />,
    tone: 'warning',
  },
  no_po: {
    label: 'adminAttentionNoPo',
    hint: 'adminAttentionNoPoHint',
    icon: <FileWarning size={14} />,
    tone: 'warning',
  },
  awaiting_approval: {
    label: 'adminAttentionAwaitingApproval',
    hint: 'adminAttentionAwaitingApprovalHint',
    icon: <BadgeCheck size={14} />,
    tone: 'info',
  },
  unpriced: {
    label: 'adminAttentionUnpriced',
    hint: 'adminAttentionUnpricedHint',
    icon: <CircleDollarSign size={14} />,
    tone: 'warning',
  },
  awaiting_end: {
    label: 'adminAttentionAwaitingEnd',
    hint: 'adminAttentionAwaitingEndHint',
    icon: <CalendarX2 size={14} />,
    tone: 'warning',
  },
  no_signal: {
    label: 'adminAttentionNoSignal',
    hint: 'adminAttentionNoSignalHint',
    icon: <Radio size={14} />,
    tone: 'danger',
  },
  out_of_service_long: {
    label: 'adminAttentionOutOfService',
    hint: 'adminAttentionOutOfServiceHint',
    icon: <PowerOff size={14} />,
    tone: 'danger',
  },
}

/** A head count; throws on a failed query so it is never read as zero. */
async function headCount(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export interface AttentionSectionProps {
  /** Whether the shell opens a page; an item links only when it does. */
  canOpenPage: (
    page: 'logs' | 'purchasing/units' | 'purchasing/orders' | 'sales/cards',
  ) => boolean
  /** Scrolls to the home's Afaqy section (the no-signal item). */
  onShowAfaqy: () => void
}

/**
 * «يحتاج انتباهك» (owner 2026-10-29, from the approved /ui-kit home
 * mockup): what needs action now, each a count that opens its list
 * filtered. An item shows only above zero and only for its readers —
 * the workshop items for every home reader (RLS decides the rows), the
 * purchasing ones with `purchasing.view`, the cards awaiting their end
 * (0185) with `sales.view`, the Afaqy one with
 * `equipment.location.view` — and the whole card hides when nothing is
 * left. The database counts load together; Afaqy (an outside service) on
 * its own, so it never delays them. A failed count says so; it is never
 * shown as nothing to do. Since the home v2 (owner 2026-11-09, «اعتمد
 * الرئيسية الي في ui-kit») it is the mockup's list block in the second row:
 * an icon tile, the label and its hint, the count; with nothing left it
 * says so in its place instead of leaving a hole in the grid.
 */
export function AttentionSection({
  canOpenPage,
  onShowAfaqy,
}: AttentionSectionProps) {
  const { t } = useI18n()
  const permissions = usePermissions()
  const canPurchasing = permissions.can('purchasing.view')
  const canSales = permissions.can('sales.view')
  const canAfaqy = canViewEquipmentLocation(permissions)
  const cutoff = useMemo(
    () => saudiDayBefore(new Date(), OUT_OF_SERVICE_LONG_DAYS),
    [],
  )

  const loadCounts = useCallback(
    async (signal: AbortSignal) => {
      const workshopOpen = () =>
        supabase
          .from('movement_visits')
          .select('entry_id', { count: 'exact', head: true })
          .eq('movement_context', 'workshop')
          .eq('is_open', true)
          .abortSignal(signal)
      const openPos = () =>
        supabase
          .from('supplier_pos')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open')
          .abortSignal(signal)
      const [
        unclassified,
        outOfService,
        noPo,
        awaiting,
        unpriced,
        awaitingEnd,
      ] = await Promise.all([
        headCount(workshopOpen().is('workshop_purpose', null)),
        headCount(
          workshopOpen()
            .eq('workshop_purpose', 'out_of_service')
            .lt('entry_at', cutoff),
        ),
        canPurchasing
          ? headCount(
              supabase
                .from('purchasing_site_units')
                .select('entry_id', { count: 'exact', head: true })
                .eq('has_po', false)
                .abortSignal(signal),
            )
          : 0,
        canPurchasing
          ? headCount(
              openPos().eq('approval_status', 'draft').eq('unpriced_count', 0),
            )
          : 0,
        canPurchasing ? headCount(openPos().gt('unpriced_count', 0)) : 0,
        // 0185: open cards whose unit left the project with «انتهاء عمل».
        canSales
          ? headCount(
              supabase
                .from('sales_cards_awaiting_end')
                .select('card_id', { count: 'exact', head: true })
                .abortSignal(signal),
            )
          : 0,
      ])
      return {
        unclassified,
        out_of_service_long: outOfService,
        no_po: noPo,
        awaiting_approval: awaiting,
        unpriced,
        awaiting_end: awaitingEnd,
      } satisfies Partial<Record<AttentionId, number>>
    },
    [canPurchasing, canSales, cutoff],
  )
  const counts = useAdminHomeSection(loadCounts)

  const loadAfaqy = useCallback(
    async (signal: AbortSignal) => {
      if (!canAfaqy) return 0
      const answer = await loadAfaqyStats(supabase, signal)
      if (!answer || answer.kind === 'error') throw new Error('afaqy_stats')
      return answer.kind === 'ok' ? answer.stats.connection.offline : 0
    },
    [canAfaqy],
  )
  const afaqy = useAdminHomeSection(loadAfaqy)

  const values: Partial<Record<AttentionId, number>> = {
    ...(counts.data ?? {}),
    no_signal: afaqy.data ?? 0,
  }
  const items = visibleAttentionItems(values)
  const failed = counts.failed || afaqy.failed
  // The home v2 grid keeps the block in its place (owner 2026-11-09, the
  // approved mockup): nothing to do reads as such, never as a hole.
  const firstLoad = counts.loading && counts.data === null

  const hrefOf = (id: AttentionId): string | null => {
    if (id === 'unclassified')
      return canOpenPage('logs') ? unclassifiedHref() : null
    if (id === 'out_of_service_long')
      return canOpenPage('logs') ? outOfServiceLongHref(cutoff) : null
    if (id === 'no_po')
      return canOpenPage('purchasing/units') ? noPoHref() : null
    if (id === 'awaiting_approval')
      return canOpenPage('purchasing/orders') ? awaitingApprovalHref() : null
    if (id === 'unpriced')
      return canOpenPage('purchasing/orders') ? unpricedHref() : null
    if (id === 'awaiting_end')
      return canOpenPage(AWAITING_END_PAGE) ? awaitingEndHref() : null
    return null
  }

  const rowClass =
    'group flex w-full items-center gap-2.5 rounded-md py-2.5 text-start transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'

  return (
    <HomeBlock
      title="homeV2NeedsAttention"
      action={
        items.length > 0 ? (
          <Badge size="sm" tone="danger" className="tabular-nums">
            {items.length}
          </Badge>
        ) : undefined
      }
      state={firstLoad ? 'loading' : 'ready'}
      skeleton={<ListRowsSkeleton rows={5} icon />}
    >
      {items.length === 0 && !failed ? (
        <p className="text-sm text-muted">{t('homeV2AttentionNone')}</p>
      ) : (
        <ul className="divide-y">
          {items.map((id) => {
            const item = ITEM[id]
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    color: `var(--${item.tone})`,
                    backgroundColor: `var(--${item.tone}-soft)`,
                  }}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="truncate-safe block text-sm font-medium text-fg">
                    {t(item.label)}
                  </span>
                  <span className="truncate-safe block text-[11px] leading-4 text-muted">
                    {t(item.hint)}
                  </span>
                </span>
                <Badge size="sm" tone={item.tone} className="tabular-nums">
                  {values[id]}
                </Badge>
                <ArrowUpLeft
                  size={14}
                  aria-hidden="true"
                  className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100"
                />
              </>
            )
            const href = hrefOf(id)
            return (
              <li key={id}>
                {href ? (
                  <AppLink href={href} className={rowClass}>
                    {body}
                  </AppLink>
                ) : id === 'no_signal' ? (
                  <button
                    type="button"
                    className={rowClass}
                    onClick={onShowAfaqy}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2.5 py-2.5">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {failed && (
        <p
          role="alert"
          className="mt-2 flex items-center gap-2 text-xs text-danger"
        >
          {t('adminAttentionLoadError')}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (counts.failed) counts.retry()
              if (afaqy.failed) afaqy.retry()
            }}
          >
            {t('retry')}
          </Button>
        </p>
      )}
    </HomeBlock>
  )
}
