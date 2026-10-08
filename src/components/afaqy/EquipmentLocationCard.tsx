'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ExternalLink,
  Gauge,
  KeyRound,
  Radio,
  RefreshCw,
  Satellite,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  formatSaudiDateTime,
  googleMapsUrl,
  isPositionStale,
  lastSignalTime,
  loadEquipmentPosition,
  type AfaqyPositionAnswer,
} from '@/lib/afaqy'
import {
  Button,
  Card,
  ErrorState,
  InfoGrid,
  Notice,
  SectionHeader,
  Skeleton,
  buttonClasses,
  type InfoGridItem,
} from '@/components/ui'
import { InfoGridSkeleton } from '@/components/ui/InfoGrid'
import { RelativeTime } from '@/components/RelativeTime'
import { LocationMap } from '@/components/map/LocationMap'

export interface EquipmentLocationCardProps {
  equipmentId: string
  /** The marker's accessible name. */
  equipmentCode: string
  className?: string
}

/**
 * wave 17 — «الموقع الحالي»: the last position of the equipment's linked
 * Afaqy unit. ADMIN ONLY: for any other role (or no profile) nothing renders
 * and the position route is never requested; the route itself is admin-only
 * as well.
 */
export function EquipmentLocationCard(props: EquipmentLocationCardProps) {
  const { profile } = useAuth()
  if (profile?.role !== 'admin') return null
  return <LocationCardContent {...props} />
}

type View = { kind: 'loading' } | AfaqyPositionAnswer

function LocationCardContent({
  equipmentId,
  equipmentCode,
  className,
}: EquipmentLocationCardProps) {
  const { t } = useI18n()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback(
    async (keepContent: boolean) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      if (keepContent) setRefreshing(true)
      else setView({ kind: 'loading' })
      const answer = await loadEquipmentPosition(
        supabase,
        equipmentId,
        controller.signal,
      )
      if (!answer || controller.signal.aborted) return
      setView(answer)
      setRefreshing(false)
    },
    [equipmentId],
  )

  useEffect(() => {
    void load(false)
    return () => controllerRef.current?.abort()
  }, [load])

  const refreshButton = (
    <Button
      size="sm"
      variant="outline"
      icon={<RefreshCw size={14} aria-hidden="true" />}
      loading={refreshing}
      disabled={view.kind === 'loading'}
      onClick={() => void load(true)}
    >
      {t('afaqyRefresh')}
    </Button>
  )

  let body: ReactNode
  if (view.kind === 'loading') {
    body = (
      <div aria-busy="true" className="space-y-3">
        <span className="sr-only" role="status">
          {t('loading')}
        </span>
        <InfoGridSkeleton count={3} />
        <Skeleton className="h-56 w-full md:h-64" />
      </div>
    )
  } else if (view.kind === 'not_linked') {
    body = <Notice tone="neutral">{t('afaqyLocationNotLinked')}</Notice>
  } else if (view.kind === 'unit_not_found') {
    body = <Notice tone="warning">{t('afaqyLocationUnitMissing')}</Notice>
  } else if (view.kind === 'not_configured') {
    body = <Notice tone="neutral">{t('afaqyStatusNotConfigured')}</Notice>
  } else if (view.kind === 'error') {
    body = (
      <ErrorState
        title={t('afaqyLocationLoadError')}
        onRetry={() => void load(false)}
        className="p-6"
      />
    )
  } else if (!view.unit.position) {
    body = (
      <Notice tone="info" title={view.unit.name || undefined}>
        {t('afaqyLocationNoPosition')}
      </Notice>
    )
  } else {
    const position = view.unit.position
    const signal = lastSignalTime(position)
    const items: InfoGridItem[] = [
      {
        key: 'lastSignal',
        icon: <Radio size={16} aria-hidden="true" />,
        label: t('afaqyLastSignal'),
        value: signal ? (
          <span className="inline-flex flex-wrap items-baseline gap-x-2">
            <span dir="ltr" className="tabular-nums">
              {formatSaudiDateTime(signal)}
            </span>
            <RelativeTime value={signal} />
          </span>
        ) : null,
      },
      {
        key: 'speed',
        icon: <Gauge size={16} aria-hidden="true" />,
        label: t('afaqySpeed'),
        value:
          position.speedKmh === null
            ? null
            : t('afaqySpeedValue').replace(
                '{speed}',
                String(Math.round(position.speedKmh)),
              ),
        numeric: true,
      },
      {
        key: 'ignition',
        icon: <KeyRound size={16} aria-hidden="true" />,
        label: t('afaqyIgnition'),
        value:
          position.ignitionOn === null
            ? null
            : position.ignitionOn
              ? t('afaqyIgnitionOn')
              : t('afaqyIgnitionOff'),
      },
      {
        key: 'unit',
        icon: <Satellite size={16} aria-hidden="true" />,
        label: t('afaqyUnitName'),
        value: view.unit.name || null,
        dir: 'ltr',
      },
    ]
    body = (
      <div className="space-y-3">
        {isPositionStale(position) && (
          <Notice tone="warning" size="compact">
            {t('afaqyLocationStale')}
          </Notice>
        )}
        <InfoGrid items={items} columns={2} />
        <LocationMap
          lat={position.lat}
          lng={position.lng}
          markerLabel={equipmentCode}
        />
        <a
          href={googleMapsUrl(position.lat, position.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          <ExternalLink size={14} aria-hidden="true" />
          {t('afaqyOpenInGoogleMaps')}
        </a>
      </div>
    )
  }

  return (
    <Card className={className}>
      <SectionHeader
        as="h2"
        title={t('afaqyLocationTitle')}
        action={refreshButton}
        className="mb-3"
      />
      {body}
    </Card>
  )
}
