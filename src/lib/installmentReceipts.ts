import type { TranslationKey } from '@/i18n/translations'
import {
  PARTY_DOCUMENT_MIME_TYPES,
  isPartyDocumentMime,
} from '@/lib/partyDocuments'

/**
 * The transfer receipt of an installment payment («ملف الحوالة», migration
 * 0206): the pure rules. One current file per payment in the private bucket
 * `installment-receipts`, at <contract id>/<payment id>/<uuid>.<ext>; PDF or
 * a JPEG / PNG / WEBP image, at most 5 MB (the limits of the party
 * documents, 0183). A voided payment keeps its file and takes no change.
 */

export const INSTALLMENT_RECEIPTS_BUCKET = 'installment-receipts'
export const INSTALLMENT_RECEIPT_MAX_BYTES = 5 * 1024 * 1024
export const INSTALLMENT_RECEIPT_ACCEPT = PARTY_DOCUMENT_MIME_TYPES.join(',')

type ReceiptMime = (typeof PARTY_DOCUMENT_MIME_TYPES)[number]

const EXTENSIONS: Record<ReceiptMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** The receipt as `installment_payment_list` carries it (0206 columns). */
export interface InstallmentReceipt {
  id: string
  path: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface InstallmentReceiptColumns {
  receipt_id?: string | null
  receipt_path?: string | null
  receipt_file_name?: string | null
  receipt_mime_type?: string | null
  receipt_size_bytes?: number | null
}

/** The receipt of a payment row, or null when none is attached. */
export function receiptOf(row: InstallmentReceiptColumns): InstallmentReceipt | null {
  if (!row.receipt_id || !row.receipt_path) return null
  return {
    id: row.receipt_id,
    path: row.receipt_path,
    fileName: row.receipt_file_name || 'receipt',
    mimeType: row.receipt_mime_type || 'application/pdf',
    sizeBytes: Number(row.receipt_size_bytes) || 0,
  }
}

export function isImageReceipt(receipt: Pick<InstallmentReceipt, 'mimeType'>): boolean {
  return receipt.mimeType.startsWith('image/')
}

/** Why a picked file cannot be attached, or null. */
export function receiptFileError(file: {
  type: string
  size: number
}): TranslationKey | null {
  if (!isPartyDocumentMime(file.type)) return 'instReceiptTypeInvalid'
  if (file.size <= 0) return 'instReceiptEmpty'
  if (file.size > INSTALLMENT_RECEIPT_MAX_BYTES) return 'instReceiptTooLarge'
  return null
}

/** The object path the 0206 policies accept. */
export function receiptPath(
  contractId: string,
  paymentId: string,
  mime: ReceiptMime,
  fileId: string,
): string {
  return `${contractId}/${paymentId}/${fileId}.${EXTENSIONS[mime]}`
}

/** The file name as stored: the picked name, at most 255 characters. */
export function receiptFileName(name: string): string {
  const trimmed = name.trim() || 'receipt'
  return trimmed.length <= 255 ? trimmed : trimmed.slice(trimmed.length - 255)
}

/** A safe message for a refused receipt action (never the raw error). */
export function receiptErrorKey(
  error: { message?: string; code?: string } | null | undefined,
): TranslationKey {
  const message = error?.message ?? ''
  if (/payment_already_voided/.test(message)) return 'instReceiptVoided'
  if (/receipt_not_found/.test(message)) return 'instReceiptNotFound'
  if (/mime|invalid_mime_type/i.test(message)) return 'instReceiptTypeInvalid'
  if (/too large|Payload too large|maximum allowed size/i.test(message))
    return 'instReceiptTooLarge'
  if (
    error?.code === '42501' ||
    /installments_manage_required|row-level security|policy|Unauthorized/i.test(message)
  )
    return 'instReceiptNotAllowed'
  return 'instReceiptSaveFailed'
}
