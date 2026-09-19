import { useState, type ReactNode } from 'react'
import {
  PhotoGallery,
  type PhotoGalleryItem,
} from '@/components/ui/PhotoGallery'
import { Lightbox, type LightboxItem } from '@/components/ui/Lightbox'

// Live review of the shared photo Lightbox on /ui-kit: opened from a
// read-only PhotoGallery's onOpen(id), same as MovementDetail does. Sample
// placeholder images only — no Supabase involved.

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

const LANDSCAPE = svgDataUri(480, 320, 'افقية', '#e4e4e7')
const TALL = svgDataUri(280, 640, 'طويلة', '#d4d4d8')
const SQUARE = svgDataUri(480, 480, 'مربعة', '#e4e4e7')

const DEMO_PHOTOS: PhotoGalleryItem[] = [
  { id: 'lb-1', src: LANDSCAPE, alt: 'صورة افقية تجريبية', status: 'ready' },
  { id: 'lb-2', src: TALL, alt: 'صورة طويلة تجريبية', status: 'ready' },
  { id: 'lb-3', src: SQUARE, alt: 'صورة مربعة تجريبية', status: 'ready' },
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

export function LightboxShowcase() {
  return (
    <Section
      title="عارض الصور بملء الشاشة (Lightbox)"
      description="يفتح من الصورة الرئيسية في PhotoGallery عبر onOpen. تنقل بالاسهم والسحب واللمس، مع تحميل مسبق للصورة التالية والسابقة. جرب استخدام لوحة المفاتيح (Left/Right/Home/End/Escape) في القسمين لملاحظة ان اتجاه Next يعتمد على اتجاه الكتلة."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <DirectionDemo dir="rtl" label="اتجاه من اليمين الى اليسار (RTL)" />
        <DirectionDemo dir="ltr" label="Left-to-right direction (LTR)" />
      </div>
    </Section>
  )
}

function DirectionDemo({ dir, label }: { dir: 'rtl' | 'ltr'; label: string }) {
  const [selectedId, setSelectedId] = useState<string>(DEMO_PHOTOS[0].id)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const items: LightboxItem[] = DEMO_PHOTOS.map((photo) => ({
    id: photo.id,
    src: photo.src,
    alt: photo.alt,
  }))

  const openLightbox = (id: string) => {
    const foundIndex = DEMO_PHOTOS.findIndex((photo) => photo.id === id)
    setLightboxIndex(foundIndex === -1 ? 0 : foundIndex)
    setLightboxOpen(true)
  }

  return (
    <div
      dir={dir}
      className="space-y-3 rounded-lg border p-4"
      style={{ borderColor: 'var(--border)' }}
    >
      <p className="text-xs font-medium text-muted">{label}</p>
      <PhotoGallery
        photos={DEMO_PHOTOS}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpen={openLightbox}
        readOnly
      />
      <Lightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        items={items}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
      />
    </div>
  )
}
