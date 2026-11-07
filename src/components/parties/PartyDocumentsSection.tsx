import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Eye,
  FileText,
  ImageIcon,
  Paperclip,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  Lightbox,
  useConfirm,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  PARTY_DOCUMENT_ACCEPT,
  PARTY_DOCUMENT_LABEL_KEYS,
  PARTY_DOCUMENT_TITLE_MAX,
  PARTY_DOCUMENT_TYPES,
  formatDocumentSize,
  groupPartyDocuments,
  isImageDocument,
  partyDocumentFileError,
  type PartyDocument,
  type PartyDocumentType,
  type PartyKind,
} from '@/lib/partyDocuments'
import {
  PartyDocumentError,
  deletePartyDocument,
  fetchPartyDocuments,
  partyDocumentUrl,
  uploadPartyDocument,
} from '@/lib/partyDocumentsData'

export interface PartyDocumentsSectionProps {
  kind: PartyKind
  partyId: string
  /** `lessors.edit` / `companies_projects.edit`: upload, replace, delete. */
  canEdit: boolean
  /** A line above the tiles (the «تم الحفظ، ارفع المستندات» of a new one). */
  notice?: ReactNode
}

type UploadTarget = { type: PartyDocumentType; replacing?: PartyDocument }

const errorKeyOf = (error: unknown): TranslationKey =>
  error instanceof PartyDocumentError ? error.key : 'partyDocSaveFailed'

/**
 * «المستندات» of a supplier or a client (owner 2026-11-07, migration 0182,
 * approved on /ui-kit «مستندات الموردين والشركات»): one tile per fixed type
 * and the named «مستندات اخرى». A file is saved the moment it is uploaded
 * (owner: «الاولى»), independent of the record's form; replacing keeps the
 * old file until the new one is stored; deleting asks first. Images open in
 * the Lightbox (never cropped), a PDF in a new tab through a five-minute
 * link.
 */
