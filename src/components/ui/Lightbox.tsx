import { useCallback, useEffect, useRef, type PointerEvent } from 'react'
import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export interface LightboxItem {
  id: string
  src: string
  alt?: string
}

export interface LightboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: LightboxItem[]
  /** Index of the item currently shown. Shared with the caller so the
   * underlying carousel/grid stays in sync with lightbox navigation. */
  index: number
  onIndexChange: (index: number) => void
}

/** Swipe distance (px) past which a touch/pointer drag counts as a nav gesture. */
const SWIPE_THRESHOLD = 40

const overlayScrim = cn(
  'fixed inset-0 z-50 data-[state=open]:animate-fade-in-opacity',
  // Full-viewport dark scrim built from theme tokens (never a raw hex/black):
  // light mode mixes toward --fg (near-black), dark mode toward --bg
  // (already near-black), so photos always sit on a dark backdrop.
  'bg-[color-mix(in_srgb,var(--fg)_92%,transparent)]',
  'dark:bg-[color-mix(in_srgb,var(--bg)_92%,transparent)]',
)

const controlButton = cn(
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
  'text-bg dark:text-fg',
  'hover:bg-[color-mix(in_srgb,var(--bg)_20%,transparent)]',
  'dark:hover:bg-[color-mix(in_srgb,var(--fg)_20%,transparent)]',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bg)] dark:focus-visible:outline-[var(--fg)]',
)

/**
 * Full-viewport photo lightbox on Radix Dialog: prev/next navigation,
 * keyboard (arrow keys direction-aware for RTL, Home/End, Escape via Dialog),
 * touch swipe, and preloading of neighboring images so navigation is instant.
 */
export function Lightbox({
  open,
  onOpenChange,
  items,
  index,
  onIndexChange,
}: LightboxProps) {
  const { t, dir } = useI18n()
  const count = items.length
  const safeIndex = count > 0 ? ((index % count) + count) % count : 0
  const current = items[safeIndex] ?? null
  const pointerStart = useRef<{ x: number; y: number } | null>(null)

  const goTo = useCallback(
    (next: number) => {
      if (count === 0) return
      onIndexChange(((next % count) + count) % count)
    },
    [count, onIndexChange],
  )

  const goNext = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex])
  const goPrev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex])

  // Preload the previous and next images via hidden Image objects so
  // navigating feels instant instead of waiting on a fresh network load.
  useEffect(() => {
    if (!open || count < 2) return
    const preload = (i: number) => {
      const item = items[((i % count) + count) % count]
      if (!item) return
      const image = new Image()
      image.src = item.src
    }
    preload(safeIndex + 1)
    preload(safeIndex - 1)
  }, [open, safeIndex, items, count])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      // Direction-aware forward key, matching PhotoGallery's row navigation:
      // forward is ArrowRight in LTR and ArrowLeft in RTL.
      const forwardKey = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const backwardKey = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === forwardKey) {
        event.preventDefault()
        goNext()
      } else if (event.key === backwardKey) {
        event.preventDefault()
        goPrev()
      } else if (event.key === 'Home') {
        event.preventDefault()
        onIndexChange(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        onIndexChange(count - 1)
      }
      // Escape is handled by the Radix Dialog itself.
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, dir, goNext, goPrev, onIndexChange, count])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: event.clientX, y: event.clientY }
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start || count < 2) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return
    // Direction-aware, mirroring the RTL carousel: in LTR a left swipe
    // advances (as usual), in RTL a right swipe advances.
    const swipedForward = dir === 'rtl' ? dx > 0 : dx < 0
    if (swipedForward) goNext()
    else goPrev()
  }

  const handleBackgroundClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onOpenChange(false)
  }

  if (count === 0) return null

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayScrim} />
        <RadixDialog.Content
          className="fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-fade-in-opacity focus-visible:!outline-none"
          aria-describedby={undefined}
        >
          <VisuallyHidden.Root>
            <RadixDialog.Title>
              {current?.alt || t('photoGalleryMainAlt')}
            </RadixDialog.Title>
          </VisuallyHidden.Root>

          <div className="flex items-center justify-between gap-2 p-3">
            {count > 1 ? (
              <span className="rounded-full px-2.5 py-1 text-xs font-medium tabular-nums text-bg dark:text-fg bg-[color-mix(in_srgb,var(--bg)_18%,transparent)] dark:bg-[color-mix(in_srgb,var(--fg)_18%,transparent)]">
                {safeIndex + 1} / {count}
              </span>
            ) : (
              <span />
            )}
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label={t('close')}
                className={controlButton}
              >
                <X size={20} />
              </button>
            </RadixDialog.Close>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-4"
            onClick={handleBackgroundClick}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            {current && (
              <img
                key={current.id}
                src={current.src}
                alt={current.alt || t('photoGalleryMainAlt')}
                className="max-h-full max-w-full select-none object-contain"
                draggable={false}
              />
            )}

            {count > 1 && (
              <>
                <button
                  type="button"
                  aria-label={t('previous')}
                  onClick={goPrev}
                  className={cn(
                    controlButton,
                    'absolute start-2 top-1/2 -translate-y-1/2',
                  )}
                >
                  <ChevronLeft size={24} className="rtl-flip" />
                </button>
                <button
                  type="button"
                  aria-label={t('next')}
                  onClick={goNext}
                  className={cn(
                    controlButton,
                    'absolute end-2 top-1/2 -translate-y-1/2',
                  )}
                >
                  <ChevronRight size={24} className="rtl-flip" />
                </button>
              </>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
