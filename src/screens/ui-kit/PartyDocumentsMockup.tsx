import { useEffect, useState, type ReactNode } from 'react'
import {
  Building2,
  Briefcase,
  Eye,
  FileText,
  ImageIcon,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui'

/**
 * Owner 2026-11-07: «نبغى نضيف امكانية رفع الملفات pdf او صور في معلومات
 * الموردين والشركات مثل السجل التجاري شهادة الضريبة شهادة الايبان العنوان
 * الوطني», then «ابدا» on the plan: one current file per document type
 * («مستندات اخرى» takes several, each named by the user), PDF or an image up
 * to 10 MB, the documents are not counted in the completeness ring, view for
 * the readers of the list and upload / replace / delete for its edit key.
 * His review the same day: «بدون تاريخ الانتهاء ماعلينا منهم وبدون تاريخ
 * الرفع ومين رفعه» — a tile shows the file only. Sample data only: nothing
 * is uploaded or stored; a file picked here is previewed in this browser only.
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
    {
      id: 'l1',
      type: 'commercial_register',
      name: 'CR-7001234567.pdf',
      kind: 'pdf',
      sizeMb: 0.8,
    },
    {
      id: 'l2',
      type: 'tax_certificate',
      name: 'vat-certificate.jpg',
      kind: 'image',
      sizeMb: 2.4,
    },
    {
      id: 'l3',
      type: 'iban_certificate',
      name: 'iban-alrajhi.pdf',
      kind: 'pdf',
      sizeMb: 0.3,
    },
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
    {
      id: 'c1',
      type: 'commercial_register',
      name: 'cr-takween.pdf',
      kind: 'pdf',
      sizeMb: 1.1,
    },
    {
      id: 'c2',
      type: 'national_address',
      name: 'national-address.png',
      kind: 'image',
      sizeMb: 0.6,
    },
  ],
}

const MAX_MB = 10
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

/** The picture of the file: the image itself (never cropped) or a PDF sheet. */
function FileThumb({ doc }: { doc: SampleDoc }) {
  return (
    <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-bg">
      {doc.previewUrl && doc.kind === 'image' ? (
        <img src={doc.previewUrl} alt="" className="h-full w-full object-contain" />
      ) : doc.kind === 'image' ? (
        <ImageIcon size={22} className="text-muted" aria-hidden="true" />
      ) : (
        <span className="flex flex-col items-center gap-1 text-muted">
          <FileText size={22} aria-hidden="true" />
          <span className="text-[10px] font-semibold">PDF</span>
        </span>
      )}
    </div>
  )
}

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
      <div className="flex min-h-24 flex-col justify-between gap-2 rounded-lg border border-dashed bg-bg p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{DOC_LABELS[type]}</span>
          <span className="text-xs text-placeholder">غير مرفوع</span>
        </div>
        {canEdit && (
          <Button
            size="sm"
            icon={<Upload size={14} aria-hidden="true" />}
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
    <div className="flex min-h-24 gap-3 rounded-lg border bg-bg p-3">
      <FileThumb doc={doc} />
      <div className="min-w-0 flex-1 space-y-1">
        <span className="text-sm font-medium">{title}</span>
        <p className="truncate text-xs" title={doc.name}>
          <bdi dir="ltr">{doc.name}</bdi>
        </p>
        <p className="text-xs text-muted">
          {sizeLabel(doc.sizeMb)} ·{' '}
          {doc.kind === 'pdf' ? <bdi dir="ltr">PDF</bdi> : 'صورة'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
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
  const other = type === 'other'

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
    <div className="space-y-3 rounded-xl border bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {replacing ? 'استبدال' : 'رفع'} {other ? 'مستند اخر' : DOC_LABELS[type]}
        </h4>
        <IconButton size="sm" label="اغلاق" icon={<X size={15} />} onClick={onCancel} />
      </div>
      {replacing && (
        <p className="text-xs text-muted">الملف الجديد يحل محل الحالي.</p>
      )}
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed bg-bg px-4 py-6 text-center">
        <Paperclip size={20} className="text-muted" aria-hidden="true" />
        <span className="text-sm">
          {file ? <bdi dir="ltr">{file.name}</bdi> : 'اختر ملفا او صور المستند'}
        </span>
        <span className="text-xs text-muted">PDF او صورة (JPG، PNG، WEBP) حتى {MAX_MB} ميغا</span>
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
        note="يظهر تحت اقسام البيانات في تفاصيل المورد والشركة. ملف واحد لكل نوع، والاستبدال يحل محله. «مستندات اخرى» تقبل اكثر من ملف باسم تكتبه. جرب الرفع بملف من جهازك: يظهر هنا فقط ولا يرفع لاي مكان."
      >
        <div className="max-w-3xl rounded-xl border bg-[var(--surface)] p-4">
          <h4 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <FileText size={16} className="text-muted" aria-hidden="true" />
            المستندات
            <span className="text-xs font-normal text-muted">
              {filled} من {types.length}
            </span>
          </h4>
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

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{DOC_LABELS.other}</span>
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
              <p className="text-xs text-placeholder">لا توجد مستندات اخرى</p>
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
