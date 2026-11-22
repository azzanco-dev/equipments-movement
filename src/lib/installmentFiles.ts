import type { TranslationKey } from '@/i18n/translations'
import {
  installmentErrorMessage,
  type InstallmentDatabaseError,
} from '@/lib/installments'
import {
  isPartyDocumentMime,
  PARTY_DOCUMENT_MIME_TYPES,
} from '@/lib/partyDocuments'

/**
 * The files of an installment contract (migration 0209, owner 2026-11-22
 * «ارفاق ملف العقد», «حد الملف 5 ميقا»): the pure rules. Several files per
 * contract in the private bucket `installment-contract-files`, at
 * <contract id>/<uuid>.<ext>; PDF or a JPEG / PNG / WEBP image, at most 5 MB
 * (the limits of the receipts and the party documents). A cancelled
 * contract keeps its files, view only.
 */

export const INSTALLMENT_FILES_BUCKET = 'installment-contract-files'
export const INSTALLMENT_FILE_MAX_BYTES = 5 * 1024 * 1024
export const INSTALLMENT_FILE_ACCEPT = PARTY_DOCUMENT_MIME_TYPES.join(',')
export const INSTALLMENT_FILE_TITLE_MAX = 100
export const INSTALLMENT_FILE_SELECT =
  'id,contract_id,kind,title,storage_path,file_name,mime_type,size_bytes,uploaded_by_name,created_at'

export type InstallmentFileKind = 'contract' | 'annex' | 'schedule' | 'other'

export const INSTALLMENT_FILE_KINDS: readonly InstallmentFileKind[] = [
  'contract',
  'annex',
  'schedule',
  'other',
]

export const INSTALLMENT_FILE_KIND_LABEL_KEYS: Readonly<
  Record<InstallmentFileKind, TranslationKey>
> = {
  contract: 'instFileKindContract',
  annex: 'instFileKindAnnex',
  schedule: 'instFileKindSchedule',
  other: 'instFileKindOther',
}

/** A stored file (one row of `installment_contract_files`). */
export interface InstallmentFile {
  id: string
  contract_id: string
  kind: InstallmentFileKind
  title: string | null
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by_name: string | null
  created_at: string
}

/** A file picked on the new-contract page, uploaded after the save. */
export interface DraftInstallmentFile {
  key: string
  file: File
  kind: InstallmentFileKind
}

type FileMime = (typeof PARTY_DOCUMENT_MIME_TYPES)[number]

const EXTENSIONS: Record<FileMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Why a picked file cannot be uploaded, or null. */
export function contractFileError(file: {
  type: string
  size: number
}): TranslationKey | null {
  if (!isPartyDocumentMime(file.type)) return 'instReceiptTypeInvalid'
  if (file.size <= 0) return 'instReceiptEmpty'
  if (file.size > INSTALLMENT_FILE_MAX_BYTES) return 'instFileTooLarge'
  return null
}

/** The object path the 0209 policies accept. */
export function contractFilePath(
  contractId: string,
  mime: FileMime,
  fileId: string,
): string {
  return `${contractId}/${fileId}.${EXTENSIONS[mime]}`
}

/** The picked file's kind until the user says: the first is the contract. */
export function defaultFileKind(
  picked: readonly Pick<DraftInstallmentFile, 'kind'>[],
): InstallmentFileKind {
  return picked.some((item) => item.kind === 'contract') ? 'other' : 'contract'
}

/** The safe message of a refused file write; never the raw text. */
export function contractFileErrorKey(
  error: InstallmentDatabaseError | null | undefined,
): TranslationKey {
  const text = [error?.message, error?.details]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (text.includes('exceeded the maximum allowed size'))
    return 'instFileTooLarge'
  if (text.includes('mime type')) return 'instReceiptTypeInvalid'
  if (text.includes('row-level security')) return 'instFileRefused'
  const key = installmentErrorMessage(error)
  return key === 'instSaveFailed' ? 'instFileSaveFailed' : key
}
