import { useState, type ReactNode } from 'react'
import {
  Building2,
  Calendar,
  Hash,
  Inbox,
  Phone,
  Plus,
  Truck,
  User,
} from 'lucide-react'
import { Button, Field } from '@/components/ui'
import { Checkbox } from '@/components/ui/Checkbox'
import { Switch } from '@/components/ui/Switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { ToastProvider, useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { InfoRow } from '@/components/ui/InfoRow'
import { DescriptionList } from '@/components/ui/DescriptionList'
import { PageHeader } from '@/components/ui/PageHeader'

// Fourth component batch on /ui-kit: form controls (Checkbox/Switch/
// RadioGroup), Toast, loading/empty/error states, and info/page-header
// display components. Sample copy only; nothing here is wired to real data.

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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center">
      <span className="text-xs text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </div>
  )
}

/** Fixed-width frame to review wrapping/stacking at a phone viewport. */
function MobileFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[375px] space-y-3 rounded-xl border p-3">
      {children}
    </div>
  )
}

export function FeedbackAndFormShowcase() {
  return (
    <ToastProvider>
      <div className="space-y-4">
        <h2 className="text-base font-semibold">
          عناصر النماذج والحالات (للمراجعة)
        </h2>
        <CheckboxShowcase />
        <SwitchShowcase />
        <RadioGroupShowcase />
        <ToastShowcase />
        <StatesShowcase />
        <InfoDisplayShowcase />
        <PageHeaderShowcase />
      </div>
    </ToastProvider>
  )
}

function CheckboxShowcase() {
  const [terms, setTerms] = useState(false)
  const [terms2, setTerms2] = useState(true)
  return (
    <Section
      title="مربع الاختيار (Checkbox)"
      description="مربع 20 بكسل داخل صف بارتفاع 40/36 بكسل. الحالة المحددة بلون العلامة الرئيسي (اسود/ابيض حسب الوضع)."
    >
      <Row label="مستقل بعنوان">
        <Checkbox
          checked={terms}
          onCheckedChange={(v) => setTerms(v === true)}
          label="أوافق على الشروط والأحكام"
        />
      </Row>
      <Row label="محدد افتراضيا">
        <Checkbox
          checked={terms2}
          onCheckedChange={(v) => setTerms2(v === true)}
          label="إرسال نسخة بالبريد"
        />
      </Row>
      <Row label="معطل">
        <Checkbox disabled label="خيار معطل" />
        <Checkbox disabled checked label="خيار معطل ومحدد" />
      </Row>
      <Row label="غير صالح">
        <Checkbox invalid label="يجب الموافقة قبل المتابعة" />
      </Row>
      <Row label="داخل Field">
        <div className="max-w-xs">
          <Field label="تأكيد الاستلام" error={terms ? undefined : 'مطلوب'}>
            {(control) => (
              <Checkbox
                {...control}
                checked={terms}
                onCheckedChange={(v) => setTerms(v === true)}
              />
            )}
          </Field>
        </div>
      </Row>
      <div dir="ltr" className="border-t pt-3">
        <Row label="English">
          <Checkbox
            checked={terms}
            onCheckedChange={(v) => setTerms(v === true)}
            label="I agree to the Terms and Conditions"
          />
          <Checkbox disabled label="Disabled option" />
        </Row>
      </div>
    </Section>
  )
}

