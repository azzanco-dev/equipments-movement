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
