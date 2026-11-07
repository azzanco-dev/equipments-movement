import type { TranslationKey } from '@/i18n/translations'

/**
 * The documents of a supplier or a client (owner 2026-11-07, migration 0182;
 * approved on /ui-kit «مستندات الموردين والشركات»). Pure rules only: the
 * types per party, the file limits of the bucket, the storage path, the
 * labels and the database error → message mapping. No expiry date and no
 * uploader on screen (owner: «بدون تاريخ الانتهاء … وبدون تاريخ الرفع ومين
 * رفعه»).
 */

export type PartyKind = 'lessor' | 'company'

export type PartyDocumentType =
  | 'commercial_register'
  | 'tax_certificate'
  | 'iban_certificate'
  | 'national_address'
  | 'other'

/** A stored document (one row of `party_documents`). */
export interface PartyDocument {
  id: string
  doc_type: PartyDocumentType
  title: string | null
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

export const PARTY_DOCUMENTS_BUCKET = 'party-documents'
export const PARTY_DOCUMENT_SELECT =
  'id,doc_type,title,storage_path,file_name,mime_type,size_bytes,created_at'

/** The fixed types, one current file each; the clients have no IBAN. */
export const PARTY_DOCUMENT_TYPES: Readonly<
  Record<PartyKind, readonly Exclude<PartyDocumentType, 'other'>[]>
> = {
  lessor: [
    'commercial_register',
    'tax_certificate',
    'iban_certificate',
    'national_address',
  ],
  company: ['commercial_register', 'tax_certificate', 'national_address'],
}

export const PARTY_DOCUMENT_LABEL_KEYS: Readonly<
  Record<PartyDocumentType, TranslationKey>
> = {
  commercial_register: 'partyDocCommercialRegister',
  tax_certificate: 'partyDocTaxCertificate',
  iban_certificate: 'partyDocIbanCertificate',
  national_address: 'partyDocNationalAddress',
  other: 'partyDocOther',
}

/** The bucket's limits: 5 MB (0183, owner «خلي الحد الاقصى 5 ميقا»; 0182
 *  had 10), PDF or a JPEG / PNG / WEBP image. */
export const PARTY_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024
export const PARTY_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const
export const PARTY_DOCUMENT_ACCEPT = PARTY_DOCUMENT_MIME_TYPES.join(',')
export const PARTY_DOCUMENT_TITLE_MAX = 100

const EXTENSIONS: Record<(typeof PARTY_DOCUMENT_MIME_TYPES)[number], string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function isPartyDocumentMime(
  value: string,
): value is (typeof PARTY_DOCUMENT_MIME_TYPES)[number] {
  return (PARTY_DOCUMENT_MIME_TYPES as readonly string[]).includes(value)
}

/** Why a picked file cannot be uploaded, or null. */
export function partyDocumentFileError(file: {
  type: string
  size: number
}): TranslationKey | null {
  if (!isPartyDocumentMime(file.type)) return 'partyDocFileTypeInvalid'
  if (file.size <= 0) return 'partyDocFileEmpty'
  if (file.size > PARTY_DOCUMENT_MAX_BYTES) return 'partyDocFileTooLarge'
  return null
}

/** The object path the 0182 policies accept: <kind>/<party id>/<uuid>.<ext>. */
export function partyDocumentPath(
  kind: PartyKind,
  partyId: string,
  mime: (typeof PARTY_DOCUMENT_MIME_TYPES)[number],
  fileId: string,
): string {
  return `${kind}/${partyId}/${fileId}.${EXTENSIONS[mime]}`
}

/** The file name as stored: the picked name, at most 255 characters. */
export function storedFileName(name: string): string {
  const trimmed = name.trim() || 'document'
  return trimmed.length <= 255 ? trimmed : trimmed.slice(trimmed.length - 255)
}

export function isImageDocument(doc: Pick<PartyDocument, 'mime_type'>): boolean {
  return doc.mime_type.startsWith('image/')
}

/** «819 كيلو» / «2.4 ميغا» (the unit words come from the translations). */
export function formatDocumentSize(
  bytes: number,
  t: (key: TranslationKey) => string,
): string {
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} ${t('partyDocKb')}`
  return `${(kb / 1024).toFixed(1)} ${t('partyDocMb')}`
}

/** The current file of each fixed type, and the «other» documents in order. */
export function groupPartyDocuments(
  kind: PartyKind,
  documents: readonly PartyDocument[],
): {
  fixed: { type: Exclude<PartyDocumentType, 'other'>; document?: PartyDocument }[]
  others: PartyDocument[]
} {
  return {
    fixed: PARTY_DOCUMENT_TYPES[kind].map((type) => ({
      type,
      document: documents.find((doc) => doc.doc_type === type),
    })),
    others: documents
      .filter((doc) => doc.doc_type === 'other')
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }
}

/** A safe message for a refused document write (never the raw error). */
export function partyDocumentErrorKey(
  error: { message?: string; code?: string } | null | undefined,
): TranslationKey {
  const message = error?.message ?? ''
  if (/party_documents_(lessor|company)_type_unique/.test(message))
    return 'partyDocAlreadyExists'
  if (/party_documents_title_check/.test(message)) return 'partyDocTitleRequired'
  if (/mime|party_documents_mime_type_check|invalid_mime_type/i.test(message))
    return 'partyDocFileTypeInvalid'
  if (/size|too large|party_documents_size_bytes_check|Payload too large/i.test(message))
    return 'partyDocFileTooLarge'
  if (error?.code === '42501' || /row-level security|policy/i.test(message))
    return 'partyDocNotAllowed'
  return 'partyDocSaveFailed'
}

/** True when deleting a supplier or a client failed on its documents. */
export function blockedByPartyDocuments(
  error: { message?: string; details?: string } | null | undefined,
): boolean {
  return /party_documents/.test(`${error?.message ?? ''} ${error?.details ?? ''}`)
}