function SwitchShowcase() {
  const [notify, setNotify] = useState(true)
  const [alerts, setAlerts] = useState(false)
  return (
    <Section
      title="مفتاح التبديل (Switch)"
      description="مسار 20×36 بكسل، والمؤشر ينتقل باتجاه صحيح تلقائيا حسب اتجاه الواجهة (عربي/انجليزي)."
    >
      <Row label="مفعل / معطل">
        <Switch
          checked={notify}
          onCheckedChange={setNotify}
          label="إرسال تنبيه عند الدخول"
        />
        <Switch
          checked={alerts}
          onCheckedChange={setAlerts}
          label="تنبيهات الورشة"
        />
      </Row>
      <Row label="معطل (Disabled)">
        <Switch disabled label="خيار معطل" />
        <Switch disabled defaultChecked label="خيار معطل ومفعل" />
      </Row>
      <Row label="غير صالح">
        <Switch invalid label="يجب تفعيل هذا الخيار" />
      </Row>
      <div dir="ltr" className="border-t pt-3">
        <Row label="English">
          <Switch
            checked={notify}
            onCheckedChange={setNotify}
            label="Notify on entry"
          />
        </Row>
      </div>
    </Section>
  )
}

function RadioGroupShowcase() {
  const [owner, setOwner] = useState('azzani')
  return (
    <Section
      title="مجموعة الاختيار الفردي (RadioGroup)"
      description="نفس مقاسات مربع الاختيار. تعمل بمفاتيح الاسهم وتتبع اتجاه الواجهة."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <RadioGroup value={owner} onValueChange={setOwner}>
          <RadioGroupItem value="azzani" label="العزاني" />
          <RadioGroupItem value="takween" label="تكوين" />
          <RadioGroupItem value="third-f" label="طرف ثالث F" />
          <RadioGroupItem value="disabled" label="خيار معطل" disabled />
        </RadioGroup>
        <div dir="ltr">
          <RadioGroup defaultValue="excavator">
            <RadioGroupItem value="excavator" label="Excavator" />
            <RadioGroupItem value="forklift" label="Forklift" />
            <RadioGroupItem value="loader" label="Loader" />
          </RadioGroup>
        </div>
      </div>
    </Section>
  )
}

function ToastShowcase() {
  const toast = useToast()
  return (
    <Section
      title="التنبيهات المؤقتة (Toast)"
      description="تظهر اسفل الشاشة وتختفي تلقائيا، ويمكن سحبها للاسفل لاغلاقها. زر الاغلاق له اسم مقروء دائما."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => toast({ title: 'تم حفظ التغييرات', tone: 'neutral' })}
        >
          محايد
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast({
              title: 'تم حفظ الحركة بنجاح',
              description: 'رقم الحركة #10245',
              tone: 'success',
            })
          }
        >
          نجاح
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast({
              title: 'المعدة داخل الموقع منذ 12 يوم',
              tone: 'warning',
            })
          }
        >
          تحذير
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast({
              title: 'تعذر حفظ الحركة',
              description: 'تحقق من الاتصال وحاول مرة اخرى.',
              tone: 'danger',
              action: {
                label: 'إعادة المحاولة',
                onClick: () => toast({ title: 'تمت إعادة المحاولة' }),
              },
            })
          }
        >
          خطأ + إجراء
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast({
              title: 'Saved successfully',
              description: 'Movement #10245',
              tone: 'success',
              duration: 0,
            })
          }
        >
          English (no auto-dismiss)
        </Button>
      </div>
    </Section>
  )
}

function StatesShowcase() {
  return (
    <Section
      title="حالات التحميل والفراغ والخطأ"
      description="EmptyState لقائمة فارغة، ErrorState لفشل التحميل بشكل مختلف بصريا (احمر خفيف)، Skeleton و Spinner للتحميل."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyState
          icon={<Inbox size={28} />}
          title="لا توجد حركات بعد"
          description="ستظهر هنا اول ما يتم تسجيل دخول او خروج معدة."
          action={
            <Button variant="outline" size="sm" icon={<Plus size={15} />}>
              تسجيل دخول
            </Button>
          }
        />
        <ErrorState
          title="تعذر تحميل الحركات"
          description="تحقق من الاتصال بالانترنت ثم حاول مرة اخرى."
          onRetry={() => {}}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs text-muted">Skeleton</p>
          <div className="flex items-center gap-3">
            <Skeleton variant="circle" className="h-10 w-10" />
            <div className="flex-1 space-y-2">
              <Skeleton variant="text" className="w-2/3" />
              <Skeleton variant="text" className="w-1/3" />
            </div>
          </div>
          <Skeleton variant="block" className="h-20 w-full" />
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted">Spinner</p>
          <div className="flex items-center gap-4">
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
            <span className="text-sm text-muted">جاري التحميل...</span>
          </div>
        </div>
      </div>
      <div dir="ltr" className="border-t pt-3">
        <EmptyState
          icon={<Inbox size={28} />}
          title="No movements yet"
          description="They will appear here once an entry or exit is recorded."
        />
      </div>
    </Section>
  )
}

