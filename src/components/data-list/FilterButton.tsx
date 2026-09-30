import { useState } from 'react'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { countActiveFilters, type FilterBarAsyncField } from './FilterBar'
import { FilterDialog } from './FilterDialog'
import type { FilterField, ListFilter } from './types'

export interface FilterButtonProps {
  /** The config's allowlisted filter fields; no fields renders nothing. */
  fields: FilterField[]
  /** Current filters, owned by the caller (URL state in the list system). */
  filters: ListFilter[]
  /** Receives the complete next filter list; applied immediately. */
  onChange: (filters: ListFilter[]) => void
  /** Relational filter searches by field key. */
  asyncFields?: Record<string, FilterBarAsyncField>
  className?: string
}

/**
 * The "Filters (n)" button and its `FilterDialog`, for a list that has its own
 * search row instead of `DataListToolbar` (the two home tabs). Same contract
 * as the toolbar's button: the filters live behind it in a dialog of small
 * fields, and the active count is shown on the button.
 */
export function FilterButton({
  fields,
  filters,
  onChange,
  asyncFields,
  className,
}: FilterButtonProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!fields.length) return null
  const active = countActiveFilters(filters)
  return (
    <>
      <Button
        variant="outline"
        aria-haspopup="dialog"
        className={className}
        onClick={() => setOpen(true)}
      >
        <Filter size={15} aria-hidden="true" />
        <span>
          {t('filters')}
          {active > 0 ? ` (${active})` : ''}
        </span>
      </Button>
      <FilterDialog
        open={open}
        onOpenChange={setOpen}
        fields={fields}
        filters={filters}
        onChange={onChange}
        asyncFields={asyncFields}
      />
    </>
  )
}
