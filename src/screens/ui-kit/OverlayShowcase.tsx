import { useState, type ReactNode } from 'react'
import { Copy, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import {
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useConfirm,
} from '@/components/ui'

// Second component batch on /ui-kit. Sample copy only.
const COMPANIES = [
  { value: 'united', label: 'شركة البناء المتحد' },
  { value: 'takween', label: 'تكوين' },
  { value: 'azzani', label: 'العزاني' },
  { value: 'closed', label: 'شركة موقوفة', disabled: true },
]

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

export function OverlayShowcase() {
  return (
    <>
      <SelectShowcase />
      <DialogShowcase />
      <MenuShowcase />
      <TabsShowcase />
    </>
  )
}

function SelectShowcase() {
  const [company, setCompany] = useState('')
  return (
    <Section
      title="القائمة المنسدلة (Select)"
      description="نفس ارتفاع الحقول، تشتغل بالكيبورد وبالاتجاه العربي. للقوائم القصيرة الثابتة، والقوائم الكبيرة تبقى على البحث من السيرفر."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="الشركة" hint="اختر من القائمة">
          {(control) => (
            <Select
              {...control}
              value={company}
              onValueChange={setCompany}
              options={COMPANIES}
              placeholder="اختر الشركة"
            />
          )}
        </Field>
        <Field
          label="المشروع"
          required
          error={company ? undefined : 'اختر الشركة اولا'}
        >
          {(control) => (
            <Select
              {...control}
              options={[{ value: 'road', label: 'طريق الملك فهد' }]}
              placeholder="اختر المشروع"
            />
          )}
        </Field>
        <Field label="الحالة" hint="قائمة معطلة">
          {(control) => (
            <Select
              {...control}
              disabled
              defaultValue="active"
              options={[{ value: 'active', label: 'نشطة' }]}
            />
          )}
        </Field>
      </div>
    </Section>
  )
}

function DialogShowcase() {
  const [formOpen, setFormOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const runDelete = async () => {
    setDeleting(true)
    await new Promise((resolve) => window.setTimeout(resolve, 1500))
    setDeleting(false)
    setDeleteOpen(false)
    setResult('تم الحذف (تجريبي)')
  }

  const askWithHook = async () => {
    const confirmed = await confirm({
      title: 'تسجيل خروج المعدة A-1024؟',
      description: 'سيتم تسجيل الخروج بتاريخ اليوم.',
      confirmLabel: 'تسجيل خروج',
    })
    setResult(confirmed ? 'اخترت: تاكيد' : 'اخترت: الغاء')
  }

  return (
    <Section
      title="النوافذ (Dialog و ConfirmDialog)"
      description="النافذة تحبس التركيز وتقفل بزر Esc. نافذة التاكيد بديل confirm() حق المتصفح، وتبقى مفتوحة وقت التنفيذ."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          فتح نافذة نموذج
        </Button>
        <Button
          variant="danger"
          icon={<Trash2 size={15} />}
          onClick={() => setDeleteOpen(true)}
        >
          حذف معدة
        </Button>
        <Button variant="outline" onClick={() => void askWithHook()}>
          تاكيد بطريقة useConfirm
        </Button>
        {result && <span className="text-sm text-muted">{result}</span>}
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title="اضافة سائق"
        description="البيانات تجريبية ولا تحفظ."
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              الغاء
            </Button>
            <Button variant="primary" onClick={() => setFormOpen(false)}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم" required>
            {(control) => <Input {...control} />}
          </Field>
          <Field label="الجوال">
            {(control) => <Input {...control} dir="ltr" inputMode="tel" />}
          </Field>
          <Field label="الشركة" className="sm:col-span-2">
            {(control) => (
              <Select
                {...control}
                options={COMPANIES}
                placeholder="اختر الشركة"
              />
            )}
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title="حذف المعدة A-1024؟"
        description="لا يمكن التراجع عن الحذف."
        confirmLabel="حذف"
        loading={deleting}
        onConfirm={runDelete}
      />
      {confirmDialog}
    </Section>
  )
}

function MenuShowcase() {
  const [action, setAction] = useState<string | null>(null)
  return (
    <Section
      title="قائمة الاجراءات (DropdownMenu)"
      description="لاجراءات الصف في الجداول والكروت بدل صف ايقونات. تشتغل بالكيبورد، والحذف بلون الخطا."
    >
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label="اجراءات المعدة"
              variant="outline"
              icon={<MoreHorizontal size={16} />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>A-1024 · حفار</DropdownMenuLabel>
            <DropdownMenuItem
              icon={<Eye size={15} />}
              onSelect={() => setAction('عرض التفاصيل')}
            >
              عرض التفاصيل
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Pencil size={15} />}
              onSelect={() => setAction('تعديل')}
            >
              تعديل
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Copy size={15} />}
              onSelect={() => setAction('نسخ الكود')}
            >
              نسخ الكود
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              tone="danger"
              icon={<Trash2 size={15} />}
              onSelect={() => setAction('حذف')}
            >
              حذف
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-sm text-muted">
          {action ? `اخترت: ${action}` : 'افتح القائمة واختر اجراء'}
        </span>
      </div>
    </Section>
  )
}

function TabsShowcase() {
  return (
    <Section
      title="التبويبات (Tabs)"
      description="نوعين: خط سفلي لاقسام الصفحة، ومجزا للفلاتر القصيرة مثل فترة التقرير."
    >
      <Tabs defaultValue="logs">
        <TabsList aria-label="اقسام السجل">
          <TabsTrigger value="logs">سجل الحركات</TabsTrigger>
          <TabsTrigger value="reports">التقارير</TabsTrigger>
          <TabsTrigger value="workshop">الورشة</TabsTrigger>
        </TabsList>
        <TabsContent value="logs" className="text-sm text-muted">
          محتوى سجل الحركات
        </TabsContent>
        <TabsContent value="reports" className="text-sm text-muted">
          محتوى التقارير
        </TabsContent>
        <TabsContent value="workshop" className="text-sm text-muted">
          محتوى الورشة
        </TabsContent>
      </Tabs>
      <Tabs defaultValue="month">
        <TabsList variant="segmented" aria-label="فترة التقرير">
          <TabsTrigger value="today">اليوم</TabsTrigger>
          <TabsTrigger value="week">هذا الاسبوع</TabsTrigger>
          <TabsTrigger value="month">هذا الشهر</TabsTrigger>
          <TabsTrigger value="custom">فترة مخصصة</TabsTrigger>
        </TabsList>
      </Tabs>
    </Section>
  )
}
