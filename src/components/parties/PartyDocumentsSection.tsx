import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Files,
  FolderOpen,
  ImageIcon,
  Info,
  Landmark,
  MapPin,
  Plus,
  ReceiptText,
  RefreshCw,
  ScrollText,
  Trash2,
  UploadCloud,
  type LucideIcon,
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
  draftDocumentRow,
  formatDocumentSize,
  groupPartyDocuments,
  isImageDocument,
  partyDocumentFileError,
  withDraftDocument,
  type DraftPartyDocument,
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
  /** The saved record; omitted in the add form, which passes `draft`. */
  partyId?: string
  /**
   * The add form (owner 2026-11-08, «المورد ينحفظ, وبعده ترتفع الملفات
   * مباشرة»): files are only PICKED here and kept in the browser; the form
   * uploads them right after the record is saved.
   */
  draft?: {
    items: readonly DraftPartyDocument[]
    onChange: (items: DraftPartyDocument[]) => void
  }
  /** `lessors.edit` / `companies_projects.edit`: upload, replace, delete. */
  canEdit: boolean
  /** A line above the tiles (the «تم الحفظ، ارفع المستندات» of a new one). */
  notice?: ReactNode
  /**
   * A quiet line under the header, no scroll (the edit form's «تحفظ
   * مباشرة عند الرفع»: the files never wait for the form's save).
   */
  hint?: ReactNode
  /** A warning line (the files a new record could not upload). */
  warning?: ReactNode
}

type UploadTarget = { type: PartyDocumentType; replacing?: PartyDocument }

/**
 * Each type's icon (owner «شعارات لكل نوع مستند») and its light colour, one
 * of the chart shades defined for both themes in src/index.css (owner «واضف
 * الوان وحياة», approved on /ui-kit the same day): blue register, amber tax,
 * green IBAN, violet national address, teal other.
 */
export const PARTY_DOCUMENT_STYLE: Readonly<
  Record<PartyDocumentType, { icon: LucideIcon; tone: number }>
> = {
  commercial_register: { icon: ScrollText, tone: 3 },
  tax_certificate: { icon: ReceiptText, tone: 2 },
  iban_certificate: { icon: Landmark, tone: 1 },
  national_address: { icon: MapPin, tone: 5 },
  other: { icon: Files, tone: 6 },
}

const toneStyle = (tone: number): CSSProperties => ({
  backgroundColor: `var(--chart-${tone})`,
  color: `var(--chart-stroke-${tone})`,
})

const errorKeyOf = (error: unknown): TranslationKey =>
  error instanceof PartyDocumentError ? error.key : 'partyDocSaveFailed'

/**
 * «المستندات» of a supplier or a client (owner 2026-11-07, migration 0182,
 * approved on /ui-kit «مستندات الموردين والشركات»): a progress bar of the
 * fixed types, one tile per fixed type and the named «مستندات اخرى». A file
 * is saved the moment it is uploaded (owner: «الاولى»), independent of the
 * record's form; replacing keeps the old file until the new one is stored;
 * deleting asks first. Images open in the Lightbox (never cropped), a PDF in
 * a new tab through a five-minute link.
 */
