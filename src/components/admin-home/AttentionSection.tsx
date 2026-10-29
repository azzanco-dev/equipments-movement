import { useCallback, useMemo, type ReactNode } from 'react'
import {
  ArrowUpLeft,
  BadgeCheck,
  CircleDollarSign,
  FileWarning,
  PowerOff,
  Radio,
  Wrench,
} from 'lucide-react'
import { AppLink, Button, Card, SectionHeader } from '@/components/ui'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { canViewEquipmentLocation } from '@/lib/actionPermissions'
import {
  OUT_OF_SERVICE_LONG_DAYS,
  awaitingApprovalHref,
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
import { useAdminHomeSection } from './useAdminHomeSection'

type Tone = 'warning' | 'info' | 'danger'

const ITEM: Record<
  AttentionId,
  { label: TranslationKey; hint: TranslationKey; icon: ReactNode; tone: Tone }
> = {
  unclassified: {
    label: 'adminAttentionUnclassified',
    hint: 'adminAttentionUnclassifiedHint',
    icon: <Wrench size={16} />,
    tone: 'warning',
  },
  no_po: {
    label: 'adminAttentionNoPo',
    hint: 'adminAttentionNoPoHint',
    icon: <FileWarning size={16} />,
    tone: 'warning',
  },
  awaiting_approval: {
    label: 'adminAttentionAwaitingApproval',
    hint: 'adminAttentionAwaitingApprovalHint',
    icon: <BadgeCheck size={16} />,
    tone: 'info',
  },
  unpriced: {
    label: 'adminAttentionUnpriced',
    hint: 'adminAttentionUnpricedHint',
    icon: <CircleDollarSign size={16} />,
    tone: 'warning',
  },
  no_signal: {
    label: 'adminAttentionNoSignal',
    hint: 'adminAttentionNoSignalHint',
    icon: <Radio size={16} />,
    tone: 'danger',
  },
  out_of_service_long: {
    label: 'adminAttentionOutOfService',
    hint: 'adminAttentionOutOfServiceHint',
    icon: <PowerOff size={16} />,
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
    page: 'logs' | 'purchasing/units' | 'purchasing/orders',
  ) => boolean
  /** Scrolls to the home's Afaqy section (the no-signal item). */
  onShowAfaqy: () => void
}

/**
 * «يحتاج انتباهك» (owner 2026-10-29, from the approved /ui-kit home
 * mockup): what needs action now, each a count that opens its list
 * filtered. An item shows only above zero and only for its readers —
 * the workshop items for every home reader (RLS decides the rows), the
 * purchasing ones with `purchasing.view`, the Afaqy one with
 * `equipment.location.view` — and the whole card hides when nothing is
 * left. The database counts load together; Afaqy (an outside service) on
 * its own, so it never delays them. A failed count says so; it is never
 * shown as nothing to do.
 */
export function AttentionSection({
  canOpenPage,
  onShowAfaqy,
}: AttentionSectionProps) {
  const { t } = useI18n()
  const permissions = usePermissions()
  const canPurchasing = permissions.can('purchasing.view')
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
      const [unclassified, outOfService, noPo, awaiting, unpriced] =
        await Promise.all([
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
                openPos()
                  .eq('approval_status', 'draft')
                  .eq('unpriced_count', 0),
              )
            : 0,
          canPurchasing ? headCount(openPos().gt('unpriced_count', 0)) : 0,
        ])
      return {
        unclassified,
        out_of_service_long: outOfService,
        no_po: noPo,
        awaiting_approval: awaiting,
        unpriced,
      } satisfies Partial<Record<AttentionId, number>>
    },
    [canPurchasing, cutoff],
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

  // Nothing yet, or nothing to do: no card at all.
  if (items.length === 0 && !failed) return null

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
    return null
  }

  const itemClass =
    'group flex w-full items-center gap-3 rounded-xl border bg-bg p-3 text-start transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

  return (
    <Card className="space-y-3">
      <SectionHeader
        as="h2"
        title={t('adminAttentionTitle')}
        description={t('adminAttentionDescription')}
      />
      {items.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((id) => {
            const item = ITEM[id]
            const color = `var(--${item.tone})`
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{
                    color,
                    backgroundColor: `var(--${item.tone}-soft)`,
                  }}
                >
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">
                    {t(item.label)}
                  </span>
                  <span className="block text-xs text-muted">
                    {t(item.hint)}
                  </span>
                </span>
                <span
                  className="text-xl font-bold tabular-nums"
                  style={{ color }}
                >
                  {values[id]}
                </span>
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
                  <AppLink href={href} className={itemClass}>
                    {body}
                  </AppLink>
                ) : id === 'no_signal' ? (
                  <button
                    type="button"
                    className={itemClass}
                    onClick={onShowAfaqy}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-3 rounded-xl border bg-bg p-3">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {failed && (
        <p role="alert" className="flex items-center gap-2 text-xs text-danger">
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
    </Card>
  )
}
