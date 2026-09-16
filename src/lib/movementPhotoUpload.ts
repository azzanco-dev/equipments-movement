import { supabase } from '@/lib/supabase'

interface UploadAuthorization {
  path: string
  token: string
}

export interface PendingMovementPhotoBatch {
  batchId: string
  paths: string[]
}

export type MovementPhotoUploadError =
  'photo_authorization_failed' | 'photo_transfer_failed' | 'photo_link_failed'

export interface MovementPhotoUploadResult {
  success: boolean
  error?: MovementPhotoUploadError
}

function safeFileName(name: string, fallback: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || fallback
}

export async function uploadMovementPhotosDirectly(
  movementId: string,
  files: File[],
  userId: string,
  sortOrderOffset = 0,
): Promise<MovementPhotoUploadResult[]> {
  if (!files.length) return []

  const results: MovementPhotoUploadResult[] = files.map(() => ({
    success: false,
    error: 'photo_transfer_failed',
  }))
  const transferred = await Promise.all(
    files.map(async (file, index) => {
      const fileName = safeFileName(file.name, `photo-${index}.jpg`)
      const path = `${userId}/${movementId}/${crypto.randomUUID()}-${fileName}`
      try {
        const { error } = await supabase.storage
          .from('log-photos')
          .upload(path, file, {
            contentType: file.type,
            upsert: false,
          })
        if (error) {
          console.error('Photo transfer failed', error.message)
          return null
        }
        return { index, path }
      } catch (error) {
        console.error(
          'Photo transfer failed',
          error instanceof Error ? error.message : 'unknown_error',
        )
        return null
      }
    }),
  )
  const completedTransfers = transferred.filter(
    (item): item is { index: number; path: string } => item !== null,
  )
  if (!completedTransfers.length) return results

  const { error: linkError } = await supabase.from('entry_exit_photos').insert(
    completedTransfers.map(({ index, path }) => ({
      entry_exit_log_id: movementId,
      file_path: path,
      uploaded_by: userId,
      sort_order: sortOrderOffset + index,
    })),
  )
  if (linkError) {
    console.error('Photo link failed', linkError.message)
    await supabase.storage
      .from('log-photos')
      .remove(completedTransfers.map(({ path }) => path))
    for (const { index } of completedTransfers) {
      results[index] = { success: false, error: 'photo_link_failed' }
    }
    return results
  }

  for (const { index } of completedTransfers) {
    results[index] = { success: true }
  }
  return results
}

const TUS_CHUNK_BYTES = 6 * 1024 * 1024
const MAX_STANDARD_UPLOAD_BYTES = 6 * 1024 * 1024
const COMPLETE_RETRY_DELAYS = [0, 750, 1500]

function wait(delay: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delay))
}

function resumableUploadEndpoint() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('Missing Supabase URL')
  const url = new URL(supabaseUrl)
  const projectId = url.hostname.match(/^([^.]+)\.supabase\.co$/)?.[1]
  return projectId
    ? `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`
    : `${url.origin}/storage/v1/upload/resumable`
}

async function uploadResumably(
  file: File,
  authorization: UploadAuthorization,
  accessToken: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const tus = await import('tus-js-client')
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: resumableUploadEndpoint(),
      chunkSize: TUS_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-signature': authorization.token,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: 'log-photos',
        objectName: authorization.path,
        contentType: file.type,
        cacheControl: '3600',
      },
      onProgress: (uploadedBytes, totalBytes) =>
        onProgress?.(
          totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0,
        ),
      onError: (error) => reject(error),
      onSuccess: () => {
        onProgress?.(100)
        resolve()
      },
    })
    upload.start()
  })
}

export async function discardPendingMovementPhotoBatch(
  batchId: string,
  accessToken: string,
) {
  await fetch('/api/movements/photo-uploads', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ batchId }),
  }).catch(() => undefined)
}