export function PartyDocumentsSection({
  kind,
  partyId,
  draft,
  canEdit,
  notice,
  hint,
  warning,
}: PartyDocumentsSectionProps) {
  const { t } = useI18n()
  const [documents, setDocuments] = useState<PartyDocument[]>([])
  const [loading, setLoading] = useState(!draft)
  const [loadError, setLoadError] = useState<TranslationKey | null>(null)
  const [actionError, setActionError] = useState<TranslationKey | null>(null)
  const [target, setTarget] = useState<UploadTarget | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  const sectionRef = useRef<HTMLElement>(null)
  // A picked file opens from the browser itself, through an object URL.
  const objectUrlRef = useRef<string | null>(null)
  const releaseObjectUrl = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
  }
  useEffect(() => releaseObjectUrl, [])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      // The add form has nothing stored yet.
      if (!partyId) return
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
    if (notice || warning) sectionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [notice, warning])

  const view = async (document: PartyDocument) => {
    setActionError(null)
    const picked = draft?.items.find((item) => item.id === document.id)
    if (picked) {
      releaseObjectUrl()
      const url = URL.createObjectURL(picked.file as File)
      objectUrlRef.current = url
      if (isImageDocument(document)) setPreview({ src: url, alt: document.file_name })
      else window.open(url, '_blank', 'noopener')
      return
    }
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
    // A picked file is only dropped from the form: nothing is stored yet.
    if (draft) {
      draft.onChange(draft.items.filter((item) => item.id !== document.id))
      return
    }
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

  const picked = (
    type: PartyDocumentType,
    file: File,
    title: string | undefined,
    replacing?: PartyDocument,
  ) => {
    if (!draft) return
    draft.onChange(
      withDraftDocument(
        draft.items,
        { id: crypto.randomUUID(), type, file, title, created_at: new Date().toISOString() },
        replacing?.id,
      ),
    )
    setTarget(null)
  }

  const shown = draft ? draft.items.map(draftDocumentRow) : documents
  const { fixed, others } = groupPartyDocuments(kind, shown)
  const total = PARTY_DOCUMENT_TYPES[kind].length
  const filled = fixed.filter((slot) => slot.document).length
  const percent = Math.round((filled / total) * 100)
  // The completeness ring's colours (owner 2026-11-05).
  const barColor =
    percent >= 100
      ? 'var(--progress-high)'
      : percent >= 50
        ? 'var(--progress-mid)'
        : 'var(--progress-low)'
  const ready = !loading && !loadError

  return (
    <section ref={sectionRef} className="rounded-xl border bg-[var(--surface)] p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-bg text-muted"
        >
          <FileText size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t('partyDocumentsSection')}</h3>
          {ready && (
            <p className="text-xs text-muted">
              {filled === total
                ? t('partyDocAllUploaded')
                : t('partyDocRemaining').replace('{count}', String(total - filled))}
            </p>
          )}
        </div>
        {ready && (
          <div className="flex w-36 items-center gap-2">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-bg"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={filled}
              aria-label={t('partyDocProgressLabel')}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${percent}%`, backgroundColor: barColor }}
              />
            </div>
            <span className="text-xs font-medium">
              <bdi dir="ltr">
                {filled}/{total}
              </bdi>
            </span>
          </div>
        )}
      </div>
      {hint && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--info-soft)] px-3 py-2 text-sm text-[var(--info)]">
          <Info size={16} aria-hidden="true" className="shrink-0" />
          {hint}
        </p>
      )}
      {warning && (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]"
        >
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          {warning}
        </p>
      )}
      {notice && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
          <CheckCircle2 size={16} aria-hidden="true" />
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
            <div key={type} className="h-28 animate-pulse rounded-xl border bg-bg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {fixed.map(({ type, document }) => (
              <DocumentTile
                key={type}
                type={type}
                title={t(PARTY_DOCUMENT_LABEL_KEYS[type])}
                document={document}
                pending={!!draft}
                canEdit={canEdit}
                busy={document ? busyId === document.id : false}
                onUpload={() => setTarget({ type, replacing: document })}
                onView={document ? () => void view(document) : undefined}
                onRemove={document ? () => void remove(document) : undefined}
              />
            ))}
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span
                  aria-hidden="true"
                  style={toneStyle(PARTY_DOCUMENT_STYLE.other.tone)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                >
                  <FolderOpen size={15} />
                </span>
                {t('partyDocOther')}
                {others.length > 0 && (
                  <span className="rounded-full bg-bg px-2 text-xs text-muted">
                    {others.length}
                  </span>
                )}
              </span>
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
              <p className="rounded-xl border border-dashed bg-bg p-4 text-center text-xs text-placeholder">
                {t('partyDocNoOthers')}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {others.map((document) => (
                  <DocumentTile
                    key={document.id}
                    type="other"
                    title={document.title ?? t('partyDocOtherOne')}
                    document={document}
                    pending={!!draft}
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
          onPick={draft ? picked : undefined}
        />
      )}
      <Lightbox
        open={preview !== null}
        onOpenChange={(open) => {
          if (open) return
          setPreview(null)
          releaseObjectUrl()
        }}
        items={preview ? [{ id: 'document', src: preview.src, alt: preview.alt }] : []}
        index={0}
        onIndexChange={() => {}}
      />
      {confirmDialog}
    </section>
  )
}

/** The type's icon on its own light colour. */
function TypeIcon({ type, size = 'md' }: { type: PartyDocumentType; size?: 'sm' | 'md' }) {
  const { icon: Icon, tone } = PARTY_DOCUMENT_STYLE[type]
  return (
    <span
      aria-hidden="true"
      style={toneStyle(tone)}
      className={
        size === 'md'
          ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl'
          : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg'
      }
    >
      <Icon size={size === 'md' ? 20 : 15} />
    </span>
  )
}

/** The file's kind in the type's colour: a PDF sheet or an image. */
function FileThumb({ document, type }: { document: PartyDocument; type: PartyDocumentType }) {
  const tone = PARTY_DOCUMENT_STYLE[type].tone
  const image = isImageDocument(document)
  return (
    <div
      aria-hidden="true"
      className="relative flex h-16 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-bg"
    >
      {image ? (
        <ImageIcon size={20} className="text-muted" />
      ) : (
        <FileText size={20} style={{ color: `var(--chart-stroke-${tone})` }} />
      )}
      <span
        style={toneStyle(tone)}
        className="absolute inset-x-0 bottom-0 py-px text-center text-[9px] font-semibold"
      >
        {image ? 'IMG' : 'PDF'}
      </span>
    </div>
  )
}

const TILE =
  'group rounded-xl border bg-bg p-3 transition duration-200 hover:shadow-md motion-safe:hover:-translate-y-0.5'

function DocumentTile({
  type,
  title,
  document,
  pending = false,
  canEdit,
  busy,
  onUpload,
  onView,
  onRemove,
}: {
  type: PartyDocumentType
  title: string
  document?: PartyDocument
  /** A file picked in the add form, uploaded after the save. */
  pending?: boolean
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
      <div className={`${TILE} flex min-h-28 flex-col justify-between gap-3 border-dashed`}>
        <div className="flex items-center gap-3">
          <span className="opacity-60 transition-opacity group-hover:opacity-100">
            <TypeIcon type={type} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="text-xs text-placeholder">{t('partyDocNotUploaded')}</p>
          </div>
        </div>
        {canEdit && onUpload && (
          <Button
            size="sm"
            icon={<UploadCloud size={14} aria-hidden="true" />}
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
    <div className={`${TILE} flex min-h-28 flex-col gap-3`}>
      <div className="flex items-start gap-3">
        <TypeIcon type={type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          {pending ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--info)]">
              <Clock size={13} aria-hidden="true" />
              {t('partyDocPending')}
            </p>
          ) : (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--success)]">
              <CheckCircle2 size={13} aria-hidden="true" />
              {t('partyDocUploaded')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
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
      <div className="flex items-center gap-3 rounded-lg bg-[var(--surface)] p-2">
        <FileThumb document={document} type={type} />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium" title={document.file_name}>
            <bdi dir="ltr">{document.file_name}</bdi>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDocumentSize(document.size_bytes, t)} ·{' '}
            {image ? t('partyDocImage') : <bdi dir="ltr">PDF</bdi>}
          </p>
        </div>
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
  onPick,
}: {
  kind: PartyKind
  partyId?: string
  target: UploadTarget
  onClose: () => void
  onSaved: (document: PartyDocument, replaced?: PartyDocument) => void
  /** The add form: the file is only picked, uploaded after the save. */
  onPick?: (
    type: PartyDocumentType,
    file: File,
    title: string | undefined,
    replacing?: PartyDocument,
  ) => void
}) {
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [fileError, setFileError] = useState<TranslationKey | null>(null)
  const [titleError, setTitleError] = useState<TranslationKey | null>(null)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const other = target.type === 'other'
  const tone = PARTY_DOCUMENT_STYLE[target.type].tone
  const label = other ? t('partyDocOtherOne') : t(PARTY_DOCUMENT_LABEL_KEYS[target.type])

  const pick = (picked: File | undefined) => {
    setError(null)
    if (!picked) return
    const problem = partyDocumentFileError(picked)
    setFileError(problem)
    setFile(problem ? null : picked)
  }

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!saving) pick(event.dataTransfer.files?.[0])
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
    if (onPick) {
      onPick(target.type, file, other ? trimmed : undefined, target.replacing)
      return
    }
    if (!partyId) return
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

  const lit = dragging || file !== null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={
        <span className="flex items-center gap-2">
          <TypeIcon type={target.type} size="sm" />
          {`${target.replacing ? t('partyDocReplace') : t('partyDocUpload')} · ${label}`}
        </span>
      }
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {onPick ? t('partyDocPickConfirm') : t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {target.replacing && (
          <p className="text-xs text-muted">{t('partyDocReplaceHint')}</p>
        )}
        <label
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          style={
            lit && !fileError
              ? {
                  backgroundColor: `var(--chart-${tone})`,
                  borderColor: `var(--chart-stroke-${tone})`,
                }
              : undefined
          }
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-[var(--surface)] px-4 py-7 text-center transition-colors duration-200 ${
            fileError ? 'border-[var(--danger)]' : ''
          }`}
        >
          {file ? (
            <CheckCircle2
              size={26}
              style={{ color: `var(--chart-stroke-${tone})` }}
              aria-hidden="true"
            />
          ) : (
            <UploadCloud
              size={26}
              aria-hidden="true"
              className={`text-muted transition-transform duration-200 ${
                dragging ? 'motion-safe:-translate-y-1' : ''
              }`}
            />
          )}
          <span className="text-sm font-medium">
            {file ? (
              <bdi dir="ltr">{file.name}</bdi>
            ) : dragging ? (
              t('partyDocDrop')
            ) : (
              t('partyDocPick')
            )}
          </span>
          <span className="text-xs text-muted">
            {file
              ? t('partyDocPickedHint').replace('{size}', formatDocumentSize(file.size, t))
              : `${t('partyDocLimits')} · ${t('partyDocPhoneHint')}`}
          </span>
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
