import { useEffect, useSyncExternalStore } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  WHATSAPP_STATUS_POLL_MS,
  isWhatsAppStatusWarning,
  loadWhatsAppStatus,
  type WhatsAppGatewayState,
} from '@/lib/whatsappStatus'
import { Notice, cn } from '@/components/ui'

// wave 12 — the WhatsApp gateway connection status for the admin: a quiet
// line at the bottom of the sidebar, and a compact warning at the top of the
// admin home on small screens (where the sidebar is hidden) when the gateway
// is known to be disconnected.
//
// The layout polls (`useWhatsAppStatusPolling`) and publishes the result to a
// tiny module store; the sidebar line and the home alert only read it, so one
// page never asks the route twice.

/** `off`: not polled (not an admin). `checking`: before the first answer. */
export type WhatsAppStatusView = WhatsAppGatewayState | 'checking' | 'off'

let currentView: WhatsAppStatusView = 'off'
const listeners = new Set<() => void>()

function publish(view: WhatsAppStatusView) {
  if (view === currentView) return
  currentView = view
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const readView = () => currentView
const readServerView = (): WhatsAppStatusView => 'off'

export function useWhatsAppStatus(): WhatsAppStatusView {
  return useSyncExternalStore(subscribe, readView, readServerView)
}

const LABELS: Record<Exclude<WhatsAppStatusView, 'off'>, TranslationKey> = {
  checking: 'whatsappStatusChecking',
  connected: 'whatsappStatusConnected',
  disconnected: 'whatsappStatusDisconnected',
  qr: 'whatsappStatusQr',
  loading: 'whatsappStatusLoading',
  not_configured: 'whatsappStatusNotConfigured',
  unknown: 'whatsappStatusUnknown',
}

/**
 * Polls the status route while `enabled` (the admin only; nothing is
 * requested otherwise): once on mount, then every five minutes while the tab
 * is visible, and again on returning to the tab when the last check is older
 * than that. The request in flight is aborted on unmount.
 */
export function useWhatsAppStatusPolling(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      publish('off')
      return
    }
    publish('checking')
    let disposed = false
    let controller: AbortController | null = null
    let lastCheck = 0

    const check = async () => {
      if (document.visibilityState !== 'visible') return
      controller?.abort()
      const current = new AbortController()
      controller = current
      lastCheck = Date.now()
      const next = await loadWhatsAppStatus(supabase, current.signal)
      if (disposed || current.signal.aborted || next === null) return
      publish(next)
    }

    void check()
    const interval = window.setInterval(
      () => void check(),
      WHATSAPP_STATUS_POLL_MS,
    )
    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastCheck >= WHATSAPP_STATUS_POLL_MS
      )
        void check()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      publish('off')
    }
  }, [enabled])
}

/**
 * The sidebar line, shaped like a navigation item (owner decision
 * 2026-10-05): a light green box with a green dot when connected, a light
 * red box with a red dot when the device is not linked, and a neutral box
 * while the status is unknown. Renders nothing when the status is not polled.
 */
export function WhatsAppStatusIndicator({ className }: { className?: string }) {
  const { t } = useI18n()
  const view = useWhatsAppStatus()
  if (view === 'off') return null
  const label = t(LABELS[view])
  const tone =
    view === 'connected'
      ? 'ok'
      : isWhatsAppStatusWarning(view)
        ? 'down'
        : 'neutral'

  return (
    <div
      role="status"
      title={label}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
        tone === 'ok' && 'bg-success-soft text-fg',
        tone === 'down' && 'bg-danger-soft text-fg',
        tone === 'neutral' && 'bg-surface-hover text-muted',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-full',
          tone === 'ok' && 'bg-success',
          tone === 'down' && 'bg-danger',
          tone === 'neutral' && 'bg-muted',
        )}
      />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}

/**
 * The admin home warning for small screens (the sidebar is hidden below the
 * `lg` breakpoint). Only a gateway known to be not connected is shown: a
 * connected, unconfigured or undetermined status renders nothing here.
 */
export function WhatsAppStatusAlert({ className }: { className?: string }) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const view = useWhatsAppStatus()
  if (profile?.role !== 'admin' || view === 'off') return null
  if (!isWhatsAppStatusWarning(view)) return null
  return (
    <Notice
      tone="danger"
      size="compact"
      title={t(LABELS[view])}
      className={cn('lg:hidden', className)}
    >
      {t(view === 'qr' ? 'whatsappStatusQrHint' : 'whatsappStatusAlertHint')}
    </Notice>
  )
}
