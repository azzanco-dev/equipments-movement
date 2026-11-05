import type { HTMLAttributes, ReactNode } from 'react'
import { Field, Input } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { ShortAddressInput } from '@/components/parties/ShortAddressInput'
import type { TranslationKey } from '@/i18n/translations'
import type { FieldErrors } from '@/lib/formValidation'

/** One optional text field of a supplier / client form (EM-260, 0175). */
export interface PartyFieldSpec<T> {
  field: keyof T & string
  label: TranslationKey
  placeholder?: TranslationKey
  /** Numbers, the email and the IBAN read left to right. */
  ltr?: boolean
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  type?: 'text' | 'email' | 'tel'
  /** Spans both columns from `sm` up (the address). */
  wide?: boolean
  /** The split «RRRD | 2929» control of the short address (0179). */
  control?: 'text' | 'shortAddress'
}

export interface PartyFormSectionProps<T extends object> {
  title: TranslationKey
  fields: readonly PartyFieldSpec<T>[]
  form: T
  errors: FieldErrors<T>
  onChange: (patch: Partial<T>) => void
  /** Controls placed before the text fields in the same grid (the bank
   *  selector of the supplier form, 0177). */
  leading?: ReactNode
}

/**
 * A titled group of optional text fields in the supplier and client forms:
 * «بيانات رسمية», «بيانات الاتصال», «بيانات البنك». Two columns from `sm`
 * up; each field shows its own message under it.
 */
export function PartyFormSection<T extends object>({
  title,
  fields,
  form,
  errors,
  onChange,
  leading,
}: PartyFormSectionProps<T>) {
  const { t } = useI18n()
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{t(title)}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {leading}
        {fields.map((spec) => {
          const error = errors[spec.field]
          return (
            <Field
              key={spec.field}
              label={t(spec.label)}
              name={spec.field}
              className={spec.wide ? 'sm:col-span-2' : undefined}
              error={error && t(error)}
            >
              {(control) =>
                spec.control === 'shortAddress' ? (
                  <ShortAddressInput
                    id={control.id}
                    invalid={control.invalid}
                    aria-describedby={control['aria-describedby']}
                    value={String(form[spec.field] ?? '')}
                    onChange={(value) =>
                      onChange({ [spec.field]: value } as Partial<T>)
                    }
                  />
                ) : (
                  <Input
                    {...control}
                    dir={spec.ltr ? 'ltr' : undefined}
                    type={spec.type ?? 'text'}
                    inputMode={spec.inputMode}
                    placeholder={spec.placeholder && t(spec.placeholder)}
                    value={String(form[spec.field] ?? '')}
                    onChange={(event) =>
                      onChange({
                        [spec.field]: event.target.value,
                      } as Partial<T>)
                    }
                  />
                )
              }
            </Field>
          )
        })}
      </div>
    </section>
  )
}
