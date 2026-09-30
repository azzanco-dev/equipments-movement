import { useEffect, useId, useState, type ReactNode } from 'react'
import { AlertTriangle, MessageCircle, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { supabase } from '@/lib/supabase'
import { Button, InfoGrid, Notice, type InfoGridItem } from '@/components/ui'
import {
  arrivalNoticeDelivered,
  loadLatestArrivalNotice,
  noticeAge,
  requestWorkshopArrivalNotice,
  splitAroundName,
  type ArrivalNoticeErrorCode,
  type ArrivalNoticeOutcome,
  type ArrivalNoticeRecord,
} from '@/lib/workshopArrivalNotice'

export interface NotifyForemanPanelProps {
  equipmentId: string
  /** Project of the open site entry, already localized; `null` when unknown. */
  projectName: string | null
  /** The foreman who recorded the open site entry; `null` when unknown. */
  foremanName: string | null
  /** True while the form re-reads the unit's last movement. */
  refreshing: boolean
  /** Re-reads the unit's state, so the entry opens once the exit exists. */
  onRefresh: () => void
}

const ERROR_KEYS: Record<ArrivalNoticeErrorCode, TranslationKey> = {
  not_on_site: 'notifyForemanErrNotOnSite',
  recently_sent: 'notifyForemanErrRecentlySent',
  forbidden: 'notifyForemanErrForbidden',
  invalid: 'notifyForemanErrInvalid',
  unauthorized: 'sessionExpiredError',
  network: 'networkConnectionError',
  failed: 'notifyForemanErrFailed',
}

type PreviousNotice =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'loaded'; notice: ArrivalNoticeRecord | null }

/** A sentence with a `{name}` placeholder; the name is isolated in `<bdi>`. */
function Sentence({ template, name }: { template: string; name: string }) {
  const parts = splitAroundName(template)
  return (
    <>
      {parts.before}
      {parts.hasName && <bdi>{name}</bdi>}
      {parts.after}
    </>
  )
}

/**
 * Shown in the workshop ENTRY form when the chosen unit's latest movement is
 * an open SITE entry: the workshop entry is impossible until the foreman who
 * recorded that entry records the site exit, so the officer can tell him by
 * WhatsApp instead of phoning (wave 9, migration 0110).
 *
 * The server decides everything that matters: the recipient, the text, the
 * role check and the 10-minute rule. This panel only asks and reports.
 */
