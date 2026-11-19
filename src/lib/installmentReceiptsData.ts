import type { TranslationKey } from '@/i18n/translations'
import {
  INSTALLMENT_RECEIPTS_BUCKET,
  receiptErrorKey,
  receiptFileError,
  receiptFileName,
  receiptPath,
  type InstallmentReceipt,
} from '@/lib/installmentReceipts'
import { isPartyDocumentMime } from '@/lib/partyDocuments'
import { supabase } from '@/lib/supabase'

/**
 * The writes of the payment receipts (migration 0206). The order leaves no
 * row without its file: upload the file, then attach it through
 * `set_installment_payment_receipt` (removing the new file when that is
 * refused), and remove a file only once no row stores its path any more
 * (the replaced one, or the one `remove_installment_payment_receipt` gave
 * back). A file left behind by a failed removal is unreferenced and
 * harmless.
 */

export class InstallmentReceiptError extends Error {
  constructor(readonly key: TranslationKey) {
    super(key)
    this.name = 'InstallmentReceiptError'
  }
}

async function removeObject(path: string | null | undefined) {
  if (!path) return
  await supabase.storage.from(INSTALLMENT_RECEIPTS_BUCKET).remove([path])
}

/** Uploads the file and attaches it to the payment (replacing its receipt). */
export async function attachInstallmentReceipt(
  contractId: string,
  paymentId: string,
  file: File,
): Promise<void> {
  const fileError = receiptFileError(file)
  if (fileError || !isPartyDocumentMime(file.type))
    throw new InstallmentReceiptError(fileError ?? 'instReceiptTypeInvalid')
  const path = receiptPath(contractId, paymentId, file.type, crypto.randomUUID())

  const uploaded = await supabase.storage
    .from(INSTALLMENT_RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploaded.error)
    throw new InstallmentReceiptError(receiptErrorKey(uploaded.error))

  const { data, error } = await supabase.rpc('set_installment_payment_receipt', {
    p_payment_id: paymentId,
    p_storage_path: path,
    p_file_name: receiptFileName(file.name),
    p_mime_type: file.type,
    p_size_bytes: file.size,
  })
  if (error) {
    await removeObject(path)
    throw new InstallmentReceiptError(receiptErrorKey(error))
  }
  await removeObject(typeof data === 'string' ? data : null)
}

/** Removes the receipt of a posted payment, then its file. */
export async function removeInstallmentReceipt(paymentId: string): Promise<void> {
  const { data, error } = await supabase.rpc('remove_installment_payment_receipt', {
    p_payment_id: paymentId,
  })
  if (error) throw new InstallmentReceiptError(receiptErrorKey(error))
  await removeObject(typeof data === 'string' ? data : null)
}

/** A link to the file for five minutes (the bucket has no public URL). */
export async function installmentReceiptUrl(
  receipt: Pick<InstallmentReceipt, 'path'>,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(INSTALLMENT_RECEIPTS_BUCKET)
    .createSignedUrl(receipt.path, 300)
  if (error || !data?.signedUrl)
    throw new InstallmentReceiptError('instReceiptOpenFailed')
  return data.signedUrl
}
