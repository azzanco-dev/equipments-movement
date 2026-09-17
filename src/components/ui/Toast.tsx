import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Portal, Toast as RadixToast } from 'radix-ui'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  title: ReactNode
  description?: ReactNode
  tone?: ToastTone
  action?: ToastAction
  /** Auto-dismiss delay in ms; defaults to 5000. 0 disables auto-dismiss. */
  duration?: number
}

interface ToastRecord extends ToastOptions {
  id: string
  open: boolean
}

type ToastFn = (options: ToastOptions) => string

const ToastContext = createContext<ToastFn | null>(null)

const TONE_ICON: Record<ToastTone, typeof Info> = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
}

const TONE_CLASSES: Record<ToastTone, string> = {
  neutral: 'border bg-bg text-fg',
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning',
  danger: 'border-transparent bg-danger-soft text-danger',
}

const REMOVE_DELAY_MS = 200

/**
 * Self-contained toast host: mount `ToastProvider` once (app root, or locally
 * inside a showcase/demo) and call `useToast()` anywhere beneath it.
 *
 * const toast = useToast()
 * toast({ title: 'تم الحفظ بنجاح', tone: 'success' })
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [items, setItems] = useState<ToastRecord[]>([])
  const nextId = useRef(0)

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const close = useCallback(
    (id: string) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, open: false } : item)),
      )
      window.setTimeout(() => remove(id), REMOVE_DELAY_MS)
    },
    [remove],
  )

  const toast = useCallback<ToastFn>((options) => {
    const id = `toast-${++nextId.current}`
    setItems((prev) => [...prev, { ...options, id, open: true }])
    return id
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      <RadixToast.Provider swipeDirection="down" duration={5000}>
        {children}
        {items.map((item) => {
          const tone = item.tone ?? 'neutral'
          const Icon = TONE_ICON[tone]
          return (
            <RadixToast.Root
              key={item.id}
              open={item.open}
              duration={item.duration === 0 ? Infinity : item.duration}
              onOpenChange={(open) => {
                if (!open) close(item.id)
              }}
              className={cn(
                'pointer-events-auto relative flex w-full items-start gap-2.5 rounded-lg border p-3.5 text-sm shadow-lg',
                'data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out',
                'data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)]',
                'data-[swipe=cancel]:translate-y-0 data-[swipe=cancel]:transition-transform data-[swipe=cancel]:duration-150',
                'data-[swipe=end]:animate-toast-swipe-out',
                TONE_CLASSES[tone],
              )}
            >
              <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <RadixToast.Title className="font-medium leading-snug">
                  {item.title}
                </RadixToast.Title>
                {item.description && (
                  <RadixToast.Description className="mt-0.5 text-[13px] leading-snug opacity-90">
                    {item.description}
                  </RadixToast.Description>
                )}
                {item.action && (
                  <RadixToast.Action
                    asChild
                    altText={item.action.label}
                    className="mt-2 inline-block"
                  >
                    <button
                      type="button"
                      onClick={item.action.onClick}
                      className="text-sm font-medium underline underline-offset-2"
                    >
                      {item.action.label}
                    </button>
                  </RadixToast.Action>
                )}
              </div>
              <RadixToast.Close
                aria-label={t('close')}
                className="-me-1 -mt-1 inline-flex shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
              >
                <X size={14} aria-hidden="true" />
              </RadixToast.Close>
            </RadixToast.Root>
          )
        })}
        <Portal.Root>
          <RadixToast.Viewport
            className={cn(
              'fixed inset-x-4 bottom-4 z-[100] m-0 flex list-none flex-col gap-2 outline-none',
              'sm:inset-x-auto sm:start-4 sm:w-96 sm:max-w-[calc(100vw-2rem)]',
            )}
          />
        </Portal.Root>
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}

/** Returns a stable `toast(options)` function; must be called under `ToastProvider`. */
export function useToast(): ToastFn {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
