import { supabase } from '@/lib/supabase'

interface UploadAuthorization {
  path: string
  token: string
}

export async function uploadMovementPhoto(
  movementId: string,
  file: File,
  accessToken: string,
): Promise<boolean> {
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
  if (!authorizeResponse.ok) return false

  const authorization = (await authorizeResponse.json()) as UploadAuthorization
  const { error: uploadError } = await supabase.storage
    .from('log-photos')
    .uploadToSignedUrl(authorization.path, authorization.token, file, {
      contentType: file.type,
    })
  if (uploadError) return false

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
  if (completeResponse.ok) return true

  await supabase.storage.from('log-photos').remove([authorization.path])
  return false
}
