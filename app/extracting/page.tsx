'use client'

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { FileImage, ScanText, Send } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AuthScreen } from '@/screens/AuthScreen'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'

type FieldKey =
  | 'full_name_ar'
  | 'full_name_en'
  | 'id_number'
  | 'date_of_birth'
  | 'residence_expiry_date'
  | 'nationality'
  | 'occupation'
  | 'employer_name'
  | 'email'
  | 'mobile_number'
  | 'gender'
  | 'company'
  | 'employment_type'
  | 'department'
  | 'date_of_joining'

type ExtractionForm = Record<FieldKey, string>
type PublishStep = 'created' | 'existing' | 'partial' | 'skipped' | 'failed'
type PublishResult = {
  status: PublishStep
  id?: string
  userId?: string
  employeeId?: string
  steps?: { user?: PublishStep; employee?: PublishStep }
  error?: string
}

const EMPTY_FORM: ExtractionForm = {
  full_name_ar: '',
  full_name_en: '',
  id_number: '',
  date_of_birth: '',
  residence_expiry_date: '',
  nationality: '',
  occupation: '',
  employer_name: '',
  email: '',
  mobile_number: '',
  gender: '',
  company: '',
  employment_type: '',
  department: '',
  date_of_joining: '',
}

const EXTRACTED_FIELDS: Array<[FieldKey, string, string]> = [
  ['full_name_ar', 'الاسم بالعربي', 'text'],
  ['full_name_en', 'الاسم بالانجليزي', 'text'],
  ['id_number', 'رقم الهوية', 'text'],
  ['date_of_birth', 'تاريخ الميلاد', 'date'],
  ['residence_expiry_date', 'تاريخ انتهاء الاقامة', 'date'],
  ['nationality', 'الجنسية', 'text'],
  ['occupation', 'المهنة', 'text'],
  ['employer_name', 'اسم صاحب العمل', 'text'],
]

const MANUAL_FIELDS: Array<[FieldKey, string, string]> = [
  ['email', 'بريد مستخدم ERPNext', 'email'],
  ['mobile_number', 'رقم الجوال', 'tel'],
  ['company', 'الشركة في ERPNext', 'text'],
  ['employment_type', 'نوع التوظيف', 'text'],
  ['department', 'القسم', 'text'],
  ['date_of_joining', 'تاريخ المباشرة', 'date'],
]

const STATUS_LABELS: Record<PublishStep, string> = {
  created: 'تم الانشاء',
  existing: 'موجود مسبقا',
  partial: 'اكتمل جزئيا',
  skipped: 'لم يتم اختياره',
  failed: 'فشل',
}

const ERROR_LABELS: Record<string, string> = {
  local_lookup_failed: 'تعذر التحقق من السائق في النظام الحالي',
  local_create_failed: 'تعذر انشاء السائق في النظام الحالي',
  erp_required_fields_missing: 'اكمل حقول ERPNext المطلوبة',
  erp_not_configured: 'اعدادات ERPNext غير مكتملة على الخادم',
  erp_invalid_field_mapping: 'اعدادات حقول ERPNext غير صالحة',
  erp_employee_lookup_failed: 'تعذر التحقق من الموظف في ERPNext',
  erp_user_lookup_failed: 'تعذر التحقق من المستخدم في ERPNext',
  erp_user_create_failed: 'تعذر انشاء المستخدم في ERPNext',
  erp_employee_create_failed: 'تم المستخدم وتعذر انشاء الموظف في ERPNext',
  erp_employee_user_conflict:
    'الموظف مرتبط بمستخدم ERPNext مختلف ويحتاج مراجعة',
  erp_employee_link_failed: 'تعذر ربط الموظف بمستخدم ERPNext',
  erp_connection_failed: 'تعذر الاتصال بمنصة ERPNext',
}

function safeApiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback
  const code = (value as Record<string, unknown>).error
  return typeof code === 'string' ? ERROR_LABELS[code] || fallback : fallback
}

