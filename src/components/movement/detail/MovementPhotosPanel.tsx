import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Button,
  Notice,
  PhotoGallery,
  SectionHeader,
  Spinner,
  type PhotoGalleryItem,
} from '@/components/ui'

export interface MovementPhotosPanelProps {
  /** New `entry_exit_photos` rows, or the single legacy `photo_url` photo. */
  photos: PhotoGalleryItem[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  /** Opens the lightbox on the selected photo. */
  onOpen: () => void
  /** Shows the "add photo" square. The caller decides the role and the
   *  max-three rule; PostgreSQL re-checks both on upload. */
  canAdd: boolean
  onAddFiles: (files: FileList | null) => void
  /** Shows the delete action for the SELECTED photo only (uploader or admin,
   *  never monitor); the API route and RLS remain authoritative. */
  canDeleteSelected: boolean
  onDeleteSelected: () => void
  busy: boolean
  error: string | null
}

/**
 * wave7-A — photos section of the movement detail page: the shared
 * `PhotoGallery` (main preview + three squares, `object-contain`) with the
 * add square wired to a hidden file input and a delete action for the
 * selected photo in the section header, because delete permission is per
 * photo (uploader or admin) while the gallery's remove buttons are not.
 */
export function MovementPhotosPanel({
  photos,
  selectedIndex,
  onSelectIndex,
  onOpen,
  canAdd,
  onAddFiles,
  canDeleteSelected,
  onDeleteSelected,
  busy,
  error,
}: MovementPhotosPanelProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedId = photos[selectedIndex]?.id ?? photos[0]?.id ?? null

  return (
    <div className="space-y-3">
      <SectionHeader
        title={t('photo')}
        action={
          busy ? (
            <span className="inline-flex items-center gap-2 text-xs text-muted">
              <Spinner size="sm" />
              {t('loading')}
            </span>
          ) : canDeleteSelected ? (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={onDeleteSelected}
            >
              {t('movementDeletePhoto')}
            </Button>
          ) : undefined
        }
      />
      {error && (
        <Notice tone="danger" size="compact">
          {error}
        </Notice>
      )}
      <PhotoGallery
        className="max-w-lg"
        photos={photos}
        selectedId={selectedId}
        onSelect={(id) => {
          const index = photos.findIndex((photo) => photo.id === id)
          if (index >= 0) onSelectIndex(index)
        }}
        onOpen={photos.length > 0 ? () => onOpen() : undefined}
        onAdd={canAdd && !busy ? () => inputRef.current?.click() : undefined}
        readOnly={!canAdd || busy}
      />
      {canAdd && (
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            onAddFiles(event.target.files)
            event.target.value = ''
          }}
        />
      )}
    </div>
  )
}
