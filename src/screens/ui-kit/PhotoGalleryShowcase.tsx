import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  PhotoGallery,
  type PhotoGalleryItem,
} from '@/components/ui/PhotoGallery'

// Live review of the shared movement photo component on /ui-kit. Sample
// placeholder images only — no Supabase or real upload logic here.

function svgDataUri(
  width: number,
  height: number,
  label: string,
  fill: string,
) {
  const fontSize = Math.round(Math.min(width, height) / 9)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${fill}"/>` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="${fontSize}" fill="#3f3f46">${label}</text>` +
    `<text x="50%" y="62%" dominant-baseline="middle" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="${Math.round(fontSize * 0.55)}" fill="#71717a">` +
    `${width}×${height}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const LANDSCAPE = svgDataUri(480, 360, 'افقية', '#e4e4e7')
const WIDE = svgDataUri(640, 260, 'عريضة', '#d4d4d8')
const TALL = svgDataUri(260, 640, 'طويلة', '#e4e4e7')
const SQUARE = svgDataUri(480, 480, 'مربعة', '#d4d4d8')

let nextId = 1
function makeId() {
  return `demo-${nextId++}`
}

export function PhotoGalleryShowcase() {
  return (
    <Section
      title="معرض صور الحركة (PhotoGallery)"
      description="صورة رئيسية فوق، وتحتها 3 مربعات متساوية. اثناء رفع صورة يظهر غطاء عليها فيه مؤشر تحميل. Component عرضي فقط بدون منطق رفع حقيقي."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <EmptyDemo />
        <OnePhotoDemo />
        <ThreePhotosDemo />
        <UploadingDemo />
        <ErrorDemo />
        <ReadOnlyDemo />
      </div>
    </Section>
  )
}

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

function DemoCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">{label}</p>
      {children}
    </div>
  )
}

function EmptyDemo() {
  const [photos, setPhotos] = useState<PhotoGalleryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  return (
    <DemoCard label="بدون صور">
      <PhotoGallery
        photos={photos}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={() => {
          const id = makeId()
          setPhotos((prev) => [
            ...prev,
            { id, src: LANDSCAPE, status: 'ready' },
          ])
          setSelectedId(id)
        }}
      />
    </DemoCard>
  )
}

function OnePhotoDemo() {
  const [photos, setPhotos] = useState<PhotoGalleryItem[]>([
    { id: 'one-1', src: TALL, alt: 'صورة طويلة تجريبية', status: 'ready' },
  ])
  const [selectedId, setSelectedId] = useState<string | null>('one-1')
  return (
    <DemoCard label="صورة واحدة (طويلة، تثبت عدم القص)">
      <PhotoGallery
        photos={photos}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={() => {
          const id = makeId()
          setPhotos((prev) => [...prev, { id, src: SQUARE, status: 'ready' }])
          setSelectedId(id)
        }}
        onRemove={(id) => {
          setPhotos((prev) => prev.filter((p) => p.id !== id))
          setSelectedId((prev) => (prev === id ? null : prev))
        }}
      />
    </DemoCard>
  )
}

function ThreePhotosDemo() {
  const initial: PhotoGalleryItem[] = [
    { id: 'three-1', src: WIDE, alt: 'صورة عريضة تجريبية', status: 'ready' },
    { id: 'three-2', src: TALL, alt: 'صورة طويلة تجريبية', status: 'ready' },
    { id: 'three-3', src: SQUARE, alt: 'صورة مربعة تجريبية', status: 'ready' },
  ]
  const [photos, setPhotos] = useState<PhotoGalleryItem[]>(initial)
  const [selectedId, setSelectedId] = useState<string | null>('three-1')
  return (
    <DemoCard label="3 صور (الحد الاقصى، مربع الاضافة يختفي)">
      <PhotoGallery
        photos={photos}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onAdd={() => {
          /* max reached: PhotoGallery hides the add square on its own */
        }}
        onRemove={(id) => {
          setPhotos((prev) => prev.filter((p) => p.id !== id))
          setSelectedId((prev) => (prev === id ? null : prev))
        }}
      />
    </DemoCard>
  )
}

function UploadingDemo() {
  const [progress, setProgress] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>('uploading-1')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 0 : prev + 7))
    }, 400)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  const photos: PhotoGalleryItem[] = [
    { id: 'uploading-1', src: LANDSCAPE, status: 'ready' },
    {
      id: 'uploading-2',
      src: SQUARE,
      status: 'uploading',
      progress,
    },
  ]
  return (
    <DemoCard label="صورة قيد الرفع (مؤقت محلي يحاكي التقدم)">
      <PhotoGallery
        photos={photos}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </DemoCard>
  )
}

function ErrorDemo() {
  const [status, setStatus] = useState<'error' | 'ready'>('error')
  const [selectedId, setSelectedId] = useState<string | null>('error-2')
  const photos: PhotoGalleryItem[] = [
    { id: 'error-1', src: LANDSCAPE, status: 'ready' },
    { id: 'error-2', src: WIDE, status },
  ]
  return (
    <DemoCard label="فشل الرفع مع اعادة المحاولة">
      <PhotoGallery
        photos={photos}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onRetry={() => setStatus('ready')}
      />
    </DemoCard>
  )
}

function ReadOnlyDemo() {
  const [selectedId, setSelectedId] = useState<string | null>('ro-1')
  const photos: PhotoGalleryItem[] = [
    { id: 'ro-1', src: SQUARE, status: 'ready' },
    { id: 'ro-2', src: WIDE, status: 'ready' },
  ]
  return (
    <DemoCard label="وضع القراءة فقط (بدون اضافة او حذف)">
      <PhotoGallery
        photos={photos}
        selectedId={selectedId}
        onSelect={setSelectedId}
        readOnly
      />
    </DemoCard>
  )
}
