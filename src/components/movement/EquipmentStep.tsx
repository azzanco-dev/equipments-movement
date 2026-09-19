import type { ReactNode, RefObject } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  SearchInput,
  Select,
  Skeleton,
} from '@/components/ui'
import {
  equipmentStateOption,
  type EntryEquipmentStateFields,
} from '@/lib/entryEquipmentSearch'
import type { Equipment } from '@/lib/types'

// Radix reserves the empty string for "no value", so the "all owners" choice
// carries a sentinel and is mapped back to '' (no filter) for the search RPC.
const ALL_OWNERS = 'all'

export interface EquipmentStepProps {
  search: string
  onSearchChange: (value: string) => void
  ownerFilter: string
  onOwnerFilterChange: (value: string) => void
  equipment: (Equipment & EntryEquipmentStateFields)[]
  loading: boolean
  loadError: boolean
  isEntry: boolean
  /** Site EXIT lists only equipment the signed-in foreman may close. */
  siteExitMode: boolean
  isAdmin: boolean
  onSelect: (equipment: Equipment) => void
  onAddEquipment: () => void
  listRef: RefObject<HTMLDivElement>
  /** The inline quick-create panel, rendered under the list. */
  quickCreateSlot?: ReactNode
}

/** First step of the movement form: find and pick the equipment. */
export function EquipmentStep({
  search,
  onSearchChange,
  ownerFilter,
  onOwnerFilterChange,
  equipment,
  loading,
  loadError,
  isEntry,
  siteExitMode,
  isAdmin,
  onSelect,
  onAddEquipment,
  listRef,
  quickCreateSlot,
}: EquipmentStepProps) {
  const { t, lang } = useI18n()

  return (
    <div className="space-y-4">
      <Field label={t('selectOwner')}>
        {(control) => (
          <Select
            {...control}
            value={ownerFilter || ALL_OWNERS}
            onValueChange={(value) => {
              listRef.current?.scrollTo({ top: 0 })
              onOwnerFilterChange(value === ALL_OWNERS ? '' : value)
            }}
            placeholder={t('allOwners')}
            options={[
              { value: ALL_OWNERS, label: t('allOwners') },
              { value: 'alazani', label: t('ownershipAlazani') },
              { value: 'takween', label: t('ownershipTakween') },
              { value: 'third_party_f', label: t('ownershipThirdPartyF') },
              {
                value: 'third_party_partnership_b',
                label: t('ownershipThirdPartyPartnershipB'),
              },
              {
                value: 'external_supplier',
                label: t('ownershipExternalSupplier'),
              },
            ]}
          />
        )}
      </Field>

      <SearchInput
        value={search}
        onValueChange={onSearchChange}
        placeholder={t('searchingEquipment')}
        dir={lang === 'ar' && !search ? 'rtl' : 'ltr'}
        autoFocus
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <div
          ref={listRef}
          className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2"
        >
          {loadError && (
            <ErrorState
              className="col-span-full"
              title={t('equipmentLoadError')}
            />
          )}
          {!loadError && equipment.length === 0 && (
            <EmptyState
              className="col-span-full"
              title={t('noEquipmentFound')}
              description={
                siteExitMode && !isAdmin
                  ? t('siteExitOwnEquipmentOnly')
                  : undefined
              }
            />
          )}
          {equipment.map((item) => {
            // Badge + ONE secondary state line; available equipment gets
            // neither. Selecting a listed piece keeps today's behavior: the
            // "current status" section and the ENTRY -> ENTRY rejection still
            // come from `get_last_movement`.
            const stateOption = equipmentStateOption(item, lang, t)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className="w-full rounded-lg border px-3 py-2 text-start transition-colors hover:bg-surface-hover"
              >
                <div className="space-y-0.5 text-[13px] leading-4">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{item.code}</span>
                    {stateOption.badge && (
                      <Badge tone={stateOption.badge.tone}>
                        {stateOption.badge.label}
                      </Badge>
                    )}
                  </span>
                  <p className="text-muted">{item.type}</p>
                  {item.plate_number && (
                    <p className="text-muted">
                      {t('plateNumber')}: {item.plate_number}
                    </p>
                  )}
                  {!item.plate_number && item.chassis_number && (
                    <p className="text-muted">
                      {t('chassisNumber')}: {item.chassis_number}
                    </p>
                  )}
                  {stateOption.description && (
                    <p className="truncate-safe text-muted">
                      {stateOption.description}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
          {isEntry && (
            <Button
              variant="outline"
              onClick={onAddEquipment}
              className="h-auto w-full justify-start px-3 py-4 text-start"
            >
              {t('addEquipment')} +
            </Button>
          )}
        </div>
      )}

      {quickCreateSlot}
    </div>
  )
}