export function PartyDocumentsSection({
  kind,
  partyId,
  canEdit,
  notice,
}: PartyDocumentsSectionProps) {
  const { t } = useI18n()
  const [documents, setDocuments] = useState<PartyDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<TranslationKey | null>(null)
  const [actionError, setActionError] = useState<TranslationKey | null>(null)
  const [target, setTarget] = useState<UploadTarget | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  const sectionRef = useRef<HTMLElement>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setLoadError(null)
      try {
        const rows = await fetchPartyDocuments(kind, partyId, signal)
        if (signal?.aborted) return
        setDocuments(rows)
      } catch (error) {
        if (signal?.aborted) return
        setLoadError(errorKeyOf(error))
      }
      setLoading(false)
    },
    [kind, partyId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // A new record opens here: bring the documents into view.
  useEffect(() => {
    if (notice) sectionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [notice])

  const view = async (document: PartyDocument) => {
    setActionError(null)
    // A PDF opens in a tab opened by the click itself, so no pop-up blocker
    // stops it; the link arrives a moment later.
    const tab = isImageDocument(document) ? null : window.open('', '_blank')
    setBusyId(document.id)
    try {
      const url = await partyDocumentUrl(document)
      if (isImageDocument(document)) setPreview({ src: url, alt: document.file_name })
      else if (tab) {
        tab.opener = null
        tab.location.href = url
      } else window.open(url, '_blank', 'noopener')
    } catch (error) {
      tab?.close()
      setActionError(errorKeyOf(error))
    }
    setBusyId(null)
  }

  const remove = async (document: PartyDocument) => {
    setActionError(null)
    const ok = await confirm({
      title: t('partyDocDeleteTitle'),
      description: t('partyDocDeleteQuestion'),
      confirmLabel: t('delete'),
      tone: 'danger',
    })
    if (!ok) return
    setBusyId(document.id)
    try {
      await deletePartyDocument(document)
      setDocuments((rows) => rows.filter((row) => row.id !== document.id))
    } catch (error) {
      setActionError(errorKeyOf(error))
    }
    setBusyId(null)
  }

  const saved = (document: PartyDocument, replaced?: PartyDocument) => {
    setDocuments((rows) => [
      ...rows.filter((row) => row.id !== (replaced?.id ?? document.id)),
      document,
    ])
    setTarget(null)
  }

  const { fixed, others } = groupPartyDocuments(kind, documents)
  const filled = fixed.filter((slot) => slot.document).length

  return (
    <section ref={sectionRef} className="rounded-xl border bg-[var(--surface)] p-4">
      <h3 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
        <FileText size={16} className="text-muted" aria-hidden="true" />
        {t('partyDocumentsSection')}
        {!loading && !loadError && (
          <span className="text-xs font-normal text-muted">
            {t('partyDocCount')
              .replace('{filled}', String(filled))
              .replace('{total}', String(PARTY_DOCUMENT_TYPES[kind].length))}
          </span>
        )}
      </h3>
      {notice && (
        <p className="mb-3 rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-3 text-sm text-[var(--danger)]">
          {t(actionError)}
        </p>
      )}

      {loadError ? (
        <ErrorState description={t(loadError)} onRetry={() => void load()} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          {PARTY_DOCUMENT_TYPES[kind].map((type) => (
            <div key={type} className="h-24 animate-pulse rounded-lg border bg-bg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {fixed.map(({ type, document }) => (
              <DocumentTile
                key={type}
                title={t(PARTY_DOCUMENT_LABEL_KEYS[type])}
                document={document}
                canEdit={canEdit}
                busy={document ? busyId === document.id : false}
                onUpload={() => setTarget({ type, replacing: document })}
                onView={document ? () => void view(document) : undefined}
                onRemove={document ? () => void remove(document) : undefined}
              />
            ))}
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{t('partyDocOther')}</span>
              {canEdit && (
                <Button
                  size="sm"
                  icon={<Plus size={14} aria-hidden="true" />}
                  onClick={() => setTarget({ type: 'other' })}
                >
                  {t('partyDocAddOther')}
                </Button>
              )}
            </div>
            {others.length === 0 ? (
              <p className="text-xs text-placeholder">{t('partyDocNoOthers')}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {others.map((document) => (
                  <DocumentTile
                    key={document.id}
                    title={document.title ?? t('partyDocOtherOne')}
                    document={document}
                    canEdit={canEdit}
                    busy={busyId === document.id}
                    onView={() => void view(document)}
                    onRemove={() => void remove(document)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {target && (
        <UploadDialog
          kind={kind}
          partyId={partyId}
          target={target}
          onClose={() => setTarget(null)}
          onSaved={saved}
        />
      )}
      <Lightbox
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        items={preview ? [{ id: 'document', src: preview.src, alt: preview.alt }] : []}
        index={0}
        onIndexChange={() => {}}
      />
      {confirmDialog}
    </section>
  )
}

function DocumentTile({
  title,
  document,
  canEdit,
  busy,
  onUpload,
  onView,
  onRemove,
}: {
  title: string
  document?: PartyDocument
  canEdit: boolean
  busy: boolean
  /** A fixed type only: upload, or replace the current file. */
  onUpload?: () => void
  onView?: () => void
  onRemove?: () => void
}) {
  const { t } = useI18n()
  if (!document)
    return (
      <div className="flex min-h-24 flex-col justify-between gap-2 rounded-lg border border-dashed bg-bg p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-placeholder">{t('partyDocNotUploaded')}</span>
        </div>
        {canEdit && onUpload && (
          <Button
            size="sm"
            icon={<Upload size={14} aria-hidden="true" />}
            onClick={onUpload}
            className="self-start"
          >
            {t('partyDocUpload')}
          </Button>
        )}
      </div>
    )

  const image = isImageDocument(document)
  return (
    <div className="flex min-h-24 gap-3 rounded-lg border bg-bg p-3">
      <div
        aria-hidden="true"
        className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border bg-[var(--surface)] text-muted"
      >
        {image ? (
          <ImageIcon size={22} />
        ) : (
          <span className="flex flex-col items-center gap-1">
            <FileText size={22} />
            <span className="text-[10px] font-semibold">PDF</span>
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <span className="text-sm font-medium">{title}</span>
        <p className="truncate text-xs" title={document.file_name}>
          <bdi dir="ltr">{document.file_name}</bdi>
        </p>
        <p className="text-xs text-muted">
          {formatDocumentSize(document.size_bytes, t)} ·{' '}
          {image ? t('partyDocImage') : <bdi dir="ltr">PDF</bdi>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <IconButton
          size="sm"
          label={t('partyDocView')}
          title={t('partyDocView')}
          icon={<Eye size={15} />}
          onClick={onView}
          disabled={busy}
        />
        {canEdit && onUpload && (
          <IconButton
            size="sm"
            label={t('partyDocReplace')}
            title={t('partyDocReplace')}
            icon={<RefreshCw size={15} />}
            onClick={onUpload}
            disabled={busy}
          />
        )}
        {canEdit && onRemove && (
          <IconButton
            size="sm"
            label={t('delete')}
            title={t('delete')}
            icon={<Trash2 size={15} />}
            onClick={onRemove}
            disabled={busy}
          />
        )}
      </div>
    </div>
  )
}

function UploadDialog({
  kind,
  partyId,
  target,
  onClose,
  onSaved,
}: {
  kind: PartyKind
  partyId: string
  target: UploadTarget
  onClose: () => void
  onSaved: (document: PartyDocument, replaced?: PartyDocument) => void
}) {
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [fileError, setFileError] = useState<TranslationKey | null>(null)
  const [titleError, setTitleError] = useState<TranslationKey | null>(null)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const other = target.type === 'other'
  const label = other ? t('partyDocOtherOne') : t(PARTY_DOCUMENT_LABEL_KEYS[target.type])

  const pick = (picked: File | undefined) => {
    setError(null)
    if (!picked) return
    const problem = partyDocumentFileError(picked)
    setFileError(problem)
    setFile(problem ? null : picked)
  }

  const save = async () => {
    setError(null)
    const missingFile = file ? null : 'partyDocFileRequired'
    const trimmed = title.trim()
    const badTitle = !other
      ? null
      : !trimmed
        ? 'partyDocTitleRequired'
        : trimmed.length > PARTY_DOCUMENT_TITLE_MAX
          ? 'partyDocTitleTooLong'
          : null
    setFileError(missingFile)
    setTitleError(badTitle)
    if (!file || missingFile || badTitle) return
    setSaving(true)
    try {
      const document = await uploadPartyDocument({
        kind,
        partyId,
        type: target.type,
        file,
        title: other ? trimmed : undefined,
        replacing: target.replacing,
      })
      onSaved(document, target.replacing)
    } catch (caught) {
      setError(errorKeyOf(caught))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={`${target.replacing ? t('partyDocReplace') : t('partyDocUpload')} · ${label}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {target.replacing && (
          <p className="text-xs text-muted">{t('partyDocReplaceHint')}</p>
        )}
        <label
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed bg-bg px-4 py-6 text-center ${
            fileError ? 'border-[var(--danger)]' : ''
          }`}
        >
          <Paperclip size={20} className="text-muted" aria-hidden="true" />
          <span className="text-sm">
            {file ? <bdi dir="ltr">{file.name}</bdi> : t('partyDocPick')}
          </span>
          <span className="text-xs text-muted">{t('partyDocLimits')}</span>
          <input
            type="file"
            accept={PARTY_DOCUMENT_ACCEPT}
            className="sr-only"
            disabled={saving}
            onChange={(event) => pick(event.target.files?.[0])}
          />
        </label>
        {fileError && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {t(fileError)}
          </p>
        )}
        {other && (
          <Field
            label={t('partyDocTitle')}
            required
            error={titleError ? t(titleError) : undefined}
          >
            {(control) => (
              <Input
                {...control}
                value={title}
                maxLength={PARTY_DOCUMENT_TITLE_MAX}
                placeholder={t('partyDocTitlePlaceholder')}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {t(error)}
          </p>
        )}
      </div>
    </Dialog>
  )
}
