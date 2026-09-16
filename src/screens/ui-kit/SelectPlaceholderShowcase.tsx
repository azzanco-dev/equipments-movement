import { useState, type ReactNode } from 'react'
import { Field, Input, Select, SearchInput, Textarea } from '@/components/ui'
import type { SelectOption } from '@/components/ui'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'

// Third component batch on /ui-kit: long two-line dropdown options (name +
// id/mobile secondary line) and one unified placeholder color/size across
// fields. Sample copy only.

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}

const DRIVER_OPTIONS_AR: SelectOption[] = [
  {
    value: 'khaled',
    label: 'خالد العتيبي',
    description: 'اقامة رقم 1122334455',
  },
  {
    value: 'saleh',
    label: 'سالم عبدالله بن سعيد القحطاني الحربي',
    description: 'اقامة رقم 2456789012 · جوال 0555123456',
  },
  {
    value: 'rashed',
    label: 'راشد علي',
    description: 'اقامة رقم 3344556677',
  },
]

const DRIVER_OPTIONS_EN: SelectOption[] = [
  {
    value: 'khaled-en',
    label: 'Khaled Al-Otaibi',
    description: 'Residence No. 1122334455',
  },
  {
    value: 'saleh-en',
    label: 'Abdullah Mohammed Saeed Al-Qahtani Al-Harbi',
    description: 'Residence No. 2456789012 · Mobile 0555123456',
  },
  {
    value: 'rashed-en',
    label: 'Rashed Ali',
    description: 'Residence No. 3344556677',
  },
]

const ASYNC_DRIVERS: AsyncSearchSelectOption[] = [
  {
    value: 'a1',
    label: 'سالم عبدالله بن سعيد القحطاني الحربي',
    description: 'اقامة رقم 2456789012 · جوال 0555123456',
  },
  { value: 'a2', label: 'خالد العتيبي', description: 'اقامة رقم 1122334455' },
  {
    value: 'a3',
    label: 'Abdullah Mohammed Saeed Al-Qahtani',
    description: 'Residence No. 9988776655',
  },
]

async function loadAsyncDrivers(
  query: string,
): Promise<AsyncSearchSelectOption[]> {
  await new Promise((resolve) => window.setTimeout(resolve, 150))
  const q = query.trim().toLowerCase()
  if (!q) return ASYNC_DRIVERS
  return ASYNC_DRIVERS.filter(
    (option) =>
      option.label.toLowerCase().includes(q) ||
      (option.description ?? '').toLowerCase().includes(q),
  )
}

function LongOptionsShowcase() {
  const [driverAr, setDriverAr] = useState('')
  const [driverEn, setDriverEn] = useState('')
  const [asyncValue, setAsyncValue] = useState('')
  const [asyncOption, setAsyncOption] =
    useState<AsyncSearchSelectOption | null>(null)

  return (
    <Section
      title="نصوص طويلة داخل القوائم (Select و AsyncSearchSelect)"
      description="اسم السائق ورقم الاقامة قد يكونان طويلين. السطر الثاني يظهر تحت العنوان بلون خافت، والنص الطويل يلتف بدل ما ينقطع. جرب بالعربي وبالانجليزي."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="السائق (Select، عربي)" hint="القائمة تلتف لسطرين">
          {(control) => (
            <Select
              {...control}
              value={driverAr}
              onValueChange={setDriverAr}
              options={DRIVER_OPTIONS_AR}
              placeholder="اختر السائق"
            />
          )}
        </Field>
        <div dir="ltr">
          <Field label="Driver (Select, English)" hint="Long labels wrap">
            {(control) => (
              <Select
                {...control}
                value={driverEn}
                onValueChange={setDriverEn}
                options={DRIVER_OPTIONS_EN}
                placeholder="Choose a driver"
              />
            )}
          </Field>
        </div>
      </div>
      <Field
        label="السائق (AsyncSearchSelect)"
        hint="بحث تجريبي، النتائج ثابتة محليا"
      >
        {() => (
          <AsyncSearchSelect
            value={asyncValue}
            selectedOption={asyncOption}
            onChange={(value, option) => {
              setAsyncValue(value)
              setAsyncOption(option)
            }}
            loadOptions={loadAsyncDrivers}
            placeholder="ابحث عن سائق بالاسم"
          />
        )}
      </Field>
    </Section>
  )
}

function PlaceholderShowcase() {
  return (
    <Section
      title="توحيد لون وحجم التلميح (Placeholder)"
      description="كل الحقول تستخدم نفس لون التلميح، وهو لون فاتح اخف من النص المكتوب، بحجم خط اصغر منه (13 بكسل بدل 14)، بدون خط مائل، بدل الالوان والاحجام المختلفة سابقا."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="حقل نصي">
          {(control) => <Input {...control} placeholder="مثال: A-1024" />}
        </Field>
        <Field label="بحث">
          {(control) => (
            <SearchInput
              {...control}
              value=""
              onValueChange={() => {}}
              placeholder="ابحث برقم المعدة"
            />
          )}
        </Field>
        <Field label="ملاحظات">
          {(control) => (
            <Textarea {...control} placeholder="اكتب ملاحظة عن الحركة" />
          )}
        </Field>
        <Field label="قائمة منسدلة">
          {(control) => (
            <Select
              {...control}
              options={[{ value: 'x', label: 'خيار' }]}
              placeholder="اختر عنصر"
            />
          )}
        </Field>
      </div>
    </Section>
  )
}

export function SelectPlaceholderShowcase() {
  return (
    <>
      <LongOptionsShowcase />
      <PlaceholderShowcase />
    </>
  )
}
