import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { prepareMovementPhotos } from '@/lib/movementPhotoCompression'
import {
  discardPendingMovementPhotoBatch,
  uploadPendingMovementPhoto,
  type PendingMovementPhotoBatch,
} from '@/lib/movementPhotoUpload'

export const MAX_MOVEMENT_PHOTOS = 3
export const MAX_MOVEMENT_PHOTO_BYTES = 10 * 1024 * 1024
export const ALLOWED_MOVEMENT_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

export type StagedPhotoStatus = 'preparing' | 'uploading' | 'uploaded' | 'error'

export type StagedPhotoError =
  'invalid_type' | 'too_large' | 'session_expired' | 'upload_failed'

export interface StagedPhoto {
  id: string
  name: string
  previewUrl: string
  status: StagedPhotoStatus
  progress: number
}

interface StagedPhotoRecord extends StagedPhoto {
  file: File
  batch: PendingMovementPhotoBatch | null
  attempt: number
}

interface MovementPhotoStagingOptions {
  // Called with a staging error code, or null once staging succeeds.
  onError: (error: StagedPhotoError | null) => void
}

export interface MovementPhotoStaging {
  photos: StagedPhoto[]
  uploading: boolean
  ready: boolean
  hasFailedUploads: boolean
  // Returns how many photos were accepted and staged.
  addPhotos: (files: ArrayLike<File> | null) => number
  removePhoto: (index: number) => void
  // Retries one failed slot; slots that already uploaded are never touched.
  retryPhoto: (id: string) => void
  retryFailedUploads: () => void
  uploadBatchIds: () => string[]
  releaseUploads: () => void
  reset: () => void
}

