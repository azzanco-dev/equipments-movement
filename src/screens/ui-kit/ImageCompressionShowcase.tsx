import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  Button,
  Card,
  SectionHeader,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import {
  ALLOWED_MOVEMENT_PHOTO_TYPES,
  CompressImageError,
  compressImage,
  formatByteSize,
  savedPercent,
  type CompressImageResult,
} from '@/lib/imageCompression'
import { prepareMovementPhotos } from '@/lib/movementPhotoCompression'

// Compression lab for /ui-kit: the product owner drops real photos and sees
// the before/after result of each candidate setting. Everything runs in the
// browser — nothing is uploaded and no Supabase call is made.

const PRESETS = [
  { id: 'light', label: 'خفيف', maxDimension: 1280, quality: 0.7 },
  { id: 'balanced', label: 'متوازن', maxDimension: 1600, quality: 0.8 },
  { id: 'high', label: 'عالي', maxDimension: 2048, quality: 0.85 },
] as const

type PresetId = (typeof PRESETS)[number]['id'] | 'custom'

const ERROR_MESSAGES: Record<string, string> = {
  image_type_not_supported:
    'نوع الملف غير مدعوم. المسموح: JPEG او PNG او WEBP.',
  image_too_large: 'حجم الصورة اكبر من 10 ميجابايت.',
  image_decode_failed: 'تعذر قراءة الصورة.',
  image_compression_failed: 'تعذر ضغط الصورة في هذا المتصفح.',
}

function errorMessage(error: unknown) {
  if (error instanceof CompressImageError) {
    return ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.image_compression_failed
  }
  return ERROR_MESSAGES.image_compression_failed
}

interface LabItem {
  id: string
  file: File
  originalUrl: string
  status: 'working' | 'done' | 'error'
  errorText?: string
  result?: CompressImageResult
  resultUrl?: string
  /** What the existing `prepareMovementPhotos` pipeline produces, for reference. */
  currentBytes?: number
  currentDurationMs?: number
  currentUrl?: string
}

function formatMs(durationMs: number) {
  return `${Math.round(durationMs)} ms`
}

function outputTypeLabel(mimeType: string) {
  if (mimeType === 'image/png') return 'PNG'
  if (mimeType === 'image/webp') return 'WEBP'
  if (mimeType === 'image/jpeg') return 'JPEG'
  return mimeType
}

