import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, FileText, Plus, Trash2, X } from 'lucide-react'
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  Lightbox,
  Notice,
  SectionHeader,
  Select,
  Skeleton,
  cn,
  useConfirm,
  useToast,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  contractFileError,
  defaultFileKind,
  INSTALLMENT_FILE_ACCEPT,
  INSTALLMENT_FILE_KINDS,
  INSTALLMENT_FILE_KIND_LABEL_KEYS,
  INSTALLMENT_FILE_TITLE_MAX,
  type DraftInstallmentFile,
  type InstallmentFile,
  type InstallmentFileKind,
} from '@/lib/installmentFiles'
import {
  InstallmentFileError,
  installmentFileUrl,
  removeInstallmentFile,
  uploadInstallmentFile,
} from '@/lib/installmentFilesData'
import { fetchContractFiles } from '@/lib/installmentsData'
import { formatDocumentSize } from '@/lib/partyDocuments'
import { OptionalLabel } from './cells'
import { useLoad } from './useLoad'

/**
 * «ملفات العقد» (migration 0209, owner 2026-11-22 «ارفاق ملف العقد»; the
 * Figma frames «الدفعات والضريبة»): the live section of the contract and
 * edit pages — several files, each saved the moment it is uploaded — and
 * the picked files of the new-contract page, uploaded after its save. A
 * cancelled contract's files are view only.
 */

const KIND_TONE: Record<InstallmentFileKind, string> = {
  contract: 'bg-info-soft text-info',
  annex: 'bg-warning-soft text-warning',
  schedule: 'bg-success-soft text-success',
  other: 'bg-surface-hover text-muted',
}

const errorKeyOf = (error: unknown): TranslationKey =>
  error instanceof InstallmentFileError ? error.key : 'instFileSaveFailed'

const kindOptions = (t: (key: TranslationKey) => string) =>
  INSTALLMENT_FILE_KINDS.map((kind) => ({
    value: kind,
    label: t(INSTALLMENT_FILE_KIND_LABEL_KEYS[kind]),
  }))

/** One file: its kind's tile, the name, the file and size, the actions. */
function FileTile({
  kind,
  title,
  fileName,
  size,
  compact = false,
  children,
}: {
  kind: InstallmentFileKind
  title: ReactNode
  fileName: string
  size: number
  /** The contract page's smaller tile (owner 2026-11-23). */
  compact?: boolean
  children?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <li
      className={cn(
        'flex min-w-0 items-center rounded-lg border bg-bg',
        compact ? 'gap-2 p-1.5' : 'gap-2.5 p-2',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg',
          compact ? 'size-7' : 'size-8',
          KIND_TONE[kind],
        )}
      >
        <FileText size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate font-semibold',
            compact ? 'text-[13px]' : 'text-sm',
          )}
        >
          {title}
        </div>
        <p
          className={cn(
            'flex min-w-0 items-center gap-1 text-muted',
            compact ? 'text-[11px]' : 'text-xs',
          )}
        >
          <bdi className="truncate">{fileName}</bdi>
          {size > 0 && (
            <span className="shrink-0">· {formatDocumentSize(size, t)}</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </li>
  )
}

function DropZone({
  label,
  disabled,
  multiple = false,
  invalid,
  onPick,
}: {
  label: TranslationKey
  disabled?: boolean
  multiple?: boolean
  invalid?: boolean
  onPick: (files: File[]) => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={INSTALLMENT_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          if (files.length) onPick(files)
          event.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          if (disabled) return
          const files = [...event.dataTransfer.files]
          if (files.length) onPick(multiple ? files : files.slice(0, 1))
        }}
        className={cn(
          'flex w-full flex-col items-center gap-0.5 rounded-xl border border-dashed px-3 py-4 text-center transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60',
          invalid && 'border-danger',
        )}
      >
        <Plus size={18} aria-hidden="true" className="text-muted" />
        <span className="text-sm font-medium">{t(label)}</span>
        <span className="text-xs text-muted">{t('instFileLimits')}</span>
      </button>
    </>
  )
}

