import { useCallback, type ReactNode } from 'react'
import { ArrowUpLeft, BadgeCheck, CheckCircle2 } from 'lucide-react'
import { AppLink, Badge, Button } from '@/components/ui'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  awaitingApprovalHref,
  visibleAttentionItems,
  type AttentionId,
} from '@/lib/adminAttention'
import { availableEquipmentHref } from '@/lib/adminHomeLinks'
import type { OwnerStateMatrix } from '@/lib/adminHomeStats'
import { supabase } from '@/lib/supabase'
import { HomeBlock } from './HomeBlock'
import { ListRowsSkeleton } from './HomeSkeletons'
import {
  useAdminHomeSection,
  type AdminHomeSectionState,
} from './useAdminHomeSection'

type Tone = 'warning' | 'info' | 'danger'

const ITEM: Record<
  AttentionId,
  { label: TranslationKey; hint: TranslationKey; icon: ReactNode; tone: Tone }
> = {
  awaiting_approval: {
    label: 'adminAttentionAwaitingApproval',
    hint: 'adminAttentionAwaitingApprovalHint',
    icon: <BadgeCheck size={14} />,
    tone: 'info',
  },
  available_alazani: {
    label: 'adminAttentionAvailableAlazani',
    hint: 'adminAttentionAvailableAlazaniHint',
    icon: <CheckCircle2 size={14} />,
    tone: 'info',
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
  /** The page's snapshot over every owner: the available Al-Azani units. */
  matrix: AdminHomeSectionState<OwnerStateMatrix>
  /** Whether the shell opens a page; an item links only when it does. */
  canOpenPage: (
    page: 'logs' | 'purchasing/units' | 'purchasing/orders',
  ) => boolean
  /** Whether the shell opens the equipment list. */
  canOpenEquipment: boolean
}

/**
 * «يحتاج انتباهك» (owner 2026-10-29, from the approved /ui-kit home
 * mockup): what needs action now, each a count that opens its list
 * filtered. Since the owner's review of 2026-11-10 it was three items; since
 * migration 0189 (owner 2026-11-11: a card is neither open nor ended) TWO:
 * the supplier POs awaiting approval (`purchasing.view`; every draft with
 * all its lines priced — a PO has no open / closed state) and the Al-Azani
 * units available now — the last from the page's ONE snapshot (`matrix`),
 * no request of its own. An item shows
 * only above zero and only for its readers. A failed count says so with a
 * retry; it is never shown as nothing to do. In the home v2 grid the block
 * keeps its place: with nothing left it says so.
 */
export function AttentionSection({
  matrix,
  canOpenPage,
  canOpenEquipment,
}: AttentionSectionProps) {
  const { t } = useI18n()
  const permissions = usePermissions()
  const canPurchasing = permissions.can('purchasing.view')

  const loadCounts = useCallback(
    async (signal: AbortSignal) => {
      const awaiting = canPurchasing
        ? await headCount(
            supabase
              .from('supplier_pos')
              .select('id', { count: 'exact', head: true })
              .eq('approval_status', 'draft')
              .eq('unpriced_count', 0)
              .abortSignal(signal),
          )
        : 0
      return {
        awaiting_approval: awaiting,
      } satisfies Partial<Record<AttentionId, number>>
    },
    [canPurchasing],
  )
  const counts = useAdminHomeSection(loadCounts)

  const values: Partial<Record<AttentionId, number>> = {
    ...(counts.data ?? {}),
    available_alazani: matrix.data?.count('alazani', 'available') ?? 0,
  }
  const items = visibleAttentionItems(values)
  const failed = counts.failed || matrix.failed
  const firstLoad =
    (counts.loading && counts.data === null) ||
    (matrix.loading && matrix.data === null)

  const hrefOf = (id: AttentionId): string | null => {
    if (id === 'awaiting_approval')
      return canOpenPage('purchasing/orders') ? awaitingApprovalHref() : null
    return canOpenEquipment ? availableEquipmentHref(['alazani']) : null
  }

  const rowClass =
    'group flex w-full items-center gap-2.5 rounded-md py-1.5 text-start transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'

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
      skeleton={<ListRowsSkeleton rows={3} icon />}
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
                ) : (
                  <div className="flex w-full items-center gap-2.5 py-1.5">
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
              if (matrix.failed) matrix.retry()
            }}
          >
            {t('retry')}
          </Button>
        </p>
      )}
    </HomeBlock>
  )
}
