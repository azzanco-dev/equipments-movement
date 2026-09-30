// Maps staged movement photos (four upload states) onto the three states the
// shared `PhotoGallery` renders. Kept pure so the mapping is unit-tested
// without React.

export type StagedPhotoUploadStatus =
  'preparing' | 'uploading' | 'uploaded' | 'error'

export interface StagedPhotoLike {
  id: string
  name: string
  previewUrl: string
  status: StagedPhotoUploadStatus
  progress: number
}

/** Structurally compatible with `PhotoGalleryItem` and `LightboxItem`. */
export interface MovementGalleryItem {
  id: string
  src: string
  alt: string
  status: 'ready' | 'uploading' | 'error'
  progress?: number
  /** `false` hides the remove button of this photo only. */
  removable?: boolean
}

/** `preparing` shows the same busy overlay as `uploading`, without a percentage. */
export function galleryPhotoStatus(
  status: StagedPhotoUploadStatus,
): MovementGalleryItem['status'] {
  if (status === 'uploaded') return 'ready'
  if (status === 'error') return 'error'
  return 'uploading'
}

export function galleryPhotoProgress(
  photo: Pick<StagedPhotoLike, 'status' | 'progress'>,
): number | undefined {
  return photo.status === 'uploading' ? photo.progress : undefined
}

export function stagedPhotosToGalleryItems(
  photos: readonly StagedPhotoLike[],
): MovementGalleryItem[] {
  return photos.map((photo) => ({
    id: photo.id,
    src: photo.previewUrl,
    alt: photo.name,
    status: galleryPhotoStatus(photo.status),
    progress: galleryPhotoProgress(photo),
  }))
}

// ---------------------------------------------------------------------------
// Movement detail page: saved photos (`entry_exit_photos` rows with a signed
// URL), the legacy `entry_exit_logs.photo_url` photo and files being uploaded.

/** Width of the photo gallery on the movement detail page, shared with the
 * page's skeleton so both occupy exactly the same box: full width on phones,
 * capped and start-aligned inside the wide desktop card. */
export const MOVEMENT_DETAIL_GALLERY_WIDTH_CLASS = 'w-full max-w-md'

export const LEGACY_PHOTO_ID = 'legacy-photo'

export interface SavedPhotoLike {
  id: string
  url: string
  uploaded_by: string | null
}

export interface PhotoViewer {
  userId: string | null | undefined
  role: string | null | undefined
}

/** Only the photo's uploader or an admin sees the delete button, never the
 * read-only monitor. Display rule only: the API and RLS enforce it. */
export function canRemoveSavedPhoto(
  photo: Pick<SavedPhotoLike, 'uploaded_by'>,
  viewer: PhotoViewer,
): boolean {
  if (viewer.role === 'monitor') return false
  if (viewer.role === 'admin') return true
  return Boolean(viewer.userId) && photo.uploaded_by === viewer.userId
}

export interface DetailGalleryInput {
  saved: readonly SavedPhotoLike[]
  /** Signed URL of the legacy `photo_url` photo, if the movement has one. */
  legacyUrl: string | null
  /** Files being uploaded right now, shown with their local preview. */
  pending: readonly StagedPhotoLike[]
  viewer: PhotoViewer
  /** A photo request is running, so no photo can be removed meanwhile. */
  busy: boolean
  /** Base alt text; saved photos append their 1-based position. */
  alt: string
}

/**
 * Saved photos first, then the files being uploaded. The legacy photo is a
 * fallback only: it shows when the movement has no photo rows and nothing is
 * uploading, and it has no remove button (it never had one).
 */
export function detailPhotosToGalleryItems({
  saved,
  legacyUrl,
  pending,
  viewer,
  busy,
  alt,
}: DetailGalleryInput): MovementGalleryItem[] {
  const pendingItems = stagedPhotosToGalleryItems(pending)
  if (saved.length === 0 && pendingItems.length === 0) {
    return legacyUrl
      ? [
          {
            id: LEGACY_PHOTO_ID,
            src: legacyUrl,
            alt,
            status: 'ready',
            removable: false,
          },
        ]
      : []
  }
  return [
    ...saved.map((photo, index): MovementGalleryItem => ({
      id: photo.id,
      src: photo.url,
      alt: `${alt} ${index + 1}`,
      status: 'ready',
      removable: !busy && canRemoveSavedPhoto(photo, viewer),
    })),
    ...pendingItems,
  ]
}