// One staged photo is one batch, so adding or removing a photo never touches
// the storage objects of the photos that are already uploaded.
export async function uploadPendingMovementPhoto(
  file: File,
  accessToken: string,
  onProgress: (progress: number) => void,
): Promise<PendingMovementPhotoBatch> {
  const response = await fetch('/api/movements/photo-uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: [
        {
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        },
      ],
    }),
  })
  if (!response.ok) throw new Error('photo_authorization_failed')
  const result = (await response.json()) as {
    batchId?: string
    uploads?: UploadAuthorization[]
  }
  const authorization =
    result.uploads?.length === 1 ? result.uploads[0] : undefined
  if (!result.batchId || !authorization)
    throw new Error('photo_authorization_failed')

  try {
    await uploadResumably(file, authorization, accessToken, onProgress)
  } catch (error) {
    await discardPendingMovementPhotoBatch(result.batchId, accessToken)
    throw error
  }

  return { batchId: result.batchId, paths: [authorization.path] }
}

async function uploadDirectly(
  file: File,
  authorization: UploadAuthorization,
): Promise<void> {
  const { error } = await supabase.storage
    .from('log-photos')
    .uploadToSignedUrl(authorization.path, authorization.token, file, {
      contentType: file.type,
      upsert: false,
    })
  if (error) throw error
}

async function authorizeUploads(
  movementId: string,
  files: File[],
  accessToken: string,
): Promise<UploadAuthorization[] | null> {
  try {
    const response = await fetch(`/api/movements/${movementId}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'authorize_uploads',
        files: files.map((file) => ({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        })),
      }),
    })
    if (!response.ok) return null
    const result = (await response.json()) as {
      uploads?: UploadAuthorization[]
    }
    return result.uploads?.length === files.length ? result.uploads : null
  } catch {
    return null
  }
}

async function completeUploads(
  movementId: string,
  paths: string[],
  accessToken: string,
): Promise<boolean> {
  for (const delay of COMPLETE_RETRY_DELAYS) {
    if (delay) await wait(delay)
    try {
      const response = await fetch(`/api/movements/${movementId}/photos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'complete_uploads',
          filePaths: paths,
        }),
      })
      if (response.ok) return true
      if (response.status < 500) return false
    } catch {
      // Retry transient network failures. Completion is idempotent server-side.
    }
  }
  return false
}

export async function uploadMovementPhotos(
  movementId: string,
  files: File[],
  accessToken: string,
  authorizedUploads?: UploadAuthorization[],
): Promise<MovementPhotoUploadResult[]> {
  if (!files.length) return []
  const authorizations =
    authorizedUploads?.length === files.length
      ? authorizedUploads
      : await authorizeUploads(movementId, files, accessToken)
  if (!authorizations) {
    return files.map(() => ({
      success: false,
      error: 'photo_authorization_failed',
    }))
  }

  const transferred: Array<{
    index: number
    authorization: UploadAuthorization
  }> = []
  const results: MovementPhotoUploadResult[] = files.map(() => ({
    success: false,
    error: 'photo_transfer_failed',
  }))

  for (const [index, file] of files.entries()) {
    const authorization = authorizations[index]
    try {
      if (file.size <= MAX_STANDARD_UPLOAD_BYTES) {
        await uploadDirectly(file, authorization)
      } else {
        await uploadResumably(file, authorization, accessToken)
      }
      transferred.push({ index, authorization })
    } catch (error) {
      console.error(
        'Photo transfer failed',
        error instanceof Error ? error.message : 'unknown_error',
      )
      await supabase.storage.from('log-photos').remove([authorization.path])
    }
  }

  if (!transferred.length) return results

  const transferredPaths = transferred.map(
    ({ authorization }) => authorization.path,
  )
  if (await completeUploads(movementId, transferredPaths, accessToken)) {
    for (const { index } of transferred) results[index] = { success: true }
    return results
  }

  await supabase.storage.from('log-photos').remove(transferredPaths)
  for (const { index } of transferred) {
    results[index] = { success: false, error: 'photo_link_failed' }
  }
  return results
}