/** The files picked on the new-contract page; nothing touches Storage. */
export function DraftContractFiles({
  files,
  onChange,
  disabled,
}: {
  files: readonly DraftInstallmentFile[]
  onChange: (files: DraftInstallmentFile[]) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [error, setError] = useState<TranslationKey | null>(null)

  const pick = (picked: File[]) => {
    let next = [...files]
    let refused: TranslationKey | null = null
    for (const file of picked) {
      const invalid = contractFileError(file)
      if (invalid) {
        refused = invalid
        continue
      }
      next = [
        ...next,
        { key: crypto.randomUUID(), file, kind: defaultFileKind(next) },
      ]
    }
    setError(refused)
    onChange(next)
  }

  const view = (file: File) => {
    const url = URL.createObjectURL(file)
    window.open(url, '_blank', 'noopener')
    // The new tab reads it as it opens.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((item) => (
            <FileTile
              key={item.key}
              kind={item.kind}
              fileName={item.file.name}
              size={item.file.size}
              title={
                <Select
                  size="sm"
                  aria-label={t('instFileKindLabel')}
                  className="mb-1 w-auto max-w-full"
                  disabled={disabled}
                  value={item.kind}
                  options={kindOptions(t)}
                  onValueChange={(kind) =>
                    onChange(
                      files.map((other) =>
                        other.key === item.key
                          ? { ...other, kind: kind as InstallmentFileKind }
                          : other,
                      ),
                    )
                  }
                />
              }
            >
              <IconButton
                size="sm"
                variant="ghost"
                label={t('instReceiptView')}
                icon={<Eye size={14} />}
                onClick={() => view(item.file)}
              />
              <IconButton
                size="sm"
                variant="ghost"
                label={t('instReceiptClear')}
                icon={<X size={14} />}
                disabled={disabled}
                onClick={() =>
                  onChange(files.filter((other) => other.key !== item.key))
                }
              />
            </FileTile>
          ))}
        </ul>
      )}
      <DropZone
        multiple
        label="instFileDropAdd"
        disabled={disabled}
        invalid={!!error}
        onPick={pick}
      />
      {error && (
        <p className="text-xs text-danger" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  )
}

/** The live section. */
export function ContractFilesCard({
  contractId,
  files,
  canManage,
  onChanged,
  description,
  className,
}: {
  contractId: string
  files: readonly InstallmentFile[]
  /** installments.manage and a contract that is not cancelled. */
  canManage: boolean
  onChanged: () => void
  description?: ReactNode
  className?: string
}) {
  const { t } = useI18n()
  const toast = useToast()
  const { confirm, confirmDialog } = useConfirm()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  )

  const nameOf = (file: InstallmentFile) =>
    file.title || t(INSTALLMENT_FILE_KIND_LABEL_KEYS[file.kind])

  const view = async (file: InstallmentFile) => {
    setError(null)
    const image = file.mime_type.startsWith('image/')
    // A PDF's tab is opened by the click itself, so no blocker stops it.
    const tab = image ? null : window.open('', '_blank')
    setBusy(file.id)
    try {
      const url = await installmentFileUrl(file)
      if (image) setPreview({ src: url, alt: file.file_name })
      else if (tab) {
        tab.opener = null
        tab.location.href = url
      } else window.open(url, '_blank', 'noopener')
    } catch {
      tab?.close()
      setError('instFileOpenFailed')
    }
    setBusy(null)
  }

  const remove = async (file: InstallmentFile) => {
    const ok = await confirm({
      title: t('instFileDeleteTitle'),
      description: t('instFileDeleteQuestion').replace(
        '{name}',
        () => nameOf(file),
      ),
      confirmLabel: t('instReceiptDelete'),
      tone: 'danger',
    })
    if (!ok) return
    setError(null)
    setBusy(file.id)
    try {
      await removeInstallmentFile(file.id)
      toast({ title: t('instToastFileDeleted'), tone: 'success' })
      onChanged()
    } catch (failure) {
      const key = errorKeyOf(failure)
      setError(key)
      if (key === 'instErrContractFileNotFound') onChanged()
    }
    setBusy(null)
  }

  return (
    <Card className={cn('space-y-2 p-3', className)}>
      <SectionHeader
        title={t('instFilesTitle')}
        description={description}
        action={
          canManage ? (
            <Button
              size="sm"
              variant="outline"
              icon={<Plus size={14} aria-hidden="true" />}
              onClick={() => setAdding(true)}
            >
              {t('instFileAdd')}
            </Button>
          ) : undefined
        }
      />
      {files.length === 0 ? (
        <p className="text-xs text-muted">{t('instFilesEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((file) => (
            <FileTile
              key={file.id}
              kind={file.kind}
              title={nameOf(file)}
              fileName={file.file_name}
              size={file.size_bytes}
              compact
            >
              <IconButton
                size="sm"
                variant="ghost"
                label={t('instReceiptView')}
                icon={<Eye size={14} />}
                disabled={busy !== null}
                onClick={() => void view(file)}
              />
              {canManage && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={t('instReceiptDelete')}
                  icon={<Trash2 size={14} className="text-danger" />}
                  disabled={busy !== null}
                  onClick={() => void remove(file)}
                />
              )}
            </FileTile>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {t(error)}
        </p>
      )}
      {canManage && (
        <AddFileDialog
          open={adding}
          onOpenChange={setAdding}
          contractId={contractId}
          firstKind={defaultFileKind(files)}
          onUploaded={() => {
            setAdding(false)
            toast({ title: t('instToastFileAdded'), tone: 'success' })
            onChanged()
          }}
        />
      )}
      <Lightbox
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        items={
          preview ? [{ id: 'file', src: preview.src, alt: preview.alt }] : []
        }
        index={0}
        onIndexChange={() => {}}
      />
      {confirmDialog}
    </Card>
  )
}

