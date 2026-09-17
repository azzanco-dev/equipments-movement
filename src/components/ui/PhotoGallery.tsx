import { useRef, type KeyboardEvent } from 'react'
import { AlertTriangle, ImageOff, Plus, RotateCw, X } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { cn } from './cn'

export type PhotoGalleryItemStatus = 'ready' | 'uploading' | 'error'

export interface PhotoGalleryItem {
  id: string
  src: string
  alt?: string
  status: PhotoGalleryItemStatus
  /** Upload progress 0-100. Only meaningful while status is 'uploading'. */
  progress?: number
}

type Translate = (key: TranslationKey) => string

const ADD_SQUARE_ID = '__add__'

export interface PhotoGalleryProps {
  photos: PhotoGalleryItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Renders an "add photo" square while fewer than `max` photos exist. */
  onAdd?: () => void
  onRemove?: (id: string) => void
  onRetry?: (id: string) => void
  /** Called when the main image is clicked; a future lightbox will use it. */
  onOpen?: (id: string) => void
  readOnly?: boolean
  max?: number
  className?: string
}

/**
 * Shared movement photo component: a main preview on top and a row of
 * equal square thumbnails below it. Presentational and controlled only —
 * upload logic (Supabase, staging, retries) stays with the caller.
 */
export function PhotoGallery({
  photos,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onRetry,
  onOpen,
  readOnly = false,
  max = 3,
  className,
}: PhotoGalleryProps) {
  const { t, dir } = useI18n()
  const rowRef = useRef<HTMLDivElement>(null)

  const selectedPhoto = photos.find((photo) => photo.id === selectedId) ?? null
  const canAdd = !readOnly && !!onAdd && photos.length < max

  type Slot =
    | { kind: 'photo'; item: PhotoGalleryItem; index: number }
    | { kind: 'add' }
    | { kind: 'empty' }

  const slots: Slot[] = photos.map((item, index) => ({
    kind: 'photo',
    item,
    index,
  }))
  if (canAdd) slots.push({ kind: 'add' })
  while (slots.length < max) slots.push({ kind: 'empty' })

  const focusableIds = slots
    .map((slot) =>
      slot.kind === 'photo'
        ? slot.item.id
        : slot.kind === 'add'
          ? ADD_SQUARE_ID
          : null,
    )
    .filter((id): id is string => id !== null)

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const currentId = (event.target as HTMLElement).dataset.squareId
    if (!currentId) return
    const currentIndex = focusableIds.indexOf(currentId)
    if (currentIndex === -1) return
    event.preventDefault()
    const forwardKey = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const delta = event.key === forwardKey ? 1 : -1
    const nextIndex = Math.max(
      0,
      Math.min(focusableIds.length - 1, currentIndex + delta),
    )
    const nextId = focusableIds[nextIndex]
    if (nextId === currentId) return
    if (nextId !== ADD_SQUARE_ID) onSelect(nextId)
    const nextEl = rowRef.current?.querySelector<HTMLButtonElement>(
      `[data-square-id="${nextId}"]`,
    )
    nextEl?.focus()
  }

  return (
    <div className={cn('space-y-2', className)}>
      <MainImage
        photo={selectedPhoto}
        onOpen={onOpen}
        onRetry={onRetry}
        t={t}
      />
      <div
        ref={rowRef}
        role="group"
        aria-label={t('photo')}
        className="grid grid-cols-3 gap-2"
        onKeyDown={handleRowKeyDown}
      >
        {slots.map((slot, i) => {
          if (slot.kind === 'photo') {
            return (
              <PhotoSquare
                key={slot.item.id}
                item={slot.item}
                index={slot.index}
                selected={slot.item.id === selectedId}
                onSelect={onSelect}
                onRemove={readOnly ? undefined : onRemove}
                onRetry={onRetry}
                t={t}
              />
            )
          }
          if (slot.kind === 'add') {
            return <AddSquare key="add" onAdd={onAdd} t={t} />
          }
          return <EmptySquare key={`empty-${i}`} />
        })}
      </div>
    </div>
  )
}

