import { useCallback, useMemo } from 'react'
import { Users } from 'lucide-react'
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
  className?: string
}

/**
 * The owner filter for the whole admin home (owner request, 2026-09-22: a
 * multi-select, and the first control on the page).
 *
 * An empty selection means "every owner" in all three places it is
 * represented: here, in the `?owners=` URL parameter, and as a NULL
 * `p_owners` argument in migration 0095. That is why there is no explicit
 * "الكل" option to tick — clearing the selection IS that option, so the two
 * can never be on at the same time.
 */
export function OwnerFilter({ value, onChange, className }: OwnerFilterProps) {
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

/**
 * The owner filter as the page's first row: a labelled card above the
 * sections, full width on mobile and a fixed, comfortable width from sm up.
 */
export function OwnerFilterBar({
  value,
  onChange,
}: Omit<OwnerFilterProps, 'className'>) {
  const { t } = useI18n()
  return (
    <div className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
      <span className="flex items-center gap-2 text-sm font-medium text-fg">
        <Users size={16} aria-hidden="true" className="text-muted" />
        {t('adminHomeOwnerFilter')}
      </span>
      <OwnerFilter
        value={value}
        onChange={onChange}
        className="w-full sm:w-72"
      />
    </div>
  )
}
