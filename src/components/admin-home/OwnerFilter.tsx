import { useCallback, useMemo } from 'react'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { useI18n } from '@/i18n/I18nContext'
import { ADMIN_HOME_OWNERS, type AdminHomeOwner } from '@/lib/adminHomeStats'
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
  /** An empty array means every owner, never "no owners". */
  value: AdminHomeOwner[]
  onChange: (value: AdminHomeOwner[]) => void
  /** `sm` is the 28 px toolbar size, for a filter sitting in a section header. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * The owner filter: the shared `MultiSelect`, pre-filled with the five owner
 * classifications and their short labels.
 *
 * Owner review (2026-09-22, third pass): there is no page-level owner filter
 * any more, so this is rendered by each section that needs one, in its own
 * header, against its own local state.
 *
 * An empty selection means "every owner" in both places it is represented:
 * here, and as a NULL `p_owners` argument in migration 0095. That is why there
 * is no explicit "الكل" option to tick — clearing the selection IS that
 * option, so the two can never be on at the same time.
 */
export function OwnerFilter({
  value,
  onChange,
  size = 'md',
  className,
}: OwnerFilterProps) {
  const { t } = useI18n()
  const label = useOwnerLabel()
  const options = useMemo(
    () =>
      ADMIN_HOME_OWNERS.map((owner) => ({
        value: owner,
        label: label(owner),
      })),
    [label],
  )

  return (
    <MultiSelect
      className={className}
      size={size}
      aria-label={t('adminHomeOwnerFilter')}
      options={options}
      value={value}
      onValueChange={(next) => onChange(next as AdminHomeOwner[])}
      allLabel={t('allOwners')}
      summaryLabel={(count) =>
        t('adminHomeOwnerCount').replace('{count}', String(count))
      }
    />
  )
}
