import { Button, Dialog } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  FilterBar,
  countActiveFilters,
  type FilterBarAsyncField,
} from './FilterBar'
import type { FilterField, ListFilter } from './types'

export interface FilterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The config's allowlisted filter fields. */
  fields: FilterField[]
  filters: ListFilter[]
  onChange: (filters: ListFilter[]) => void
  asyncFields?: Record<string, FilterBarAsyncField>
}

/**
 * The list filters, behind the toolbar's "Filters" button (owner review,
 * 2026-09-29): a shared `Dialog` whose body is `FilterBar`.
 *
 * Apply mode is immediate: every change goes straight to the caller (the URL
 * in the list system), as it did inline, so there is no separate apply step
 * and nothing is lost if the dialog is dismissed. Text filters keep their
 * ~300 ms pause and flush a pending draft when the dialog closes. "Done" only
 * closes; "Clear all" empties every filter and keeps the dialog open.
 */
export function FilterDialog({
  open,
  onOpenChange,
  fields,
  filters,
  onChange,
  asyncFields,
}: FilterDialogProps) {
  const { t } = useI18n()
  const active = countActiveFilters(filters)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('filters')}
      description={t('filterDialogDesc')}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={active === 0}
            onClick={() => onChange([])}
          >
            {t('clearAll')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t('filterDialogDone')}
          </Button>
        </>
      }
    >
      <FilterBar
        fields={fields}
        filters={filters}
        onChange={onChange}
        asyncFields={asyncFields}
      />
    </Dialog>
  )
}
