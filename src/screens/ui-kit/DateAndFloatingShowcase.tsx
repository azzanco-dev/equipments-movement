import { useState, type ReactNode } from 'react'
import { CircleHelp, Filter, Info, SlidersHorizontal } from 'lucide-react'
import { Button, Field } from '@/components/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/FloatingPopover'
import { Tooltip } from '@/components/ui/Tooltip'
import { DatePicker } from '@/components/ui/DatePicker'
import {
  DateRangeFilter,
  type DateRangeValue,
} from '@/components/ui/DateRangeFilter'
import { saudiPeriodKeys } from '@/lib/saudiTime'

// Fourth component batch on /ui-kit: Popover, Tooltip, DatePicker, and
// DateRangeFilter. Sample copy only; nothing here is wired to real data.

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

export function DateAndFloatingShowcase() {
  return (
    <>
      <PopoverShowcase />
      <TooltipShowcase />
      <DatePickerShowcase />
      <DateRangeFilterShowcase />
    </>
  )
}

function PopoverShowcase() {
  return (
    <Section
      title="النافذة العائمة (Popover)"
      description="نفس لوحة القوائم المنسدلة. تراعي حواف الشاشة، وتعيد التركيز لزر الفتح عند الاغلاق، وتقفل بزر Esc."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" icon={<Filter size={15} />}>
              فتح الفلاتر
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3">
            <p className="text-sm font-medium">فلاتر السجل</p>
            <p className="mt-1 text-xs text-muted">
              محتوى تجريبي: حالة، شركة، مشروع. اضغط Esc او انقر خارج اللوحة
              للاغلاق.
            </p>
          </PopoverContent>
        </Popover>

        <div dir="ltr">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" icon={<SlidersHorizontal size={15} />}>
                Open filters
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3">
              <p className="text-sm font-medium">Log filters</p>
              <p className="mt-1 text-xs text-muted">
                Sample content: status, company, project. Press Esc or click
                outside to close.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </Section>
  )
}

function TooltipShowcase() {
  return (
    <Section
      title="التلميح (Tooltip)"
      description="يظهر بعد 300 ميلي ثانية من التحويم او التركيز، وله Provider خاص فيشتغل بدون اي اعداد اضافي بالتطبيق."
    >
      <div className="flex flex-wrap items-center gap-4">
        <Tooltip content="يحذف الحركة نهائيا ولا يمكن التراجع">
          <Button variant="outline">حذف الحركة</Button>
        </Tooltip>
        <Tooltip content="معطل لان الزيارة مقفلة بالفعل">
          <span tabIndex={0} className="inline-flex">
            <Button variant="outline" disabled>
              تغيير السائق
            </Button>
          </span>
        </Tooltip>
        <Tooltip content="رقم المعدة كما هو مطبوع على اللوحة">
          <span
            tabIndex={0}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted"
          >
            <CircleHelp size={15} />
          </span>
        </Tooltip>

        <div dir="ltr" className="flex flex-wrap items-center gap-4">
          <Tooltip content="Permanently deletes the movement">
            <Button variant="outline">Delete movement</Button>
          </Tooltip>
          <Tooltip
            content="Equipment code as printed on the plate"
            side="bottom"
          >
            <span
              tabIndex={0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted"
            >
              <Info size={15} />
            </span>
          </Tooltip>
        </div>
      </div>
    </Section>
  )
}

function DatePickerShowcase() {
  const [empty, setEmpty] = useState('')
  const [withValue, setWithValue] = useState('2026-09-17')
  const [invalidValue, setInvalidValue] = useState('')
  const [bounded, setBounded] = useState('2026-09-17')

  const [emptyEn, setEmptyEn] = useState('')
  const [withValueEn, setWithValueEn] = useState('2026-09-17')

  return (
    <Section
      title="اختيار التاريخ (DatePicker)"
      description="مفتاح تاريخ YYYY-MM-DD. الاسبوع يبدا الاحد، وتمييز اليوم يعتمد تاريخ السعودية لا تاريخ المتصفح. الكيبورد: الاسهم، PageUp/PageDown، Home/End، Enter، Esc."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="فارغ (افتراضي)">
          {(control) => (
            <DatePicker {...control} value={empty} onChange={setEmpty} />
          )}
        </Field>
        <Field label="بقيمة محددة">
          {(control) => (
            <DatePicker
              {...control}
              value={withValue}
              onChange={setWithValue}
            />
          )}
        </Field>
        <Field
          label="غير صالح (داخل Field)"
          required
          error={invalidValue ? undefined : 'اختر تاريخ الحركة'}
        >
          {(control) => (
            <DatePicker
              {...control}
              value={invalidValue}
              onChange={setInvalidValue}
            />
          )}
        </Field>
        <Field label="معطل" hint="حقل معطل">
          {(control) => (
            <DatePicker
              {...control}
              value="2026-09-10"
              disabled
              onChange={() => {}}
            />
          )}
        </Field>
        <Field
          label="بحد ادنى واقصى"
          hint="محصور بين 1 و30 سبتمبر 2026"
          className="sm:col-span-2"
        >
          {(control) => (
            <DatePicker
              {...control}
              value={bounded}
              onChange={setBounded}
              min="2026-09-01"
              max="2026-09-30"
            />
          )}
        </Field>
      </div>

      <div dir="ltr" className="grid gap-4 sm:grid-cols-2">
        <Field label="Empty (default)">
          {(control) => (
            <DatePicker
              {...control}
              lang="en"
              value={emptyEn}
              onChange={setEmptyEn}
            />
          )}
        </Field>
        <Field label="With a value">
          {(control) => (
            <DatePicker
              {...control}
              lang="en"
              value={withValueEn}
              onChange={setWithValueEn}
            />
          )}
        </Field>
      </div>
    </Section>
  )
}

function DateRangeFilterShowcase() {
  const [range, setRange] = useState<DateRangeValue>({
    preset: 'month',
    ...saudiPeriodKeys('month'),
  })
  const [rangeEn, setRangeEn] = useState<DateRangeValue>({
    preset: 'today',
    ...saudiPeriodKeys('today'),
  })

  return (
    <Section
      title="فلتر الفترة (DateRangeFilter)"
      description="اليوم / هذا الاسبوع / هذا الشهر تحسب تلقائيا بتوقيت السعودية. فترة مخصصة تعرض منتقيي تاريخ ولا تصدر قيمة الا اذا كانت البداية قبل النهاية او تساويها."
    >
      <div className="space-y-2">
        <DateRangeFilter value={range} onChange={setRange} />
        <p dir="ltr" className="text-xs text-muted">
          {range.preset}: {range.from} → {range.to}
        </p>
      </div>

      <div dir="ltr" className="space-y-2">
        <DateRangeFilter value={rangeEn} onChange={setRangeEn} lang="en" />
        <p className="text-xs text-muted">
          {rangeEn.preset}: {rangeEn.from} → {rangeEn.to}
        </p>
      </div>
    </Section>
  )
}
