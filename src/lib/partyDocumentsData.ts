import type { TranslationKey } from '@/i18n/translations'
import { supabase } from '@/lib/supabase'
import {
  PARTY_DOCUMENTS_BUCKET,
  PARTY_DOCUMENT_SELECT,
  isPartyDocumentMime,
  partyDocumentErrorKey,
  partyDocumentFileError,
  partyDocumentPath,
  storedFileName,
  type PartyDocument,
  type PartyDocumentType,
  type PartyKind,
} from '@/lib/partyDocuments'

/**
 * The reads and writes of the supplier / client documents (migration 0182).
 * RLS and the Storage policies decide everything; this module keeps the
 * order that leaves no file without its row: upload the file, then write
 * the row (removing the new file when the row is refused), and remove a
 * file only after no row stores its path any more.
 */

/** A refused document action, with the message to show. */
export class PartyDocumentError extends Error {
  constructor(readonly key: TranslationKey) {
    super(key)
    this.name = 'PartyDocumentError'
  }
}

const partyColumn = (kind: PartyKind) =>
  kind === 'lessor' ? 'lessor_id' : 'company_id'

export async function fetchPartyDocuments(
  kind: PartyKind,
  partyId: string,
  signal?: AbortSignal,
): Promise<PartyDocument[]> {
  let query = supabase
    .from('party_documents')
    .select(PARTY_DOCUMENT_SELECT)
    .eq(partyColumn(kind), partyId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    // Four fixed types plus the «other» documents of one party.
    .limit(100)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new PartyDocumentError('partyDocLoadFailed')
  return (data ?? []) as PartyDocument[]
}

async function removeObject(path: string) {
  // Best effort: a file left behind is unreferenced and harmless.
  await supabase.storage.from(PARTY_DOCUMENTS_BUCKET).remove([path])
}

export interface UploadPartyDocumentInput {
  kind: PartyKind
  partyId: string
  type: PartyDocumentType
  file: File
  /** The name of an «other» document (required for it, ignored otherwise). */
  title?: string
  /** The current file of a fixed type: its row now points to the new file. */
  replacing?: PartyDocument
}

/** Uploads the file and saves its row at once; returns the saved row. */
export async function uploadPartyDocument({
  kind,
  partyId,
  type,
  file,
  title,
  replacing,
}: UploadPartyDocumentInput): Promise<PartyDocument> {
  const fileError = partyDocumentFileError(file)
  if (fileError || !isPartyDocumentMime(file.type))
    throw new PartyDocumentError(fileError ?? 'partyDocFileTypeInvalid')
  const path = partyDocumentPath(kind, partyId, file.type, crypto.randomUUID())

  const uploaded = await supabase.storage
    .from(PARTY_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploaded.error)
    throw new PartyDocumentError(partyDocumentErrorKey(uploaded.error))

  const facts = {
    storage_path: path,
    file_name: storedFileName(file.name),
    mime_type: file.type,
    size_bytes: file.size,
  }
  const result = replacing
    ? await supabase
        .from('party_documents')
        .update(facts)
        .eq('id', replacing.id)
        .select(PARTY_DOCUMENT_SELECT)
    : await supabase
        .from('party_documents')
        .insert({
          ...facts,
          [partyColumn(kind)]: partyId,
          doc_type: type,
          title: type === 'other' ? (title ?? '').trim() : null,
        })
        .select(PARTY_DOCUMENT_SELECT)

  const saved = (result.data as PartyDocument[] | null)?.[0]
  if (result.error || !saved) {
    await removeObject(path)
    throw new PartyDocumentError(
      result.error ? partyDocumentErrorKey(result.error) : 'partyDocNotAllowed',
    )
  }
  // The replaced file is no longer stored by any row: remove it.
  if (replacing) await removeObject(replacing.storage_path)
  return saved
}

/** Deletes the row, then its file (allowed once no row stores the path). */
export async function deletePartyDocument(document: PartyDocument): Promise<void> {
  const { data, error } = await supabase
    .from('party_documents')
    .delete()
    .eq('id', document.id)
    .select('id')
  if (error) throw new PartyDocumentError(partyDocumentErrorKey(error))
  if (!data || data.length === 0) throw new PartyDocumentError('partyDocNotAllowed')
  await removeObject(document.storage_path)
}

/** A link to the file for five minutes (the bucket has no public URL). */
export async function partyDocumentUrl(document: PartyDocument): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PARTY_DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, 300)
  if (error || !data?.signedUrl) throw new PartyDocumentError('partyDocOpenFailed')
  return data.signedUrl
}