function MainImage({
  photo,
  onOpen,
  onRetry,
  t,
}: {
  photo: PhotoGalleryItem | null
  onOpen?: (id: string) => void
  onRetry?: (id: string) => void
  t: Translate
}) {
  const clickable = !!photo && !!onOpen

  const image = photo ? (
    <img
      src={photo.src}
      alt={photo.alt || t('photoGalleryMainAlt')}
      className="h-full w-full object-contain"
    />
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
      <ImageOff size={28} aria-hidden="true" />
      <span className="text-sm">{t('noPhoto')}</span>
    </div>
  )

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-surface">
      {clickable ? (
        <button
          type="button"
          onClick={() => onOpen(photo.id)}
          aria-label={t('photoGalleryOpenAria')}
          className="flex h-full w-full items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {image}
        </button>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {image}
        </div>
      )}
      {photo && photo.status !== 'ready' && (
        <PhotoOverlay
          status={photo.status}
          progress={photo.progress}
          onRetry={onRetry ? () => onRetry(photo.id) : undefined}
          retryAriaLabel={t('retryPhotoUpload')}
          t={t}
        />
      )}
    </div>
  )
}

function PhotoSquare({
  item,
  index,
  selected,
  onSelect,
  onRemove,
  onRetry,
  t,
}: {
  item: PhotoGalleryItem
  index: number
  selected: boolean
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onRetry?: (id: string) => void
  t: Translate
}) {
  const selectLabel = t('photoGallerySelectAria').replace(
    '{index}',
    String(index + 1),
  )
  return (
    <div className="relative">
      <button
        type="button"
        data-square-id={item.id}
        aria-pressed={selected}
        aria-label={selectLabel}
        onClick={() => onSelect(item.id)}
        className={cn(
          'aspect-square w-full overflow-hidden rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          selected
            ? 'border-primary ring-2 ring-[var(--ring)] ring-offset-2'
            : 'hover:bg-surface-hover',
        )}
      >
        <img
          src={item.src}
          alt={item.alt || selectLabel}
          className="h-full w-full object-contain"
        />
      </button>
      {item.status !== 'ready' && (
        <PhotoOverlay
          status={item.status}
          progress={item.progress}
          onRetry={onRetry ? () => onRetry(item.id) : undefined}
          retryAriaLabel={t('photoGalleryRetryAria').replace(
            '{index}',
            String(index + 1),
          )}
          t={t}
        />
      )}
      {onRemove && item.status !== 'uploading' && (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={t('photoGalleryRemoveAria').replace(
            '{index}',
            String(index + 1),
          )}
          className="absolute -top-1.5 -end-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-bg text-fg shadow-sm hover:bg-danger-soft hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function AddSquare({ onAdd, t }: { onAdd?: () => void; t: Translate }) {
  return (
    <button
      type="button"
      data-square-id={ADD_SQUARE_ID}
      onClick={onAdd}
      aria-label={t('addPhoto')}
      className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Plus size={18} aria-hidden="true" />
      <span className="text-xs">{t('addPhoto')}</span>
    </button>
  )
}

function EmptySquare() {
  return (
    <div
      aria-hidden="true"
      className="aspect-square w-full rounded-lg border border-dashed"
    />
  )
}

function PhotoOverlay({
  status,
  progress,
  onRetry,
  retryAriaLabel,
  t,
}: {
  status: Exclude<PhotoGalleryItemStatus, 'ready'>
  progress?: number
  onRetry?: () => void
  retryAriaLabel: string
  t: Translate
}) {
  if (status === 'uploading') {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg) 72%, transparent)',
        }}
        aria-live="polite"
      >
        <Spinner size={20} />
        {typeof progress === 'number' && (
          <span className="text-xs font-medium tabular-nums">
            {Math.round(progress)}%
          </span>
        )}
      </div>
    )
  }
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-1 text-center text-danger"
      style={{
        backgroundColor:
          'color-mix(in srgb, var(--danger-soft) 92%, transparent)',
      }}
    >
      <AlertTriangle size={18} aria-hidden="true" />
      <span className="text-xs font-medium">{t('photoUploadFailedShort')}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={retryAriaLabel}
          className="inline-flex items-center gap-1 rounded-md border border-danger bg-bg px-2 py-1 text-xs font-medium text-danger hover:bg-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <RotateCw size={12} aria-hidden="true" />
          {t('retryPhotoUpload')}
        </button>
      )}
    </div>
  )
}