function formatSaved(value: number) {
  // Latin digits, explicit sign so a negative (grown) result is obvious.
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

let nextItemId = 1

export function ImageCompressionShowcase() {
  const [presetId, setPresetId] = useState<PresetId>('balanced')
  const [customDimension, setCustomDimension] = useState(1600)
  const [customQuality, setCustomQuality] = useState(0.8)
  const [items, setItems] = useState<LabItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemsRef = useRef<LabItem[]>([])
  itemsRef.current = items
  const runIdRef = useRef(0)

  const preset = PRESETS.find((entry) => entry.id === presetId)
  const maxDimension = preset ? preset.maxDimension : customDimension
  const quality = preset ? preset.quality : customQuality

  // Object URLs are per item; they are revoked when the item is replaced and
  // when the showcase unmounts.
  const releaseItem = useCallback((item: LabItem) => {
    URL.revokeObjectURL(item.originalUrl)
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl)
    if (item.currentUrl) URL.revokeObjectURL(item.currentUrl)
  }, [])

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.originalUrl)
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl)
        if (item.currentUrl) URL.revokeObjectURL(item.currentUrl)
      }
    }
  }, [])

  const runFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      const runId = (runIdRef.current += 1)
      const created: LabItem[] = files.map((file) => ({
        id: `image-${nextItemId++}`,
        file,
        originalUrl: URL.createObjectURL(file),
        status: 'working',
      }))
      setItems((current) => {
        for (const item of current) releaseItem(item)
        return created
      })

      // Sequential: one decoded camera image at a time keeps phone memory sane.
      for (const item of created) {
        let next: LabItem
        try {
          const result = await compressImage(item.file, {
            maxDimension,
            quality,
          })
          next = {
            ...item,
            status: 'done',
            result,
            resultUrl: URL.createObjectURL(result.blob),
          }
          // The reference run is informational only: if it fails, the lab
          // result above is still shown.
          try {
            const startedAt = performance.now()
            const [currentFile] = await prepareMovementPhotos([item.file])
            next = {
              ...next,
              currentBytes: currentFile.size,
              currentDurationMs: performance.now() - startedAt,
              currentUrl: URL.createObjectURL(currentFile),
            }
          } catch {
            // Leave the reference columns empty.
          }
        } catch (error) {
          next = { ...item, status: 'error', errorText: errorMessage(error) }
        }
        if (runIdRef.current !== runId) {
          // A newer run replaced this one; drop the URLs we just made.
          if (next.resultUrl) URL.revokeObjectURL(next.resultUrl)
          if (next.currentUrl) URL.revokeObjectURL(next.currentUrl)
          return
        }
        setItems((current) =>
          current.map((entry) => (entry.id === item.id ? next : entry)),
        )
      }
    },
    [maxDimension, quality, releaseItem],
  )

  const acceptFiles = useCallback(
    (fileList: FileList | null) => {
      const files = Array.from(fileList ?? [])
      if (!files.length) return
      const images = files.filter((file) =>
        ALLOWED_MOVEMENT_PHOTO_TYPES.includes(file.type),
      )
      setPickError(
        images.length === files.length
          ? null
          : 'تم تجاهل ملفات غير مدعومة. المسموح: JPEG او PNG او WEBP.',
      )
      void runFiles(images)
    },
    [runFiles],
  )

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFiles(event.target.files)
    // Allow re-picking the same file after changing the setting.
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    acceptFiles(event.dataTransfer.files)
  }

  const rerun = () => {
    const files = itemsRef.current.map((item) => item.file)
    void runFiles(files)
  }

  const completed = items.filter(
    (item): item is LabItem & { result: CompressImageResult } =>
      item.status === 'done' && !!item.result,
  )
  const totalBefore = completed.reduce(
    (total, item) => total + item.file.size,
    0,
  )
  const totalAfter = completed.reduce(
    (total, item) => total + item.result.blob.size,
    0,
  )
  const totalCurrent = completed.reduce(
    (total, item) => total + (item.currentBytes ?? 0),
    0,
  )
  const totalMs = completed.reduce(
    (total, item) => total + item.result.durationMs,
    0,
  )

  return (
    <section className="card space-y-4">
      <SectionHeader
        title="مختبر ضغط الصور (Image Compression Lab)"
        description="اسحب صورا حقيقية من الجوال او الحاسب وقارن الحجم والابعاد والزمن قبل وبعد الضغط. كل شيء يعمل داخل المتصفح: لا رفع ولا اتصال بقاعدة البيانات."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={presetId}
          onValueChange={(value) => setPresetId(value as PresetId)}
        >
          <TabsList variant="segmented" aria-label="مستوى الضغط">
            {PRESETS.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="custom">مخصص</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted">
          {`الحد الاقصى للضلع الاطول: ${maxDimension} px · الجودة: ${quality.toFixed(2)}`}
        </p>
      </div>

      {presetId === 'custom' && (
        <div className="grid gap-4 rounded-lg border bg-surface p-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-fg">
              {`اقصى ضلع: ${customDimension} px`}
            </span>
            <input
              type="range"
              min={800}
              max={3000}
              step={20}
              value={customDimension}
              onChange={(event) =>
                setCustomDimension(Number(event.target.value))
              }
              className="w-full accent-[color:var(--primary)]"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-fg">
              {`الجودة: ${customQuality.toFixed(2)}`}
            </span>
            <input
              type="range"
              min={0.5}
              max={0.95}
              step={0.01}
              value={customQuality}
              onChange={(event) => setCustomQuality(Number(event.target.value))}
              className="w-full accent-[color:var(--primary)]"
            />
          </label>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label="منطقة افلات الصور: اسحب الصور هنا او اضغط للاختيار"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center transition-colors',
          dragging ? 'border-primary bg-surface-hover' : 'bg-surface',
        ].join(' ')}
      >
        <span className="text-sm font-medium text-fg">
          اسحب الصور هنا او اضغط للاختيار
        </span>
        <span className="text-xs text-muted">
          JPEG او PNG او WEBP · حتى 10 ميجابايت لكل صورة
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_MOVEMENT_PHOTO_TYPES.join(',')}
        multiple
        className="sr-only"
        onChange={onInputChange}
        aria-label="اختيار صور للضغط"
      />

      {pickError && <p className="text-xs text-danger">{pickError}</p>}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={rerun}>
            اعادة التشغيل بالاعداد الحالي
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              runIdRef.current += 1
              setItems((current) => {
                for (const item of current) releaseItem(item)
                return []
              })
              setPickError(null)
            }}
          >
            مسح الكل
          </Button>
        </div>
      )}

      {completed.length > 1 && (
        <Card className="space-y-2">
          <h4 className="text-sm font-semibold text-fg">الاجمالي</h4>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <TotalCell label="عدد الصور" value={String(completed.length)} />
            <TotalCell label="قبل" value={formatByteSize(totalBefore)} />
            <TotalCell
              label="بعد"
              value={`${formatByteSize(totalAfter)} (${formatSaved(
                savedPercent(totalBefore, totalAfter),
              )})`}
            />
            <TotalCell
              label="الاعداد الحالي"
              value={`${formatByteSize(totalCurrent)} (${formatSaved(
                savedPercent(totalBefore, totalCurrent),
              )})`}
            />
            <TotalCell label="زمن الضغط" value={formatMs(totalMs)} />
          </dl>
        </Card>
      )}

      <div className="space-y-4">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

function TotalCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-surface p-2">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-fg">{value}</dd>
    </div>
  )
}

function ItemCard({ item }: { item: LabItem }) {
  const result = item.result
  return (
    <Card className="space-y-3">
      <SectionHeader
        title={item.file.name || 'صورة'}
        description={`${formatByteSize(item.file.size)} · ${outputTypeLabel(
          item.file.type,
        )}`}
        as="h4"
      />

      {item.status === 'working' && (
        <p className="text-xs text-muted">جاري الضغط...</p>
      )}
      {item.status === 'error' && (
        <p className="text-xs text-danger">{item.errorText}</p>
      )}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <ImagePane
              label={`قبل · ${formatByteSize(item.file.size)}`}
              src={item.originalUrl}
              alt={`الصورة قبل الضغط: ${item.file.name}`}
            />
            <ImagePane
              label={`بعد · ${formatByteSize(result.blob.size)}`}
              src={item.resultUrl ?? item.originalUrl}
              alt={`الصورة بعد الضغط: ${item.file.name}`}
            />
          </div>

          {result.usedOriginal && (
            <p className="rounded-lg border bg-warning-soft p-2 text-xs text-fg">
              الضغط كان سينتج ملفا اكبر، لذلك تم الابقاء على الملف الاصلي كما
              هو.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-xs">
              <caption className="sr-only">
                مقارنة الحجم والابعاد والزمن قبل وبعد الضغط
              </caption>
              <thead>
                <tr className="border-b text-muted">
                  <th scope="col" className="py-1.5 text-start font-medium">
                    القياس
                  </th>
                  <th scope="col" className="py-1.5 text-start font-medium">
                    قبل
                  </th>
                  <th scope="col" className="py-1.5 text-start font-medium">
                    بعد
                  </th>
                </tr>
              </thead>
              <tbody className="text-fg">
                <Row
                  label="الحجم"
                  before={formatByteSize(item.file.size)}
                  after={formatByteSize(result.blob.size)}
                />
                <Row
                  label="الابعاد"
                  before={`${result.originalWidth} × ${result.originalHeight}`}
                  after={`${result.width} × ${result.height}`}
                />
                <Row
                  label="النوع"
                  before={outputTypeLabel(item.file.type)}
                  after={outputTypeLabel(result.outputType)}
                />
                <Row
                  label="نسبة التوفير"
                  before="—"
                  after={formatSaved(
                    savedPercent(item.file.size, result.blob.size),
                  )}
                />
                <Row
                  label="زمن الضغط"
                  before="—"
                  after={formatMs(result.durationMs)}
                />
              </tbody>
            </table>
          </div>

          {item.currentBytes !== undefined && (
            <div className="space-y-2 rounded-lg border bg-surface p-3">
              <h5 className="text-xs font-semibold text-fg">
                الاعداد الحالي (prepareMovementPhotos)
              </h5>
              <p className="text-xs text-muted">
                {`${formatByteSize(item.currentBytes)} · ${formatSaved(
                  savedPercent(item.file.size, item.currentBytes),
                )} · ${formatMs(item.currentDurationMs ?? 0)}`}
              </p>
              {item.currentBytes === item.file.size && (
                <p className="text-xs text-muted">
                  الاعداد الحالي لا يضغط الا عندما يتجاوز مجموع الصور 4
                  ميجابايت، لذلك بقيت هذه الصورة كما هي.
                </p>
              )}
              {item.currentUrl && (
                <ImagePane
                  label="نتيجة الاعداد الحالي"
                  src={item.currentUrl}
                  alt={`نتيجة الاعداد الحالي: ${item.file.name}`}
                />
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function Row({
  label,
  before,
  after,
}: {
  label: string
  before: ReactNode
  after: ReactNode
}) {
  return (
    <tr className="border-b last:border-b-0">
      <th scope="row" className="py-1.5 text-start font-normal text-muted">
        {label}
      </th>
      <td className="py-1.5">{before}</td>
      <td className="py-1.5 font-medium">{after}</td>
    </tr>
  )
}

function ImagePane({
  label,
  src,
  alt,
}: {
  label: string
  src: string
  alt: string
}) {
  return (
    <figure className="space-y-1">
      <div className="flex h-56 items-center justify-center overflow-hidden rounded-lg border bg-surface">
        {/* Local object URL of a picked file: next/image cannot optimize it. */}
        <img src={src} alt={alt} className="h-full w-full object-contain" />
      </div>
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  )
}