async function currentAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export function useMovementPhotoStaging({
  onError,
}: MovementPhotoStagingOptions): MovementPhotoStaging {
  const [photos, setPhotos] = useState<StagedPhotoRecord[]>([])
  // The ref is the source of truth: uploads finish out of order and slots are
  // matched by id, so index-based state updates would be unreliable.
  const photosRef = useRef<StagedPhotoRecord[]>([])
  const nextPhotoIdRef = useRef(0)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const updatePhotos = useCallback(
    (updater: (current: StagedPhotoRecord[]) => StagedPhotoRecord[]) => {
      photosRef.current = updater(photosRef.current)
      setPhotos(photosRef.current)
    },
    [],
  )

  const patchPhoto = useCallback(
    (id: string, changes: Partial<StagedPhotoRecord>) => {
      updatePhotos((current) =>
        current.map((photo) =>
          photo.id === id ? { ...photo, ...changes } : photo,
        ),
      )
    },
    [updatePhotos],
  )

  const discardBatch = useCallback(async (batch: PendingMovementPhotoBatch) => {
    const accessToken = await currentAccessToken()
    if (accessToken)
      await discardPendingMovementPhotoBatch(batch.batchId, accessToken)
  }, [])

  const uploadPhoto = useCallback(
    async (id: string) => {
      const record = photosRef.current.find((photo) => photo.id === id)
      if (!record) return
      const attempt = record.attempt + 1
      // A superseded attempt for this slot is discarded; other slots keep
      // their finished uploads.
      const isCurrentAttempt = () =>
        photosRef.current.some(
          (photo) => photo.id === id && photo.attempt === attempt,
        )
      const previousBatch = record.batch
      patchPhoto(id, {
        attempt,
        batch: null,
        status: 'preparing',
        progress: 0,
      })

      const accessToken = await currentAccessToken()
      if (previousBatch && accessToken)
        void discardPendingMovementPhotoBatch(
          previousBatch.batchId,
          accessToken,
        )
      if (!isCurrentAttempt()) return
      if (!accessToken) {
        patchPhoto(id, { status: 'error', progress: 0 })
        onErrorRef.current('session_expired')
        return
      }

      try {
        const [preparedFile] = await prepareMovementPhotos([record.file])
        if (!isCurrentAttempt()) return
        patchPhoto(id, { status: 'uploading', progress: 0 })
        const batch = await uploadPendingMovementPhoto(
          preparedFile,
          accessToken,
          (progress) => {
            if (!isCurrentAttempt()) return
            patchPhoto(id, { status: 'uploading', progress })
          },
        )
        if (!isCurrentAttempt()) {
          // The slot was removed or restarted while this upload ran, so its
          // staged object must not stay behind.
          await discardPendingMovementPhotoBatch(batch.batchId, accessToken)
          return
        }
        patchPhoto(id, { batch, status: 'uploaded', progress: 100 })
        onErrorRef.current(null)
      } catch (error) {
        if (!isCurrentAttempt()) return
        console.error(
          'Pending photo upload failed',
          error instanceof Error ? error.message : 'unknown_error',
        )
        patchPhoto(id, { status: 'error', progress: 0 })
        onErrorRef.current('upload_failed')
      }
    },
    [patchPhoto],
  )

  const addPhotos = useCallback(
    (files: ArrayLike<File> | null) => {
      if (!files?.length) return 0
      const remainingSlots = MAX_MOVEMENT_PHOTOS - photosRef.current.length
      if (remainingSlots <= 0) return 0

      const selectedFiles = Array.from(files).slice(0, remainingSlots)
      if (
        selectedFiles.some(
          (file) => !ALLOWED_MOVEMENT_PHOTO_TYPES.includes(file.type),
        )
      ) {
        onErrorRef.current('invalid_type')
        return 0
      }
      if (selectedFiles.some((file) => file.size > MAX_MOVEMENT_PHOTO_BYTES)) {
        onErrorRef.current('too_large')
        return 0
      }

      onErrorRef.current(null)
      const added = selectedFiles.map((file) => {
        nextPhotoIdRef.current += 1
        return {
          id: `photo-${nextPhotoIdRef.current}`,
          name: file.name,
          previewUrl: URL.createObjectURL(file),
          status: 'preparing' as StagedPhotoStatus,
          progress: 0,
          file,
          batch: null,
          attempt: 0,
        }
      })
      updatePhotos((current) => [...current, ...added])
      // Only the newly selected files are prepared and uploaded.
      for (const photo of added) void uploadPhoto(photo.id)
      return added.length
    },
    [updatePhotos, uploadPhoto],
  )

  const removePhoto = useCallback(
    (index: number) => {
      const removed = photosRef.current[index]
      if (!removed) return
      URL.revokeObjectURL(removed.previewUrl)
      updatePhotos((current) => current.filter((_, i) => i !== index))
      if (removed.batch) void discardBatch(removed.batch)
    },
    [discardBatch, updatePhotos],
  )

  const retryPhoto = useCallback(
    (id: string) => {
      const photo = photosRef.current.find((item) => item.id === id)
      if (photo?.status === 'error') void uploadPhoto(id)
    },
    [uploadPhoto],
  )

  const retryFailedUploads = useCallback(() => {
    for (const photo of photosRef.current) {
      if (photo.status === 'error') void uploadPhoto(photo.id)
    }
  }, [uploadPhoto])

  const uploadBatchIds = useCallback(
    () =>
      photosRef.current
        .map((photo) => photo.batch?.batchId)
        .filter((batchId): batchId is string => Boolean(batchId)),
    [],
  )

  // The saved movement owns the staged objects now; they must not be discarded.
  const releaseUploads = useCallback(() => {
    updatePhotos((current) =>
      current.map((photo) => ({ ...photo, batch: null })),
    )
  }, [updatePhotos])

  const reset = useCallback(() => {
    const previous = photosRef.current
    updatePhotos(() => [])
    for (const photo of previous) {
      URL.revokeObjectURL(photo.previewUrl)
      if (photo.batch) void discardBatch(photo.batch)
    }
  }, [discardBatch, updatePhotos])

  useEffect(() => {
    return () => {
      for (const photo of photosRef.current)
        URL.revokeObjectURL(photo.previewUrl)
    }
  }, [])

  return {
    photos,
    uploading: photos.some(
      (photo) => photo.status === 'preparing' || photo.status === 'uploading',
    ),
    ready:
      photos.length > 0 && photos.every((photo) => photo.status === 'uploaded'),
    hasFailedUploads: photos.some((photo) => photo.status === 'error'),
    addPhotos,
    removePhoto,
    retryPhoto,
    retryFailedUploads,
    uploadBatchIds,
    releaseUploads,
    reset,
  }
}