/** The edit page's files: read apart, so an upload never resets the form. */
export function EditContractFiles({ contractId }: { contractId: string }) {
  const { t } = useI18n()
  const [version, setVersion] = useState(0)
  const loader = useCallback(
    (signal: AbortSignal) => fetchContractFiles(contractId, signal),
    [contractId],
  )
  const load = useLoad(loader, version)
  if (load.status === 'failed')
    return (
      <ErrorState
        description={t('instContractLoadError')}
        onRetry={load.reload}
      />
    )
  if (!load.data) return <Skeleton className="h-28 w-full" />
  return (
    <ContractFilesCard
      contractId={contractId}
      files={load.data}
      canManage
      description={t('instFilesLiveHint')}
      onChanged={() => setVersion((current) => current + 1)}
    />
  )
}

function AddFileDialog({
  open,
  onOpenChange,
  contractId,
  firstKind,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractId: string
  firstKind: InstallmentFileKind
  onUploaded: () => void
}) {
  const { t } = useI18n()
  const [kind, setKind] = useState<InstallmentFileKind>(firstKind)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind(firstKind)
    setTitle('')
    setFile(null)
    setError(null)
    setSaving(false)
    // Only the opening resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    if (saving) return
    const invalid = file ? contractFileError(file) : 'instFileRequired'
    setError(invalid)
    if (invalid || !file) return
    setSaving(true)
    try {
      await uploadInstallmentFile(contractId, file, kind, title)
      setSaving(false)
      onUploaded()
    } catch (failure) {
      setSaving(false)
      setError(errorKeyOf(failure))
    }
  }

  return (
    <Dialog
      open={open}
      size="sm"
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={t('instFileAddTitle')}
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('instDialogCancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            {t('instFileUpload')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('instFileKindLabel')}
          required
          hint={t('instFileKindHint')}
        >
          {(control) => (
            <Select
              {...control}
              value={kind}
              options={kindOptions(t)}
              onValueChange={(value) => setKind(value as InstallmentFileKind)}
            />
          )}
        </Field>
        <Field label={<OptionalLabel text={t('instFileName')} />}>
          {(control) => (
            <Input
              {...control}
              maxLength={INSTALLMENT_FILE_TITLE_MAX}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>
        <DropZone
          label="instFileDropPick"
          disabled={saving}
          invalid={!!error}
          onPick={([picked]) => {
            setFile(picked)
            setError(contractFileError(picked))
          }}
        />
        {file && (
          <ul>
            <FileTile
              kind={kind}
              title={title.trim() || t(INSTALLMENT_FILE_KIND_LABEL_KEYS[kind])}
              fileName={file.name}
              size={file.size}
            >
              <IconButton
                size="sm"
                variant="ghost"
                label={t('instReceiptClear')}
                icon={<X size={14} />}
                disabled={saving}
                onClick={() => {
                  setFile(null)
                  setError(null)
                }}
              />
            </FileTile>
          </ul>
        )}
        {error && (
          <Notice tone="danger" size="compact">
            {t(error)}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}
