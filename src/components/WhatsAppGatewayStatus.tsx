import { useEffect, useSyncExternalStore } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { usePermissions } from '@/auth/PermissionsContext'
import { canSeeIntegrationsStatus } from '@/lib/actionPermissions'
import { supabase } from '@/lib/supabase'
import {
  WHATSAPP_STATUS_POLL_MS,
  isWhatsAppStatusWarning,
  loadWhatsAppStatus,
  type WhatsAppGatewayState,
} from '@/lib/whatsappStatus'
import { Notice, cn } from '@/components/ui'

// wave 12 — the WhatsApp gateway connection status for the admin (wave 24:
// for a holder of `settings.integrations`): a quiet
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

/** The state alone, shown at the end of the sidebar line. */
const STATE_LABELS: Record<
  Exclude<WhatsAppStatusView, 'off'>,
  TranslationKey
> = {
  checking: 'whatsappStateChecking',
  connected: 'whatsappStateConnected',
  disconnected: 'whatsappStateDisconnected',
  qr: 'whatsappStateQr',
  loading: 'whatsappStateLoading',
  not_configured: 'whatsappStateNotConfigured',
  unknown: 'whatsappStateUnknown',
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
 * The state at the foot of the sidebar. Since the sidebar of model 1
 * (owner 2026-11-23, approved in Figma) it is ONE quiet line: the dot in a
 * soft halo of its colour, «واتساب» and the state word, muted while it is
 * connected or unknown, the state in red when the device is not linked. It
 * was a light green / red box shaped like a navigation item (2026-10-05).
 * Renders nothing when the status is not polled.
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
      aria-label={label}
      className={cn(
        'flex h-7 w-full items-center gap-2 px-3 text-xs font-normal text-muted',
        className,
      )}
    >
      {/* The dot sits in a soft halo of its own colour. */}
      <span
        aria-hidden="true"
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          tone === 'ok' &&
            'wa-dot-live bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_22%,transparent)]',
          tone === 'down' &&
            'bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_22%,transparent)]',
          tone === 'neutral' && 'bg-muted',
        )}
      />
      <span aria-hidden="true" className="min-w-0 truncate">
        {t('whatsappStatusName')}
      </span>
      <span
        aria-hidden="true"
        className={cn('shrink-0', tone === 'down' && 'text-danger')}
      >
        {t(STATE_LABELS[view])}
      </span>
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
  const permissionState = usePermissions()
  const view = useWhatsAppStatus()
  // wave 24: `settings.integrations` (nobody while the permissions load
  // or after a failed load).
  if (!canSeeIntegrationsStatus(permissionState)) return null
  if (view === 'off') return null
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
