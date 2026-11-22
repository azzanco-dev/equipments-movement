import type { TranslationKey } from '@/i18n/translations'
import {
  contractFileError,
  contractFileErrorKey,
  contractFilePath,
  INSTALLMENT_FILES_BUCKET,
  type DraftInstallmentFile,
  type InstallmentFile,
  type InstallmentFileKind,
} from '@/lib/installmentFiles'
import { isPartyDocumentMime, storedFileName } from '@/lib/partyDocuments'
import { supabase } from '@/lib/supabase'

/**
 * The writes of the contract files (migration 0209). The order leaves no
 * row without its file: upload, then `add_installment_contract_file` (the
 * new file is removed when that is refused); remove the row, then its file.
 * An object left behind by a failed removal is unreferenced and harmless.
 */

export class InstallmentFileError extends Error {
  constructor(readonly key: TranslationKey) {
    super(key)
    this.name = 'InstallmentFileError'
  }
}

/** Removes objects whose rows are gone. True when every one went. */
export async function removeInstallmentFileObjects(
  paths: readonly string[],
): Promise<boolean> {
  if (paths.length === 0) return true
  try {
    const { error } = await supabase.storage
      .from(INSTALLMENT_FILES_BUCKET)
      .remove([...paths])
    return !error
  } catch {
    return false
  }
}

export async function uploadInstallmentFile(
  contractId: string,
  file: File,
  kind: InstallmentFileKind,
  title = '',
): Promise<void> {
  const fileError = contractFileError(file)
  if (fileError || !isPartyDocumentMime(file.type))
    throw new InstallmentFileError(fileError ?? 'instReceiptTypeInvalid')
  const path = contractFilePath(contractId, file.type, crypto.randomUUID())

  const uploaded = await supabase.storage
    .from(INSTALLMENT_FILES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploaded.error)
    throw new InstallmentFileError(contractFileErrorKey(uploaded.error))

  const { error } = await supabase.rpc('add_installment_contract_file', {
    p_contract_id: contractId,
    p_storage_path: path,
    p_file_name: storedFileName(file.name),
    p_mime_type: file.type,
    p_size_bytes: file.size,
    p_kind: kind,
    p_title: title.trim() || null,
  })
  if (error) {
    await removeInstallmentFileObjects([path])
    throw new InstallmentFileError(contractFileErrorKey(error))
  }
}

/**
 * The files picked on the new-contract page, one after the other once the
 * contract exists. A failed file never undoes the contract: returns how
 * many could not be uploaded.
 */
export async function uploadDraftInstallmentFiles(
  contractId: string,
  files: readonly DraftInstallmentFile[],
  onProgress: (done: number) => void,
): Promise<number> {
  let failed = 0
  for (const [index, item] of files.entries()) {
    onProgress(index + 1)
    try {
      await uploadInstallmentFile(contractId, item.file, item.kind)
    } catch {
      failed += 1
    }
  }
  return failed
}

/** Removes a stored file's row, then its object. */
export async function removeInstallmentFile(fileId: string): Promise<void> {
  const { data, error } = await supabase.rpc(
    'remove_installment_contract_file',
    { p_file_id: fileId },
  )
  if (error) throw new InstallmentFileError(contractFileErrorKey(error))
  if (typeof data === 'string') await removeInstallmentFileObjects([data])
}

/** A link to the file for five minutes (the bucket has no public URL). */
export async function installmentFileUrl(
  file: Pick<InstallmentFile, 'storage_path'>,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(INSTALLMENT_FILES_BUCKET)
    .createSignedUrl(file.storage_path, 300)
  if (error || !data?.signedUrl)
    throw new InstallmentFileError('instFileOpenFailed')
  return data.signedUrl
}
