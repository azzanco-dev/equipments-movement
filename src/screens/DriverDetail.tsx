import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Briefcase,
  CreditCard,
  Flag,
  Phone,
  User,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Alert } from '@/components/Alert'
import { InlineSpinner } from '@/components/Spinner'
import { PageHeader } from '@/components/PageHeader'
import type { Driver } from '@/lib/types'

export function DriverDetail({
  driverId,
  onBack,
}: {
  driverId: string
  onBack: () => void
}) {
  const { t } = useI18n()
  const [driver, setDriver] = useState<Driver | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchDriver = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('drivers')
      .select(
        'id,full_name,id_number,mobile_number,nationality,employment_type,job_title,created_at,updated_at',
      )
      .eq('id', driverId)
      .maybeSingle()
    if (fetchError || !data) setError(t('driverNotFound'))
    else setDriver(data as Driver)
    setLoading(false)
  }, [driverId, t])
  useEffect(() => {
    fetchDriver()
  }, [fetchDriver])
  if (loading) return <InlineSpinner label={t('loading')} />
  if (error || !driver)
    return (
      <div className="space-y-4">
        <button className="btn-ghost" onClick={onBack}>
          <ArrowLeft size={18} />
          {t('back')}
        </button>
        <Alert type="error">{error}</Alert>
      </div>
    )
  const items = [
    [<User key="u" size={17} />, t('fullName'), driver.full_name],
    [<CreditCard key="i" size={17} />, t('idNumber'), driver.id_number],
    [<Phone key="p" size={17} />, t('mobileNumber'), driver.mobile_number],
    [<Flag key="f" size={17} />, t('nationality'), driver.nationality],
    [
      <Briefcase key="e" size={17} />,
      t('employmentType'),
      driver.employment_type,
    ],
    [<Briefcase key="j" size={17} />, t('jobTitle'), driver.job_title ?? '—'],
  ] as const
  return (
    <div className="space-y-5">
      <button className="btn-ghost" onClick={onBack}>
        <ArrowLeft size={18} />
        {t('backToDrivers')}
      </button>
      <PageHeader title={driver.full_name} description={t('driverDetails')} />
      <div className="card grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {items.map(([icon, label, value]) => (
          <div
            key={label}
            className="flex gap-3 border-b py-3 last:border-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="mt-1 text-muted">{icon}</span>
            <div>
              <p className="text-xs text-muted">{label}</p>
              <p className="font-medium">{value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
