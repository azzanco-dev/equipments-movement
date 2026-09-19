import { useState, type ReactNode } from 'react'
import {
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Field,
  IconButton,
  Input,
  MovementBadge,
  SearchInput,
  Textarea,
  WorkshopPurposeBadge,
} from '@/components/ui'
import { OverlayShowcase } from './OverlayShowcase'
import { SelectPlaceholderShowcase } from './SelectPlaceholderShowcase'
import { DateAndFloatingShowcase } from './DateAndFloatingShowcase'
import { FeedbackAndFormShowcase } from './FeedbackAndFormShowcase'
import { PhotoGalleryShowcase } from './PhotoGalleryShowcase'
import { LastEntrySummaryShowcase } from './LastEntrySummaryShowcase'
import { ImageCompressionShowcase } from './ImageCompressionShowcase'
import { LightboxShowcase } from './LightboxShowcase'
import { MiniTableShowcase } from './MiniTableShowcase'
import { NoticeShowcase } from './NoticeShowcase'

// Live review of the shared components on /ui-kit. Sample copy only.
export function ComponentShowcase() {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">الـ components (للمراجعة)</h2>
      <ButtonsShowcase />
      <FieldsShowcase />
      <BadgesShowcase />
      <OverlayShowcase />
      <SelectPlaceholderShowcase />
      <DateAndFloatingShowcase />
      <FeedbackAndFormShowcase />
      <PhotoGalleryShowcase />
      <LastEntrySummaryShowcase />
      <ImageCompressionShowcase />
      <LightboxShowcase />
      <MiniTableShowcase />
      <NoticeShowcase />
    </div>
  )
}

function ShowcaseSection({
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function ButtonsShowcase() {
  const [loading, setLoading] = useState(false)
  const simulateSave = () => {
    setLoading(true)
    window.setTimeout(() => setLoading(false), 2000)
  }
  return (
    <ShowcaseSection
      title="الازرار"
      description="Button و IconButton. الارتفاع 40 بكسل على الجوال و36 على الكمبيوتر (معتمد)، والخط 14. الزر الايقوني لازم يكون له اسم يقرا للمكفوفين."
    >
      <Row label="الانواع">
        <Button variant="primary">حفظ</Button>
        <Button variant="outline">الغاء</Button>
        <Button variant="ghost">تعديل</Button>
        <Button variant="danger" icon={<Trash2 size={15} />}>
          حذف
        </Button>
      </Row>
      <Row label="مع ايقونة">
        <Button variant="primary" icon={<LogIn size={16} />}>
          تسجيل دخول
        </Button>
        <Button variant="outline" icon={<LogOut size={16} />}>
          تسجيل خروج
        </Button>
        <Button variant="outline" icon={<Plus size={16} />}>
          اضافة معدة
        </Button>
      </Row>
      <Row label="الاحجام">
        <Button variant="primary" size="sm">
          صغير
        </Button>
        <Button variant="primary">عادي</Button>
        <Button variant="outline" size="sm">
          صغير
        </Button>
        <Button variant="outline">عادي</Button>
      </Row>
      <Row label="الحالات">
        <Button variant="primary" loading={loading} onClick={simulateSave}>
          {loading ? 'جاري الحفظ' : 'جرب التحميل'}
        </Button>
        <Button variant="primary" disabled>
          معطل
        </Button>
        <Button variant="outline" disabled>
          معطل
        </Button>
      </Row>
      <Row label="ازرار ايقونية">
        <IconButton label="تعديل" icon={<Pencil size={16} />} />
        <IconButton label="حذف" variant="danger" icon={<Trash2 size={16} />} />
        <IconButton
          label="خيارات"
          variant="outline"
          icon={<MoreHorizontal size={16} />}
        />
        <IconButton label="اغلاق" size="sm" icon={<X size={14} />} />
      </Row>
      <Row label="رابط بشكل زر">
        <Button asChild variant="outline">
          <a href="#buttons">عرض كل الحركات</a>
        </Button>
      </Row>
    </ShowcaseSection>
  )
}

function FieldsShowcase() {
  const [search, setSearch] = useState('A-10')
  const [driver, setDriver] = useState('')
  return (
    <ShowcaseSection
      title="الحقول"
      description="Field يربط العنوان والتلميح ورسالة الخطا بالحقل تلقائيا. Input و Textarea و SearchInput."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="رقم المعدة" hint="يظهر على ملصق المعدة">
          {(control) => <Input {...control} placeholder="مثال: A-1024" />}
        </Field>
        <Field
          label="اسم السائق"
          required
          error={driver.trim() ? undefined : 'هذا الحقل مطلوب'}
          hint="اكتب اسم لتختفي رسالة الخطا"
        >
          {(control) => (
            <Input
              {...control}
              value={driver}
              onChange={(event) => setDriver(event.target.value)}
            />
          )}
        </Field>
        <Field label="رقم الجوال">
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              inputMode="tel"
              placeholder="05XXXXXXXX"
              startIcon={<Phone size={15} />}
            />
          )}
        </Field>
        <Field label="الشركة" hint="حقل معطل">
          {(control) => <Input {...control} value="تكوين" disabled readOnly />}
        </Field>
        <Field label="بحث">
          {(control) => (
            <SearchInput
              {...control}
              value={search}
              onValueChange={setSearch}
              placeholder="ابحث برقم المعدة او اللوحة"
            />
          )}
        </Field>
        <Field label="ملاحظات">
          {(control) => (
            <Textarea {...control} placeholder="اكتب اي ملاحظة عن الحركة" />
          )}
        </Field>
      </div>
    </ShowcaseSection>
  )
}

function BadgesShowcase() {
  return (
    <ShowcaseSection
      title="الشارات"
      description="Badge بالوان وظيفية، و MovementBadge هي الطريقة الوحيدة لعرض الدخول والخروج."
    >
      <Row label="الالوان">
        <Badge>عادي</Badge>
        <Badge tone="entry">دخول</Badge>
        <Badge tone="exit">خروج</Badge>
        <Badge tone="success">تم</Badge>
        <Badge tone="warning">تنبيه</Badge>
        <Badge tone="danger">خطا</Badge>
        <Badge tone="info">اليوم</Badge>
      </Row>
      <Row label="الدخول والخروج">
        <MovementBadge type="entry" />
        <MovementBadge type="exit" />
        <MovementBadge type="entry" withIcon />
        <MovementBadge type="exit" withIcon />
      </Row>
      <Row label="غرض الورشة">
        <WorkshopPurposeBadge purpose="maintenance" />
        <WorkshopPurposeBadge purpose="parking" />
      </Row>
    </ShowcaseSection>
  )
}
