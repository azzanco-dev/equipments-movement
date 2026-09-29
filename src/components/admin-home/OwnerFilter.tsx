import { useCallback, useMemo } from 'react'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { useI18n } from '@/i18n/I18nContext'
import {
  ADMIN_HOME_OWNERS,
  ALL_OWNERS,
  type AdminHomeOwner,
} from '@/lib/adminHomeStats'
import type { TranslationKey } from '@/i18n/translations'

/** Short label per owner, for chart legends and compact table cells. The long
 *  registered names stay on the equipment forms. */
const SHORT_LABEL: Record<AdminHomeOwner, TranslationKey> = {
  alazani: 'adminHomeOwnerAlazani',
  takween: 'adminHomeOwnerTakween',
  third_party_f: 'adminHomeOwnerThirdPartyF',
  third_party_partnership_b: 'adminHomeOwnerThirdPartyB',
  external_supplier: 'adminHomeOwnerExternal',
}

/** Labels every owner id the page can meet, including an unexpected one from
 *  the database, which keeps its raw value instead of rendering blank. */
export function useOwnerLabel(): (owner: string) => string {
  const { t } = useI18n()
  return useCallback(
    (owner: string) =>
      owner in SHORT_LABEL
        ? t(SHORT_LABEL[owner as AdminHomeOwner])
        : (owner ?? ''),
    [t],
  )
}

export interface OwnerFilterProps {
  /** An empty array means every offered owner, never "no owners". */
  value: AdminHomeOwner[]
  onChange: (value: AdminHomeOwner[]) => void
  /** The owners offered. Defaults to all five (the report screens); the admin
   *  home passes its three through `HomeOwnerFilter`. */
  options?: readonly AdminHomeOwner[]
  /** Trigger text for an empty selection; defaults to "جميع الملاك". */
  allLabel?: string
  /** Above this many selected owners the trigger summarizes as a count. */
  summaryAfter?: number
  /** `sm` is the 28 px toolbar size, for a filter sitting in a section header. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * The owner filter: the shared `MultiSelect`, pre-filled with the owner
 * classifications it is given (all five unless told otherwise) and their short
 * labels.
 *
 * Owner review (2026-09-22, third pass): there is no page-level owner filter
 * any more, so this is rendered by each section that needs one, in its own
 * header, against its own local state.
 *
 * An empty selection means "every offered owner". That is why there is no
 * explicit "الكل" option to tick — clearing the selection IS that option, so
 * the two can never be on at the same time. On the report screens it is sent
 * as a NULL `p_owners` (migration 0095); on the admin home the data layer maps
 * it to the three home owners (see `HomeOwnerFilter`).
 */
export function OwnerFilter({
  value,
  onChange,
  options: offered = ALL_OWNERS,
  allLabel,
  summaryAfter,
  size = 'md',
  className,
}: OwnerFilterProps) {
  const { t } = useI18n()
  const label = useOwnerLabel()
  const options = useMemo(
    () =>
      offered.map((owner) => ({
        value: owner,
        label: label(owner),
      })),
    [label, offered],
  )

  return (
    <MultiSelect
      className={className}
      size={size}
      aria-label={t('adminHomeOwnerFilter')}
      options={options}
      value={value}
      onValueChange={(next) => onChange(next as AdminHomeOwner[])}
      allLabel={allLabel ?? t('allOwners')}
      summaryAfter={summaryAfter}
      summaryLabel={(count) =>
        t('adminHomeOwnerCount').replace('{count}', String(count))
      }
    />
  )
}

/**
 * The admin home's owner filter (owner decision, 2026-09-29, EM-199): exactly
 * Al-Azani, F and B. Takween and external suppliers are not offered, and an
 * empty selection reads as those three («العزاني، F، B»), never as "all
 * owners", because the home never aggregates the other two.
 */
export function HomeOwnerFilter(
  props: Omit<OwnerFilterProps, 'options' | 'allLabel' | 'summaryAfter'>,
) {
  const label = useOwnerLabel()
  const allLabel = useMemo(
    () => ADMIN_HOME_OWNERS.map((owner) => label(owner)).join('، '),
    [label],
  )
  return (
    <OwnerFilter
      {...props}
      options={ADMIN_HOME_OWNERS}
      allLabel={allLabel}
      // Naming all three keeps the trigger identical for "empty" and "all
      // ticked", instead of flipping to "3 ملاك".
      summaryAfter={ADMIN_HOME_OWNERS.length}
    />
  )
}
