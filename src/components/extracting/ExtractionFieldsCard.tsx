import type { HTMLAttributes, ReactNode } from 'react'
import { PasswordInput } from '@/components/PasswordInput'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select, type SelectOption } from '@/components/ui/Select'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  COMPANY_OPTIONS,
  DATE_FIELDS,
  isFieldRequired,
  type ExtractionFieldKey,
  type ExtractionForm,
  type PublishTargets,
} from '@/lib/extracting/form'
import { FIELD_LABELS } from '@/lib/extracting/messages'
import type { FieldErrors } from '@/lib/formValidation'

/** Fixed choices whose labels are translated. */
const TRANSLATED_OPTIONS: Partial<
  Record<ExtractionFieldKey, Array<[string, TranslationKey]>>
> = {
  gender: [
    ['Male', 'extractingMale'],
    ['Female', 'extractingFemale'],
  ],
  language: [
    ['ar', 'extractingLanguageAr'],
    ['en', 'extractingLanguageEn'],
  ],
}

/** Fixed choices shown as stored, e.g. ERPNext record names. */
const LITERAL_OPTIONS: Partial<Record<ExtractionFieldKey, readonly string[]>> =
  {
    company: COMPANY_OPTIONS,
  }

const INPUT_MODES: Partial<
  Record<ExtractionFieldKey, HTMLAttributes<HTMLInputElement>['inputMode']>
> = {
  id_number: 'numeric',
  employee_number: 'numeric',
  mobile_number: 'tel',
  ctc: 'decimal',
  email: 'email',
}

function selectOptions(
  key: ExtractionFieldKey,
  t: (key: TranslationKey) => string,
): SelectOption[] | null {
  const translated = TRANSLATED_OPTIONS[key]
  if (translated)
    return translated.map(([value, label]) => ({ value, label: t(label) }))
  const literal = LITERAL_OPTIONS[key]
  return literal ? literal.map((value) => ({ value, label: value })) : null
}

interface ExtractionFieldsCardProps {
  title: TranslationKey
  fields: readonly ExtractionFieldKey[]
  form: ExtractionForm
  errors: FieldErrors<ExtractionForm>
  targets: PublishTargets
  onChange: (key: ExtractionFieldKey, value: string) => void
  /** Extra grid cells after the fields, e.g. a reference-only lookup. */
  children?: ReactNode
}

export function ExtractionFieldsCard({
  title,
  fields,
  form,
  errors,
  targets,
  onChange,
  children,
}: ExtractionFieldsCardProps) {
  const { t } = useI18n()
  return (
    <Card className="space-y-4">
      <SectionHeader as="h2" title={t(title)} />
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((key) => {
          const error = errors[key]
          const options = selectOptions(key, t)
          return (
            <Field
              key={key}
              name={key}
              label={t(FIELD_LABELS[key])}
              required={isFieldRequired(key, targets)}
              error={error ? t(error) : undefined}
            >
              {(control) =>
                options ? (
                  <Select
                    {...control}
                    value={form[key]}
                    onValueChange={(value) => onChange(key, value)}
                    placeholder={
                      key === 'gender' ? t('extractingSelectGender') : undefined
                    }
                    options={options}
                  />
                ) : key === 'password' ? (
                  <PasswordInput
                    {...control}
                    autoComplete="new-password"
                    value={form[key]}
                    onChange={(event) => onChange(key, event.target.value)}
                  />
                ) : (
                  <Input
                    {...control}
                    type={key === 'email' ? 'email' : 'text'}
                    inputMode={INPUT_MODES[key]}
                    placeholder={
                      (DATE_FIELDS as readonly string[]).includes(key)
                        ? t('extractingDatePlaceholder')
                        : undefined
                    }
                    value={form[key]}
                    onChange={(event) => onChange(key, event.target.value)}
                  />
                )
              }
            </Field>
          )
        })}
        {children}
      </div>
    </Card>
  )
}
