import { useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { Lightbox, PhotoGallery } from '@/components/ui'
import {
  ALLOWED_MOVEMENT_PHOTO_TYPES,
  MAX_MOVEMENT_PHOTOS,
  type StagedPhoto,
} from '@/components/useMovementPhotoStaging'
import { stagedPhotosToGalleryItems } from '@/lib/movementPhotoGallery'

export interface MovementPhotosSectionProps {
  photos: StagedPhoto[]
  /** Index of the photo shown in the main preview. */
  selectedIndex: number
  onSelectIndex: (index: number) => void
  /** Staging is still busy (preparing or uploading), so no new files. */
  uploading: boolean
  /** Workshop movements need at least one photo; the server checks it too. */
  required: boolean
  onAddFiles: (files: FileList | null) => void
  onRemoveIndex: (index: number) => void
  onRetryPhoto: (id: string) => void
}

/**
 * Movement photos: the shared `PhotoGallery` bound to the staging hook, with
 * the shared `Lightbox` over the local previews. Upload, retry and discard
 * logic stays in `useMovementPhotoStaging`.
 */
export function MovementPhotosSection({
  photos,
  selectedIndex,
  onSelectIndex,
  uploading,
  required,
  onAddFiles,
  onRemoveIndex,
  onRetryPhoto,
}: MovementPhotosSectionProps) {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const items = stagedPhotosToGalleryItems(photos)
  const safeIndex = items[selectedIndex] ? selectedIndex : 0
  const selectedId = items[safeIndex]?.id ?? null
  const indexOfId = (id: string) => items.findIndex((item) => item.id === id)

  return (
    <div>
      <p className="label">
        {t('photo')}
        {required && (
          <span aria-hidden="true" className="ms-0.5 text-danger">
            *
          </span>
        )}
      </p>

      <PhotoGallery
        photos={items}
        max={MAX_MOVEMENT_PHOTOS}
        selectedId={selectedId}
        onSelect={(id) => {
          const index = indexOfId(id)
          if (index >= 0) onSelectIndex(index)
        }}
        // A disabled file input ignores the click, which keeps the previous
        // behaviour of not accepting new files while an upload is running.
        onAdd={() => fileInputRef.current?.click()}
        onRemove={(id) => {
          const index = indexOfId(id)
          if (index >= 0) onRemoveIndex(index)
        }}
        onRetry={onRetryPhoto}
        onOpen={(id) => {
          const index = indexOfId(id)
          if (index >= 0) onSelectIndex(index)
          setLightboxOpen(true)
        }}
      />

      <p className="mt-2 text-xs text-muted">
        {t('photosCount')
          .replace('{count}', String(photos.length))
          .replace('{max}', String(MAX_MOVEMENT_PHOTOS))}
        {photos.length >= MAX_MOVEMENT_PHOTOS && (
          <span className="ms-2">{t('maxPhotosReached')}</span>
        )}
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_MOVEMENT_PHOTO_TYPES.join(',')}
        multiple
        disabled={uploading}
        className="hidden"
        onChange={(event) => {
          onAddFiles(event.target.files)
          event.target.value = ''
        }}
      />

      <Lightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        items={items}
        index={safeIndex}
        onIndexChange={onSelectIndex}
      />
    </div>
  )
}
