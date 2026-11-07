import { useEffect, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import {
  Building2,
  Briefcase,
  CheckCircle2,
  Eye,
  FileText,
  Files,
  FolderOpen,
  ImageIcon,
  Landmark,
  MapPin,
  Plus,
  ReceiptText,
  RefreshCw,
  ScrollText,
  Trash2,
  UploadCloud,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui'

/**
 * Owner 2026-11-07: «نبغى نضيف امكانية رفع الملفات pdf او صور في معلومات
 * الموردين والشركات مثل السجل التجاري شهادة الضريبة شهادة الايبان العنوان
 * الوطني», then «ابدا» on the plan: one current file per document type
 * («مستندات اخرى» takes several, each named by the user), PDF or an image up
 * to 5 MB (owner «خلي الحد الاقصى 5 ميقا»), the documents are not counted in
 * the completeness ring, view for the readers of the list and upload /
 * replace / delete for its edit key. His reviews the same day: «بدون تاريخ
 * الانتهاء ماعلينا منهم وبدون تاريخ الرفع ومين رفعه», «شعارات لكل نوع
 * مستند», then «حسن الشكل … واضف الوان وحياة»: every type has its own light
 * colour (the chart shades, light and dark), a coloured icon tile, a
 * progress bar, a lift on hover and a drop zone that lights up. Sample data
 * only: nothing is uploaded or stored; a picked file is previewed in this
 * browser only.
 */

type PartyKind = 'lessor' | 'company'
type DocType =
  | 'commercial_register'
  | 'tax_certificate'
  | 'iban_certificate'
  | 'national_address'
  | 'other'

interface SampleDoc {
  id: string
  type: DocType
  name: string
  kind: 'pdf' | 'image'
  sizeMb: number
  /** The name of an extra document («مستندات اخرى»). */
  title?: string
  /** A file picked in this mockup (an object URL), previewed locally. */
  previewUrl?: string
}

/** Each type: its icon and its light colour (a chart shade + its stroke). */
const DOC_STYLE: Record<DocType, { icon: LucideIcon; tone: number }> = {
  commercial_register: { icon: ScrollText, tone: 3 }, // blue
  tax_certificate: { icon: ReceiptText, tone: 2 }, // amber
  iban_certificate: { icon: Landmark, tone: 1 }, // green
  national_address: { icon: MapPin, tone: 5 }, // violet
  other: { icon: Files, tone: 6 }, // teal
}

const toneBg = (tone: number): CSSProperties => ({
  backgroundColor: `var(--chart-${tone})`,
  color: `var(--chart-stroke-${tone})`,
})

const DOC_LABELS: Record<DocType, string> = {
  commercial_register: 'السجل التجاري',
  tax_certificate: 'شهادة الضريبة',
  iban_certificate: 'شهادة الايبان',
  national_address: 'العنوان الوطني',
  other: 'مستندات اخرى',
}

const DOC_TYPES: Record<PartyKind, DocType[]> = {
  lessor: [
    'commercial_register',
    'tax_certificate',
    'iban_certificate',
    'national_address',
  ],
  // The clients have no IBAN (0175), so no IBAN certificate.
  company: ['commercial_register', 'tax_certificate', 'national_address'],
}

const SAMPLE: Record<PartyKind, SampleDoc[]> = {
  lessor: [
    { id: 'l1', type: 'commercial_register', name: 'CR-7001234567.pdf', kind: 'pdf', sizeMb: 0.8 },
    { id: 'l2', type: 'tax_certificate', name: 'vat-certificate.jpg', kind: 'image', sizeMb: 2.4 },
    { id: 'l3', type: 'iban_certificate', name: 'iban-alrajhi.pdf', kind: 'pdf', sizeMb: 0.3 },
    {
      id: 'l4',
      type: 'other',
      name: 'contract-2026.pdf',
      kind: 'pdf',
      sizeMb: 4.1,
      title: 'عقد الايجار الموقع',
    },
  ],
  company: [
    { id: 'c1', type: 'commercial_register', name: 'cr-takween.pdf', kind: 'pdf', sizeMb: 1.1 },
    { id: 'c2', type: 'national_address', name: 'national-address.png', kind: 'image', sizeMb: 0.6 },
  ],
}

const MAX_MB = 5
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'

function sizeLabel(mb: number) {
  return mb < 1 ? `${Math.round(mb * 1024)} كيلو` : `${mb.toFixed(1)} ميغا`
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      </div>
      {children}
    </section>
  )
}

/** The type's icon in its own colour. */
function TypeIcon({ type, size = 'md' }: { type: DocType; size?: 'sm' | 'md' }) {
  const { icon: Icon, tone } = DOC_STYLE[type]
  return (
    <span
      aria-hidden="true"
      style={toneBg(tone)}
      className={
        size === 'md'
          ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl'
          : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg'
      }
    >
      <Icon size={size === 'md' ? 20 : 15} />
    </span>
  )
}

/** The file itself: an image (never cropped) or a PDF sheet in the type's colour. */
function FileThumb({ doc }: { doc: SampleDoc }) {
  const tone = DOC_STYLE[doc.type].tone
  return (
    <div
      className="relative flex h-16 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-bg"
      aria-hidden="true"
    >
      {doc.previewUrl && doc.kind === 'image' ? (
        <img src={doc.previewUrl} alt="" className="h-full w-full object-contain" />
      ) : doc.kind === 'image' ? (
        <ImageIcon size={20} className="text-muted" />
      ) : (
        <FileText size={20} style={{ color: `var(--chart-stroke-${tone})` }} />
      )}
      <span
        style={toneBg(tone)}
        className="absolute inset-x-0 bottom-0 py-px text-center text-[9px] font-semibold"
      >
        {doc.kind === 'pdf' ? 'PDF' : 'IMG'}
      </span>
    </div>
  )
}

const TILE =
  'group rounded-xl border bg-bg p-3 transition duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-md'

function DocumentTile({
  type,
  doc,
  canEdit,
  onUpload,
  onRemove,
}: {
  type: DocType
  doc?: SampleDoc
  canEdit: boolean
  onUpload: () => void
  onRemove: () => void
}) {
  if (!doc)
    return (
      <div className={`${TILE} flex min-h-28 flex-col justify-between gap-3 border-dashed`}>
        <div className="flex items-center gap-3">
          <span className="opacity-60 transition-opacity group-hover:opacity-100">
            <TypeIcon type={type} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{DOC_LABELS[type]}</p>
            <p className="text-xs text-placeholder">غير مرفوع</p>
          </div>
        </div>
        {canEdit && (
          <Button
            size="sm"
            icon={<UploadCloud size={14} aria-hidden="true" />}
            onClick={onUpload}
            className="self-start"
          >
            رفع ملف
          </Button>
        )}
      </div>
    )

  // An extra file is named by the user («عقد الايجار الموقع»), else «مستند اخر».
  const title = type === 'other' ? (doc.title ?? 'مستند اخر') : DOC_LABELS[type]
  return (
    <div className={`${TILE} flex min-h-28 flex-col gap-3`}>
      <div className="flex items-start gap-3">
        <TypeIcon type={type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--success)]">
            <CheckCircle2 size={13} aria-hidden="true" />
            مرفوع
          </p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <IconButton size="sm" label="عرض" title="عرض" icon={<Eye size={15} />} />
          {canEdit && (
            <>
              <IconButton
                size="sm"
                label="استبدال"
                title="استبدال"
                icon={<RefreshCw size={15} />}
                onClick={onUpload}
              />
              <IconButton
                size="sm"
                label="حذف"
                title="حذف"
                icon={<Trash2 size={15} />}
                onClick={onRemove}
              />
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-lg bg-[var(--surface)] p-2">
        <FileThumb doc={doc} />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium" title={doc.name}>
            <bdi dir="ltr">{doc.name}</bdi>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {sizeLabel(doc.sizeMb)} · {doc.kind === 'pdf' ? <bdi dir="ltr">PDF</bdi> : 'صورة'}
          </p>
        </div>
      </div>
    </div>
  )
}

/** The upload form, shown inline here (a small dialog in the real screen). */
function UploadForm({
  type,
  replacing,
  onCancel,
  onSave,
}: {
  type: DocType
  replacing: boolean
  onCancel: () => void
  onSave: (doc: SampleDoc) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const other = type === 'other'
  const tone = DOC_STYLE[type].tone

  const pick = (picked: File | undefined) => {
    setError('')
    if (!picked) return
    if (!ACCEPT.split(',').includes(picked.type)) {
      setError('نوع الملف غير مقبول: PDF او صورة JPG او PNG او WEBP فقط')
      return
    }
    if (picked.size > MAX_MB * 1024 * 1024) {
      setError(`حجم الملف اكبر من ${MAX_MB} ميغا`)
      return
    }
    setFile(picked)
  }

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    pick(event.dataTransfer.files?.[0])
  }

  const save = () => {
    if (!file) {
      setError('اختر ملفا اولا')
      return
    }
    if (other && !title.trim()) {
      setError('اكتب اسم المستند')
      return
    }
    onSave({
      id: `local-${Date.now()}`,
      type,
      name: file.name,
      kind: file.type === 'application/pdf' ? 'pdf' : 'image',
      sizeMb: file.size / 1024 / 1024,
      title: other ? title.trim() : undefined,
      previewUrl: URL.createObjectURL(file),
    })
  }

  return (
    <div className="space-y-3 rounded-xl border bg-bg p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <TypeIcon type={type} size="sm" />
        <h4 className="flex-1 text-sm font-semibold">
          {replacing ? 'استبدال' : 'رفع'} {other ? 'مستند اخر' : DOC_LABELS[type]}
        </h4>
        <IconButton size="sm" label="اغلاق" icon={<X size={15} />} onClick={onCancel} />
      </div>
      {replacing && <p className="text-xs text-muted">الملف الجديد يحل محل الحالي.</p>}
      <label
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        style={
          dragging || file
            ? { backgroundColor: `var(--chart-${tone})`, borderColor: `var(--chart-stroke-${tone})` }
            : undefined
        }
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-[var(--surface)] px-4 py-7 text-center transition-colors duration-200"
      >
        {file ? (
          <CheckCircle2 size={26} style={{ color: `var(--chart-stroke-${tone})` }} aria-hidden="true" />
        ) : (
          <UploadCloud
            size={26}
            className={`text-muted transition-transform duration-200 ${dragging ? 'motion-safe:-translate-y-1' : ''}`}
            aria-hidden="true"
          />
        )}
        <span className="text-sm font-medium">
          {file ? <bdi dir="ltr">{file.name}</bdi> : dragging ? 'افلت الملف هنا' : 'اسحب الملف هنا او اختره'}
        </span>
        <span className="text-xs text-muted">
          {file
            ? `${sizeLabel(file.size / 1024 / 1024)} · اضغط لاختيار ملف اخر`
            : `PDF او صورة (JPG، PNG، WEBP) حتى ${MAX_MB} ميغا · او صور المستند بالجوال`}
        </span>
        <input
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => pick(event.target.files?.[0])}
        />
      </label>
      {other && (
        <label className="block space-y-1.5">
          <span className="label">اسم المستند</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="مثل: عقد الايجار"
            className="input h-10 w-full text-base md:h-9 md:text-sm"
          />
        </label>
      )}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>الغاء</Button>
        <Button variant="primary" onClick={save}>
          حفظ
        </Button>
      </div>
    </div>
  )
}

export function PartyDocumentsMockup() {
  const [kind, setKind] = useState<PartyKind>('lessor')
  const [canEdit, setCanEdit] = useState(true)
  const [docs, setDocs] = useState<Record<PartyKind, SampleDoc[]>>(SAMPLE)
  const [uploading, setUploading] = useState<{ type: DocType; replacing: boolean } | null>(null)

  // Free the local previews when the mockup goes away.
  useEffect(
    () => () => {
      for (const list of Object.values(docs))
        for (const doc of list) if (doc.previewUrl) URL.revokeObjectURL(doc.previewUrl)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const list = docs[kind]
  const types = DOC_TYPES[kind]
  const others = list.filter((doc) => doc.type === 'other')
  const filled = types.filter((type) => list.some((doc) => doc.type === type)).length
  const percent = Math.round((filled / types.length) * 100)
  const barColor =
    percent >= 100 ? 'var(--progress-high)' : percent >= 50 ? 'var(--progress-mid)' : 'var(--progress-low)'

  const save = (doc: SampleDoc) => {
    setDocs((current) => {
      const kept =
        doc.type === 'other'
          ? current[kind]
          : current[kind].filter((item) => item.type !== doc.type)
      return { ...current, [kind]: [...kept, doc] }
    })
    setUploading(null)
  }
  const remove = (id: string) =>
    setDocs((current) => ({
      ...current,
      [kind]: current[kind].filter((item) => item.id !== id),
    }))

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={kind === 'lessor' ? 'primary' : 'outline'}
          icon={<Building2 size={14} aria-hidden="true" />}
          onClick={() => {
            setKind('lessor')
            setUploading(null)
          }}
        >
          مورد
        </Button>
        <Button
          size="sm"
          variant={kind === 'company' ? 'primary' : 'outline'}
          icon={<Briefcase size={14} aria-hidden="true" />}
          onClick={() => {
            setKind('company')
            setUploading(null)
          }}
        >
          شركة (عميل)
        </Button>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden="true" />
        <Button
          size="sm"
          variant={canEdit ? 'primary' : 'outline'}
          onClick={() => setCanEdit((value) => !value)}
        >
          {canEdit ? 'صلاحية التعديل' : 'عرض فقط'}
        </Button>
      </div>

      <Panel
        title="1. قسم «المستندات» في نافذة التفاصيل"
        note="يظهر تحت اقسام البيانات في تفاصيل المورد والشركة. لكل نوع لونه وايقونته. ملف واحد لكل نوع، والاستبدال يحل محله. «مستندات اخرى» تقبل اكثر من ملف باسم تكتبه. جرب الرفع بملف من جهازك (او اسحبه): يظهر هنا فقط ولا يرفع لاي مكان."
      >
        <div className="max-w-3xl rounded-xl border bg-[var(--surface)] p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl border bg-bg text-muted"
            >
              <FileText size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold">المستندات</h4>
              <p className="text-xs text-muted">
                {filled === types.length
                  ? 'كل المستندات الاساسية مرفوعة'
                  : `باقي ${types.length - filled} من المستندات الاساسية`}
              </p>
            </div>
            <div className="flex w-36 items-center gap-2">
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-bg"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={types.length}
                aria-valuenow={filled}
                aria-label="المستندات المرفوعة"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${percent}%`, backgroundColor: barColor }}
                />
              </div>
              <span className="text-xs font-medium">
                {filled}/{types.length}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {types.map((type) => {
              const doc = list.find((item) => item.type === type)
              return (
                <DocumentTile
                  key={type}
                  type={type}
                  doc={doc}
                  canEdit={canEdit}
                  onUpload={() => setUploading({ type, replacing: Boolean(doc) })}
                  onRemove={() => doc && remove(doc.id)}
                />
              )
            })}
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span
                  aria-hidden="true"
                  style={toneBg(DOC_STYLE.other.tone)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                >
                  <FolderOpen size={15} />
                </span>
                {DOC_LABELS.other}
                {others.length > 0 && (
                  <span className="rounded-full bg-bg px-2 text-xs text-muted">{others.length}</span>
                )}
              </span>
              {canEdit && (
                <Button
                  size="sm"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={() => setUploading({ type: 'other', replacing: false })}
                >
                  اضافة مستند
                </Button>
              )}
            </div>
            {others.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-bg p-4 text-center text-xs text-placeholder">
                لا توجد مستندات اخرى
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {others.map((doc) => (
                  <DocumentTile
                    key={doc.id}
                    type="other"
                    doc={doc}
                    canEdit={canEdit}
                    onUpload={() => setUploading({ type: 'other', replacing: false })}
                    onRemove={() => remove(doc.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {uploading && (
            <div className="mt-4">
              <UploadForm
                key={`${uploading.type}-${uploading.replacing}`}
                type={uploading.type}
                replacing={uploading.replacing}
                onCancel={() => setUploading(null)}
                onSave={save}
              />
            </div>
          )}
        </div>
      </Panel>

      <Panel title="2. العرض">
        <p className="text-xs text-muted">
          «عرض» يفتح الصورة في عارض الصور المعتمد بدون قص، والـ PDF في تبويب
          جديد. الرابط مؤقت لدقائق، والملفات ما لها رابط عام.
        </p>
      </Panel>
    </div>
  )
}
