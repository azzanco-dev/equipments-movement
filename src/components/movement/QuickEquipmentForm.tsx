import { forwardRef } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Button,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { PlateNumberInput } from '@/components/PlateNumberInput'

export interface QuickEquipmentDraft {
  open: boolean
  plate: string
  chassis: string
  identifierType: 'plate' | 'chassis'
  code: string
  type: string
  lessorId: string
  numberingStatus: 'numbered' | 'unnumbered'
}

export const EMPTY_QUICK_EQUIPMENT: QuickEquipmentDraft = {
  open: false,
  plate: '',
  chassis: '',
  identifierType: 'plate',
  code: '',
  type: '',
  lessorId: '',
  numberingStatus: 'numbered',
}

export interface QuickEquipmentFormProps {
  value: QuickEquipmentDraft
  onChange: (value: QuickEquipmentDraft) => void
  /** The workshop form asks for a numbering status and a plate only. */
  workshopMode: boolean
  saving: boolean
  selectedLessor: AsyncSearchSelectOption | null
  onSelectLessor: (option: AsyncSearchSelectOption | null) => void
  loadEquipmentTypes: (query: string) => Promise<AsyncSearchSelectOption[]>
  loadLessors: (query: string) => Promise<AsyncSearchSelectOption[]>
  onCreateLessor: (query: string) => void
  onCancel: () => void
  onSave: () => void
}

/**
 * Inline quick-create for equipment inside the movement form. It calls the
 * narrowly scoped quick-create database functions through its parent; the
 * fields and validation are unchanged from the legacy panel.
 */
export const QuickEquipmentForm = forwardRef<
  HTMLDivElement,
  QuickEquipmentFormProps
>(function QuickEquipmentForm(
  {
    value,
    onChange,
    workshopMode,
    saving,
    selectedLessor,
    onSelectLessor,
    loadEquipmentTypes,
    loadLessors,
    onCreateLessor,
    onCancel,
    onSave,
  },
  ref,
) {
  const { t } = useI18n()

  return (
    <div ref={ref} className="space-y-2.5 rounded-lg border p-3 text-start">
      <p className="font-semibold">{t('quickEquipmentAdd')}</p>

      {!workshopMode && (
        <RadioGroup
          value={value.identifierType}
          onValueChange={(next) =>
            onChange({
              ...value,
              identifierType: next as 'plate' | 'chassis',
              plate: next === 'chassis' ? '' : value.plate,
            })
          }
          className="grid grid-cols-2 gap-2"
          aria-label={t('plateNumber')}
        >
          <RadioGroupItem value="plate" label={t('plateNumber')} />
          <RadioGroupItem value="chassis" label={t('chassisNumber')} />
        </RadioGroup>
      )}

      {workshopMode && (
        <RadioGroup
          value={value.numberingStatus}
          onValueChange={(next) =>
            onChange({
              ...value,
              numberingStatus: next as 'numbered' | 'unnumbered',
              code: next === 'unnumbered' ? '' : value.code,
            })
          }
          className="flex flex-row gap-4 rounded-lg border p-3"
          aria-label={t('equipmentCode')}
        >
          <RadioGroupItem value="numbered" label={t('numbered')} />
          <RadioGroupItem value="unnumbered" label={t('unnumbered')} />
        </RadioGroup>
      )}

      {workshopMode && value.numberingStatus === 'numbered' && (
        <Field label={t('equipmentCode')} required>
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              placeholder={t('equipmentCodePlaceholder')}
              value={value.code}
              onChange={(event) =>
                onChange({ ...value, code: event.target.value })
              }
            />
          )}
        </Field>
      )}

      {(workshopMode || value.identifierType === 'plate') && (
        <Field label={t('plateNumber')} required>
          {() => (
            <PlateNumberInput
              value={value.plate}
              onChange={(plate) => onChange({ ...value, plate })}
            />
          )}
        </Field>
      )}

      {!workshopMode && (
        <>
          <Field
            label={t('chassisNumber')}
            required={value.identifierType === 'chassis'}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                placeholder={t('chassisNumberPlaceholder')}
                value={value.chassis}
                onChange={(event) =>
                  onChange({ ...value, chassis: event.target.value })
                }
              />
            )}
          </Field>

          <Field label={t('equipmentType')} required>
            {() => (
              <AsyncSearchSelect
                value={value.type}
                selectedOption={
                  value.type ? { value: value.type, label: value.type } : null
                }
                onChange={(type) => onChange({ ...value, type })}
                loadOptions={loadEquipmentTypes}
                placeholder={t('selectEquipmentType')}
              />
            )}
          </Field>

          <Field label={t('externalSupplier')} required>
            {() => (
              <AsyncSearchSelect
                value={value.lessorId}
                selectedOption={selectedLessor}
                onChange={(lessorId, option) => {
                  onChange({ ...value, lessorId })
                  onSelectLessor(option)
                }}
                loadOptions={loadLessors}
                placeholder={t('selectLessor')}
                createLabel={`${t('addNewSupplier')} +`}
                onCreate={onCreateLessor}
                alwaysShowCreate
                disabled={saving}
              />
            )}
          </Field>
        </>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          loading={saving}
          onClick={onSave}
        >
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  )
})