export function NotifyForemanPanel({
  equipmentId,
  projectName,
  foremanName,
  refreshing,
  onRefresh,
}: NotifyForemanPanelProps) {
  const { t } = useI18n()
  const titleId = useId()
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<ArrivalNoticeOutcome | null>(null)
  const [previous, setPrevious] = useState<PreviousNotice>({
    state: 'loading',
  })
  const [previousKey, setPreviousKey] = useState(0)
  // Re-rendered every half minute so "N minutes ago" stays true.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Was this open site entry already reported? A failure here is shown but
  // never blocks the button: the server enforces the 10-minute rule anyway.
  useEffect(() => {
    let active = true
    loadLatestArrivalNotice(supabase, equipmentId).then((result) => {
      if (!active) return
      setNow(Date.now())
      setPrevious(
        result.failed
          ? { state: 'failed' }
          : { state: 'loaded', notice: result.notice },
      )
    })
    return () => {
      active = false
    }
  }, [equipmentId, previousKey])

  const send = async () => {
    if (sending) return
    setSending(true)
    setOutcome(null)
    const result = await requestWorkshopArrivalNotice(supabase, equipmentId)
    setOutcome(result)
    setSending(false)
    // Every accepted request logged an attempt, and a refused repeat means
    // somebody else's attempt exists: show the latest one either way.
    if (result.ok || result.error === 'recently_sent')
      setPreviousKey((key) => key + 1)
    // The exit was recorded meanwhile: re-read the unit so the normal entry
    // becomes possible without the officer having to ask for it.
    if (!result.ok && result.error === 'not_on_site') onRefresh()
  }

  const ago = (createdAt: string) => {
    const age = noticeAge(createdAt, now)
    if (age.unit === 'now') return t('noticeAgoNow')
    const key: TranslationKey =
      age.unit === 'minutes'
        ? 'noticeAgoMinutes'
        : age.unit === 'hours'
          ? 'noticeAgoHours'
          : 'noticeAgoDays'
    return t(key).replace('{count}', String(age.count))
  }

  const previousLine = (notice: ArrivalNoticeRecord): ReactNode => {
    const delivered = arrivalNoticeDelivered(notice.status)
    const key: TranslationKey = notice.senderName
      ? delivered
        ? 'notifyForemanPrevious'
        : 'notifyForemanPreviousFailed'
      : delivered
        ? 'notifyForemanPreviousNoName'
        : 'notifyForemanPreviousFailedNoName'
    return (
      <Sentence
        template={t(key).replace('{ago}', ago(notice.createdAt))}
        name={notice.senderName ?? ''}
      />
    )
  }

  const items: InfoGridItem[] = [
    { key: 'project', label: t('project'), value: projectName },
    {
      key: 'foreman',
      label: t('notifyForemanForemanLabel'),
      value: foremanName ? <bdi>{foremanName}</bdi> : null,
    },
  ]

  // The server names the recipient; before any answer the entry's recorder
  // from the form is the same person.
  const recipientName =
    (outcome?.ok ? outcome.recipientName : '') ||
    foremanName ||
    t('notifyForemanFallbackName')

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-lg border bg-surface p-4"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-warning"
        />
        <div className="min-w-0 space-y-1">
          <h4 id={titleId} className="text-sm font-medium">
            {t('notifyForemanTitle')}
          </h4>
          <p className="text-sm leading-relaxed text-muted">
            {t('notifyForemanExplain')}
          </p>
        </div>
      </div>

      <InfoGrid items={items} columns={2} />

      {previous.state === 'failed' && (
        <Notice tone="warning" size="compact">
          {t('notifyForemanPreviousLoadError')}
        </Notice>
      )}
      {previous.state === 'loaded' && previous.notice && (
        <p className="text-xs leading-relaxed text-muted" role="status">
          {previousLine(previous.notice)}
        </p>
      )}

      {outcome?.ok && outcome.status === 'sent' && (
        <Notice tone="success">
          <Sentence template={t('notifyForemanSent')} name={recipientName} />
        </Notice>
      )}
      {outcome?.ok && outcome.status === 'no_mobile' && (
        <Notice tone="warning">
          <Sentence
            template={t('notifyForemanNoMobile')}
            name={recipientName}
          />
        </Notice>
      )}
      {outcome?.ok &&
        (outcome.status === 'failed' ||
          outcome.status === 'not_configured') && (
          <Notice tone="warning">
            <Sentence
              template={t('notifyForemanNotSent')}
              name={recipientName}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={send} loading={sending}>
                {t('retry')}
              </Button>
              {outcome.fallbackUrl && (
                <Button asChild size="sm">
                  <a
                    href={outcome.fallbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('notifyForemanOpenWhatsapp')}
                  </a>
                </Button>
              )}
            </div>
          </Notice>
        )}
      {outcome && !outcome.ok && (
        <Notice tone={outcome.error === 'recently_sent' ? 'warning' : 'danger'}>
          {t(ERROR_KEYS[outcome.error])}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={send}
          loading={sending}
          icon={<MessageCircle size={15} aria-hidden="true" />}
        >
          {t('notifyForeman')}
        </Button>
        <Button
          onClick={onRefresh}
          loading={refreshing}
          icon={<RefreshCw size={15} aria-hidden="true" />}
        >
          {t('refreshEquipmentStatus')}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {t('notifyForemanRefreshHint')}
      </p>
    </section>
  )
}
