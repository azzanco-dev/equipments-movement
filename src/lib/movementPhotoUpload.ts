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

export async function uploadMovementPhoto(
  movementId: string,
  file: File,
  accessToken: string,
): Promise<MovementPhotoUploadResult> {
  const authorizeResponse = await fetch(`/api/movements/${movementId}/photos`, {
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
  if (!authorizeResponse.ok) {
    return { success: false, error: 'photo_authorization_failed' }
  }

  const authorization = (await authorizeResponse.json()) as UploadAuthorization
  try {
    await uploadResumably(file, authorization, accessToken)
  } catch (error) {
    console.error(
      'Resumable photo upload failed',
      error instanceof Error ? error.message : 'unknown_error',
    )
    return { success: false, error: 'photo_transfer_failed' }
  }

  const completeResponse = await fetch(`/api/movements/${movementId}/photos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'complete_upload',
      filePath: authorization.path,
    }),
  })
  if (completeResponse.ok) return { success: true }

  await supabase.storage.from('log-photos').remove([authorization.path])
  return { success: false, error: 'photo_link_failed' }
}
