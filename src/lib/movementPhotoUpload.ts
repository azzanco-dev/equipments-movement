import * as tus from 'tus-js-client'
import { supabase } from '@/lib/supabase'

interface UploadAuthorization {
  path: string
  token: string
}

export type MovementPhotoUploadError =
  'photo_authorization_failed' | 'photo_transfer_failed' | 'photo_link_failed'

export interface MovementPhotoUploadResult {
  success: boolean
  error?: MovementPhotoUploadError
}

const TUS_CHUNK_BYTES = 6 * 1024 * 1024
const MAX_STANDARD_UPLOAD_BYTES = 6 * 1024 * 1024
const MAX_TRANSFER_ATTEMPTS = 2
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

function uploadResumably(
  file: File,
  authorization: UploadAuthorization,
  accessToken: string,
): Promise<void> {
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
      onError: (error) => reject(error),
      onSuccess: () => resolve(),
    })
    upload.start()
  })
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

async function authorizeUpload(
  movementId: string,
  file: File,
  accessToken: string,
): Promise<UploadAuthorization | null> {
  try {
    const response = await fetch(`/api/movements/${movementId}/photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'authorize_upload',
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as UploadAuthorization
  } catch {
    return null
  }
}

async function completeUpload(
  movementId: string,
  path: string,
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
          action: 'complete_upload',
          filePath: path,
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

export async function uploadMovementPhoto(
  movementId: string,
  file: File,
  accessToken: string,
): Promise<MovementPhotoUploadResult> {
  let authorization: UploadAuthorization | null = null
  for (let attempt = 0; attempt < MAX_TRANSFER_ATTEMPTS; attempt += 1) {
    authorization = await authorizeUpload(movementId, file, accessToken)
    if (!authorization) {
      return { success: false, error: 'photo_authorization_failed' }
    }

    try {
      if (file.size <= MAX_STANDARD_UPLOAD_BYTES) {
        await uploadDirectly(file, authorization)
      } else {
        await uploadResumably(file, authorization, accessToken)
      }
      break
    } catch (error) {
      console.error(
        'Photo transfer failed',
        error instanceof Error ? error.message : 'unknown_error',
      )
      await supabase.storage.from('log-photos').remove([authorization.path])
      authorization = null
    }
  }

  if (!authorization)
    return { success: false, error: 'photo_transfer_failed' }

  if (await completeUpload(movementId, authorization.path, accessToken)) {
    return { success: true }
  }

  await supabase.storage.from('log-photos').remove([authorization.path])
  return { success: false, error: 'photo_link_failed' }
}
