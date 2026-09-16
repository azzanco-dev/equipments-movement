import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AlertDialog, Dialog as RadixDialog } from 'radix-ui'
import { X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Button, IconButton } from './Button'
import { cn } from './cn'

const overlay =
  'fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-sm data-[state=open]:animate-fade-in-opacity'

// Centering is symmetric, so physical left/translate is direction-safe here.
const panel =
  'fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-bg text-fg shadow-xl outline-none focus-visible:!outline-none data-[state=open]:animate-fade-in-opacity'

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Action buttons, rendered at the end side of the footer. */
  footer?: ReactNode
  size?: keyof typeof widths
  children?: ReactNode
}

/** Modal dialog on Radix: focus trap, Escape to close, labelled title. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  children,
}: DialogProps) {
  const { t } = useI18n()
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlay} />
        <RadixDialog.Content
          className={cn(panel, widths[size])}
          // Without a description Radix warns unless this is explicitly unset.
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-base font-semibold">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-sm text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton
                label={t('close')}
                size="sm"
                icon={<X size={16} />}
                className="-me-1 shrink-0"
              />
            </RadixDialog.Close>
          </div>
          {children && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {children}
            </div>
          )}
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  /** `danger` styles the confirm action as destructive. */
  tone?: 'default' | 'danger'
  /** Keeps the dialog open and shows a spinner while the action runs. */
  loading?: boolean
  onConfirm: () => void | Promise<void>
}

/** Confirmation on Radix AlertDialog; replaces window.confirm(). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next)
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={cn(panel, widths.sm, 'p-5')}>
          <AlertDialog.Title className="text-base font-semibold">
            {title}
          </AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="mt-2 text-sm text-muted">
              {description}
            </AlertDialog.Description>
          ) : (
            <AlertDialog.Description className="sr-only">
              {title}
            </AlertDialog.Description>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={loading}>
                {cancelLabel ?? t('cancel')}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onClick={() => void onConfirm()}
            >
              {confirmLabel ?? t('confirm')}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  tone?: 'default' | 'danger'
}

/**
 * Promise-based confirmation for replacing window.confirm():
 *
 * const { confirm, confirmDialog } = useConfirm()
 * if (!(await confirm({ title, tone: 'danger' }))) return
 * ...render {confirmDialog} once in the component.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((confirmed: boolean) => void) | null>(null)

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed)
    resolver.current = null
    setOptions(null)
  }, [])

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false)
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const confirmDialog = (
    <ConfirmDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open) settle(false)
      }}
      title={options?.title ?? ''}
      description={options?.description}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      tone={options?.tone}
      onConfirm={() => settle(true)}
    />
  )

  return { confirm, confirmDialog }
}
