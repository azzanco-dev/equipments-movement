import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui'
// Imported directly: MultiSelect is not yet wired into the `ui` barrel
// (src/components/ui/index.ts), which is owned separately.
import { MultiSelect } from '@/components/ui/MultiSelect'

// Review of MultiSelect on /ui-kit. All data below is sample data. The demo
// language toggle only swaps the sample options and labels below; shared
// chrome such as the panel's "مسح" / "تم" row keeps following the app's real
// language.

type DemoLang = 'ar' | 'en'

const LABELS: Record<
  DemoLang,
  {
    heading: string
    description: string
    owners: string
    ownersHint: string
    types: string
    typesHint: string
    small: string
    smallHint: string
    disabled: string
    all: string
    count: (value: number) => string
    typeCount: (value: number) => string
    selected: string
    none: string
    options: { value: string; label: string; description?: string }[]
    typeOptions: { value: string; label: string }[]
  }
> = {
  ar: {
    heading: 'MultiSelect — اختيار متعدد',
    description:
      'Radix Popover مع قائمة مربعات اختيار. الارتفاع 40 بكسل على الجوال و36 من 768 بكسل، مثل باقي الحقول المعتمدة.',
    owners: 'الملاك',
    ownersHint: 'لا شيء محدد يعني الكل، والاختيار الثالث يلخص العدد.',
    types: 'انواع المعدات (مع شرائح)',
    typesHint: 'الشرائح تحت الحقل تسمح بالازالة بضغطة واحدة.',
    small: 'المقاس الصغير (28 بكسل)',
    smallHint: 'للجداول واشرطة الادوات، مثل Button وSelect.',
    disabled: 'معطل',
    all: 'الكل',
    count: (value) => `${value} ملاك`,
    typeCount: (value) => `${value} انواع`,
    selected: 'المحدد الان:',
    none: 'لا شيء (اي: الكل)',
    options: [
      { value: 'alazani', label: 'العزاني' },
      { value: 'takween', label: 'تكوين' },
      { value: 'third_party_f', label: 'طرف ثالث F' },
      { value: 'third_party_partnership_b', label: 'طرف ثالث B' },
      {
        value: 'external_supplier',
        label: 'مالك اخر',
        description: 'معدات مستاجرة من مورد خارجي',
      },
    ],
    typeOptions: [
      { value: 'excavator', label: 'حفار' },
      { value: 'loader', label: 'شيول' },
      { value: 'grader', label: 'مسوية' },
      { value: 'roller', label: 'حدالة' },
      { value: 'truck', label: 'قلاب' },
      { value: 'crane', label: 'ونش' },
    ],
  },
  en: {
    heading: 'MultiSelect',
    description:
      'A Radix Popover holding a checkbox list. 40 px on mobile and 36 px from 768 px up, matching the other approved controls.',
    owners: 'Owners',
    ownersHint: 'Nothing selected means all; the third choice summarizes.',
    types: 'Equipment types (with chips)',
    typesHint: 'The chips under the field remove a choice in one click.',
    small: 'Small size (28 px)',
    smallHint: 'For tables and toolbars, like Button and Select.',
    disabled: 'Disabled',
    all: 'All',
    count: (value) => `${value} owners`,
    typeCount: (value) => `${value} types`,
    selected: 'Selected now:',
    none: 'nothing (meaning: all)',
    options: [
      { value: 'alazani', label: 'Al-Azani' },
      { value: 'takween', label: 'Takween' },
      { value: 'third_party_f', label: 'Third party F' },
      { value: 'third_party_partnership_b', label: 'Third party B' },
      {
        value: 'external_supplier',
        label: 'Other owner',
        description: 'Equipment rented from an external supplier',
      },
    ],
    typeOptions: [
      { value: 'excavator', label: 'Excavator' },
      { value: 'loader', label: 'Loader' },
      { value: 'grader', label: 'Grader' },
      { value: 'roller', label: 'Roller' },
      { value: 'truck', label: 'Dump truck' },
      { value: 'crane', label: 'Crane' },
    ],
  },
}

function Row({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted">{hint}</p>
      {children}
    </div>
  )
}

export function MultiSelectShowcase() {
  const [lang, setLang] = useState<DemoLang>('ar')
  const [owners, setOwners] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>(['excavator', 'loader'])
  const [compact, setCompact] = useState<string[]>(['alazani'])
  const label = LABELS[lang]
  const direction = lang === 'ar' ? 'rtl' : 'ltr'

  const names = owners
    .map(
      (value) =>
        label.options.find((option) => option.value === value)?.label ?? value,
    )
    .join(lang === 'ar' ? '، ' : ', ')

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{label.heading}</h3>
          <p className="text-xs text-muted">{label.description}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={lang === 'ar' ? 'primary' : 'outline'}
            onClick={() => setLang('ar')}
          >
            عربي
          </Button>
          <Button
            size="sm"
            variant={lang === 'en' ? 'primary' : 'outline'}
            onClick={() => setLang('en')}
          >
            English
          </Button>
        </div>
      </div>

      <div dir={direction} lang={lang} className="grid gap-4 md:grid-cols-2">
        <Row title={label.owners} hint={label.ownersHint}>
          <MultiSelect
            className="w-full sm:w-72"
            aria-label={label.owners}
            options={label.options}
            value={owners}
            onValueChange={setOwners}
            allLabel={label.all}
            summaryLabel={label.count}
          />
          <p className="text-xs text-muted">
            {label.selected} {owners.length ? names : label.none}
          </p>
        </Row>

        <Row title={label.types} hint={label.typesHint}>
          <MultiSelect
            chips
            className="w-full sm:w-72"
            aria-label={label.types}
            options={label.typeOptions}
            value={types}
            onValueChange={setTypes}
            allLabel={label.all}
            summaryLabel={label.typeCount}
          />
        </Row>

        <Row title={label.small} hint={label.smallHint}>
          <MultiSelect
            size="sm"
            className="w-full sm:w-56"
            aria-label={label.small}
            options={label.options}
            value={compact}
            onValueChange={setCompact}
            allLabel={label.all}
            summaryLabel={label.count}
          />
        </Row>

        <Row title={label.disabled} hint={label.disabled}>
          <MultiSelect
            disabled
            className="w-full sm:w-56"
            aria-label={label.disabled}
            options={label.options}
            value={[]}
            onValueChange={() => undefined}
            allLabel={label.all}
          />
        </Row>
      </div>
    </section>
  )
}