export default function ExtractingPage() {
  const { session, profile, loading } = useAuth()
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [data, setData] = useState<ExtractionForm>(EMPTY_FORM)
  const [targets, setTargets] = useState({
    currentSystem: true,
    erpnext: false,
  })
  const [stage, setStage] = useState<
    'idle' | 'extracting' | 'review' | 'publishing'
  >('idle')
  const [notice, setNotice] = useState('')
  const [noticeType, setNoticeType] = useState<'error' | 'success' | 'info'>(
    'info',
  )
  const [results, setResults] = useState<Record<string, PublishResult> | null>(
    null,
  )
  const token = session?.access_token

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  const imageLabel = useMemo(
    () =>
      image
        ? `${image.name} (${Math.round(image.size / 1024)} كيلوبايت)`
        : 'اختر صورة الاقامة',
    [image],
  )

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setNoticeType('error')
      setNotice('يسمح بصور JPEG وPNG وWEBP فقط')
      return
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setNoticeType('error')
      setNotice('حجم الصورة يجب ان يكون بين 1 بايت و10 ميجابايت')
      return
    }
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current)
      return URL.createObjectURL(file)
    })
    setImage(file)
    setStage('idle')
    setNotice('')
    setResults(null)
    setData(EMPTY_FORM)
  }

  const update = (key: FieldKey, value: string) =>
    setData((current) => ({ ...current, [key]: value }))

  const extractImage = async () => {
    if (!image || !token) return
    setStage('extracting')
    setNotice('')
    setResults(null)
    try {
      const body = new globalThis.FormData()
      body.append('image', image)
      const response = await fetch('/api/extracting/ocr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      const payload = (await response.json()) as {
        data?: Partial<ExtractionForm>
        error?: string
      }
      if (!response.ok)
        throw new Error(safeApiError(payload, 'تعذر قراءة صورة الاقامة'))
      setData((current) => ({ ...current, ...payload.data }))
      setStage('review')
      setNoticeType('info')
      setNotice('راجع البيانات المستخرجة واكمل الحقول المطلوبة قبل النشر')
    } catch (error) {
      setStage('idle')
      setNoticeType('error')
      setNotice(error instanceof Error ? error.message : 'تعذر قراءة الصورة')
    }
  }

  const publish = async (event: FormEvent) => {
    event.preventDefault()
    if (!token || stage !== 'review') return
    if (!targets.currentSystem && !targets.erpnext) {
      setNoticeType('error')
      setNotice('اختر منصة واحدة على الاقل')
      return
    }
    if (!data.full_name_ar || !/^\d{5,20}$/.test(data.id_number)) {
      setNoticeType('error')
      setNotice('تحقق من الاسم العربي ورقم الهوية')
      return
    }
    if (
      targets.erpnext &&
      (!data.email || !data.gender || !data.company || !data.date_of_joining)
    ) {
      setNoticeType('error')
      setNotice('البريد والجنس والشركة وتاريخ المباشرة مطلوبة لـ ERPNext')
      return
    }

    setStage('publishing')
    setNotice('')
    setResults(null)
    try {
      const response = await fetch('/api/extracting/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data, targets }),
      })
      const payload = (await response.json()) as {
        results?: Record<string, PublishResult>
        error?: string
      }
      if (!response.ok)
        throw new Error(safeApiError(payload, 'تعذر نشر البيانات'))
      setResults(payload.results ?? null)
      setStage('review')
      setNoticeType('success')
      setNotice('اكتملت محاولة النشر. راجع نتيجة كل منصة ادناه')
    } catch (error) {
      setStage('review')
      setNoticeType('error')
      setNotice(error instanceof Error ? error.message : 'تعذر نشر البيانات')
    }
  }

  if (loading)
    return (
      <main className="mx-auto max-w-5xl p-6 text-center">جار التحميل...</main>
    )
  if (!profile) return <AuthScreen />
  if (profile.role !== 'admin')
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="rounded-xl border border-border bg-bg p-8 text-center">
          <h1 className="text-xl font-semibold">غير مصرح</h1>
          <p className="mt-2 text-muted">هذه الصفحة متاحة للادمن فقط</p>
        </section>
      </main>
    )

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-semibold">استخراج بيانات الاقامة</h1>
        <p className="mt-1 text-sm text-muted">
          ارفع صورة واضحة، راجع البيانات، ثم اختر منصات النشر
        </p>
      </header>

      <section className="rounded-xl border border-border bg-bg p-5">
        <label className="block cursor-pointer rounded-lg border-2 border-dashed border-border p-6 text-center hover:bg-surface-hover">
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={chooseImage}
          />
          <FileImage className="mx-auto mb-2 text-muted" aria-hidden="true" />
          <span className="font-medium">{imageLabel}</span>
          <span className="mt-1 block text-sm text-muted">
            JPEG، PNG، WEBP — حد 10 ميجابايت
          </span>
        </label>
        {preview ? (
          <img
            src={preview}
            alt="معاينة الاقامة"
            className="mx-auto mt-4 max-h-80 w-full rounded-lg object-contain"
          />
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            icon={<ScanText size={17} />}
            loading={stage === 'extracting'}
            disabled={!image || stage === 'publishing'}
            onClick={() => void extractImage()}
          >
            قراءة الصورة
          </Button>
        </div>
      </section>

      {stage === 'review' || stage === 'publishing' || results ? (
        <form onSubmit={publish} className="space-y-6">
          <section className="rounded-xl border border-border bg-bg p-5">
            <h2 className="mb-4 font-semibold">البيانات المستخرجة</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {EXTRACTED_FIELDS.map(([key, label, type]) => (
                <Field
                  key={key}
                  label={label}
                  required={key === 'full_name_ar' || key === 'id_number'}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type={type}
                      inputMode={key === 'id_number' ? 'numeric' : undefined}
                      value={data[key]}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-bg p-5">
            <h2 className="mb-4 font-semibold">بيانات التوظيف والنشر</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الجنس" required={targets.erpnext}>
                {({ invalid, ...control }) => (
                  <select
                    {...control}
                    aria-invalid={invalid || undefined}
                    className="input h-10 md:h-9"
                    value={data.gender}
                    onChange={(event) => update('gender', event.target.value)}
                  >
                    <option value="">اختر الجنس</option>
                    <option value="Male">ذكر</option>
                    <option value="Female">انثى</option>
                  </select>
                )}
              </Field>
              {MANUAL_FIELDS.map(([key, label, type]) => (
                <Field
                  key={key}
                  label={label}
                  required={
                    targets.erpnext &&
                    ['email', 'company', 'date_of_joining'].includes(key)
                  }
                >
                  {(control) => (
                    <Input
                      {...control}
                      type={type}
                      value={data[key]}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-bg p-5">
            <h2 className="font-semibold">منصات النشر</h2>
            <div className="mt-3 flex flex-wrap gap-5">
              {(
                [
                  ['currentSystem', 'النظام الحالي'],
                  ['erpnext', 'ERPNext'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={targets[key]}
                    onChange={(event) =>
                      setTargets((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <Button
            type="submit"
            variant="primary"
            icon={<Send size={17} />}
            loading={stage === 'publishing'}
          >
            مراجعة وتاكيد النشر
          </Button>
        </form>
      ) : null}

      {notice ? (
        <p
          role={noticeType === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-3 text-sm ${
            noticeType === 'error'
              ? 'border-danger bg-danger-soft text-danger'
              : noticeType === 'success'
                ? 'border-success bg-success-soft text-success'
                : 'border-border bg-surface text-fg'
          }`}
        >
          {notice}
        </p>
      ) : null}

      {results ? (
        <section className="grid gap-4 sm:grid-cols-2">
          {Object.entries(results).map(([name, result]) => (
            <article
              key={name}
              className="rounded-xl border border-border bg-bg p-5"
            >
              <h2 className="font-semibold">
                {name === 'currentSystem' ? 'النظام الحالي' : 'ERPNext'}
              </h2>
              <p className="mt-2">
                الحالة: {STATUS_LABELS[result.status] || result.status}
              </p>
              {result.steps ? (
                <div className="mt-2 space-y-1 text-sm text-muted">
                  <p>
                    المستخدم:{' '}
                    {result.steps.user
                      ? STATUS_LABELS[result.steps.user]
                      : 'غير محدد'}
                  </p>
                  <p>
                    الموظف:{' '}
                    {result.steps.employee
                      ? STATUS_LABELS[result.steps.employee]
                      : 'غير محدد'}
                  </p>
                </div>
              ) : null}
              {result.error ? (
                <p className="mt-2 text-sm text-danger">
                  {ERROR_LABELS[result.error] || 'تعذر اكمال العملية'}
                </p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </main>
  )
}
