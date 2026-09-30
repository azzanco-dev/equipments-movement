import { useCallback, useState } from 'react'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { Field } from '@/components/ui/Field'
import { useI18n } from '@/i18n/I18nContext'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'

/**
 * Reference-only equipment picker: shows an equipment's type so the admin can
 * decide the salary without leaving the page. The choice is never part of the
 * form and is not sent to the current system or ERPNext.
 */
export function EquipmentTypeLookup() {
  const { t } = useI18n()
  const [selected, setSelected] = useState<AsyncSearchSelectOption | null>(null)

  const loadEquipment = useCallback(async (query: string) => {
    const term = sanitizeSearchTerm(query)
    let request = supabase
      .from('equipment')
      .select('id,code,type')
      .order('code')
      .limit(20)
    if (term) request = request.or(`code.ilike.%${term}%,type.ilike.%${term}%`)
    const { data, error } = await request
    // Thrown so the selector shows its load-error state, not "no results".
    if (error) throw new Error('equipment_lookup_failed')
    return (data ?? []).map((item) => ({
      value: item.id,
      label: item.code,
      description: item.type,
    }))
  }, [])

  return (
    <Field
      label={t('equipmentNameLabel')}
      hint={
        selected?.description
          ? `${t('equipmentType')}: ${selected.description}`
          : undefined
      }
    >
      {(control) => (
        <AsyncSearchSelect
          {...control}
          value={selected?.value ?? ''}
          selectedOption={selected}
          onChange={(_value, option) => setSelected(option)}
          loadOptions={loadEquipment}
          placeholder={t('selectEquipment')}
        />
      )}
    </Field>
  )
}
