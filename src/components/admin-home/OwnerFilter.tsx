import { useCallback, useMemo } from 'react'
import { Select } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { ADMIN_HOME_OWNERS, type AdminHomeOwner } from '@/lib/adminHomeStats'
import type { TranslationKey } from '@/i18n/translations'

const ALL = '__all__'

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
  /** `null` means every owner. */
  value: AdminHomeOwner | null
  onChange: (value: AdminHomeOwner | null) => void
  className?: string
}

/**
 * Owner filter for the whole admin home.
 *
 * Deliberately the plain shared `Select` with a `value` / `onChange` pair of
 * exactly this shape: batch 3 replaces it with the unified owner filter, and
 * that swap must not touch the sections or the screen.
 */
export function OwnerFilter({ value, onChange, className }: OwnerFilterProps) {
  const { t } = useI18n()
  const label = useOwnerLabel()
  const options = useMemo(
    () => [
      { value: ALL, label: t('allOwners') },
      ...ADMIN_HOME_OWNERS.map((owner) => ({
        value: owner,
        label: label(owner),
      })),
    ],
    [label, t],
  )

  return (
    <Select
      className={className}
      aria-label={t('adminHomeOwnerFilter')}
      value={value ?? ALL}
      options={options}
      onValueChange={(next) =>
        onChange(next === ALL ? null : (next as AdminHomeOwner))
      }
    />
  )
}