function InfoDisplayShowcase() {
  return (
    <Section
      title="عرض المعلومات (InfoRow و DescriptionList)"
      description="القيمة الفارغة تظهر كـ — بدل سطر فارغ. النصوص الطويلة تلتف. رقم الجوال والاكواد تعرض دائما LTR."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <InfoRow
            icon={<Truck size={16} />}
            label="المعدة"
            value="A-1024 · حفار"
          />
          <InfoRow
            icon={<User size={16} />}
            label="السائق"
            value="سعيد محمد بن عبدالله القحطاني"
          />
          <InfoRow
            icon={<Phone size={16} />}
            label="جوال السائق"
            value="0555123456"
            dir="ltr"
          />
          <InfoRow
            icon={<Building2 size={16} />}
            label="الشركة"
            value={undefined}
          />
        </div>
        <DescriptionList
          columns={2}
          items={[
            {
              icon: <Hash size={16} />,
              label: 'الكود',
              value: 'A-1024',
              dir: 'ltr',
            },
            {
              icon: <Calendar size={16} />,
              label: 'التاريخ',
              value: '17/09/2026',
            },
            {
              icon: <Building2 size={16} />,
              label: 'الشركة',
              value: 'شركة البناء المتحد',
            },
            {
              icon: <Phone size={16} />,
              label: 'الجوال',
              value: null,
              dir: 'ltr',
            },
          ]}
        />
      </div>
      <div dir="ltr" className="border-t pt-3">
        <DescriptionList
          columns={2}
          items={[
            { label: 'Code', value: 'A-1024', dir: 'ltr' },
            { label: 'Driver', value: 'Saeed Mohammed Al-Qahtani' },
            { label: 'Company', value: 'Modern Construction Co.' },
            { label: 'Mobile', value: undefined, dir: 'ltr' },
          ]}
        />
      </div>
    </Section>
  )
}

function PageHeaderShowcase() {
  return (
    <Section
      title="ترويسة الصفحة (PageHeader و BackButton)"
      description="سهم الرجوع ينعكس تلقائيا حسب الاتجاه. الاجراءات تلتف على الجوال. جرب العرض الضيق ادناه (375 بكسل)."
    >
      <PageHeader
        title="تفاصيل المعدة"
        description="A-1024 · حفار كاتربيلر"
        onBack={() => {}}
        actions={
          <>
            <Button variant="outline" size="sm">
              تعديل
            </Button>
            <Button variant="primary" size="sm" icon={<Plus size={15} />}>
              تسجيل دخول
            </Button>
          </>
        }
      />
      <MobileFrame>
        <PageHeader
          title="تفاصيل المعدة A-1024"
          description="حفار كاتربيلر 320D التابع لشركة البناء المتحد"
          onBack={() => {}}
          actions={
            <>
              <Button variant="outline" size="sm">
                تعديل
              </Button>
              <Button variant="primary" size="sm" icon={<Plus size={15} />}>
                تسجيل دخول
              </Button>
            </>
          }
        />
      </MobileFrame>
      <div dir="ltr" className="border-t pt-3">
        <PageHeader
          title="Equipment Details"
          description="A-1024 · Caterpillar Excavator"
          onBack={() => {}}
          actions={
            <Button variant="outline" size="sm">
              Edit
            </Button>
          }
        />
      </div>
    </Section>
  )
}
