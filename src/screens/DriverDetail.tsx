import { useCallback, useEffect, useState } from 'react'
import { Briefcase, CreditCard, Flag, Phone, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import type { Driver } from '@/lib/types'
import {
  BackButton,
  DescriptionList,
  ErrorState,
  PageHeader,
  Skeleton,
  type DescriptionListItem,
} from '@/components/ui'

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
        'id,full_name,name_en,id_number,mobile_number,nationality,employment_type,job_title,created_at,updated_at',
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
  if (loading)
    return (
      <div
        className="space-y-2 py-2"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-4/5" />
      </div>
    )
  if (error || !driver)
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={t('back')} />
        <ErrorState title={error ?? undefined} />
      </div>
    )
  const items: DescriptionListItem[] = [
    {
      key: 'fullName',
      icon: <User size={17} />,
      label: t('fullName'),
      value: driver.full_name,
    },
    {
      key: 'nameEn',
      icon: <User size={17} />,
      label: t('driverNameEn'),
      value: driver.name_en,
    },
    {
      key: 'idNumber',
      icon: <CreditCard size={17} />,
      label: t('idNumber'),
      value: driver.id_number,
      dir: 'ltr',
    },
    {
      key: 'mobileNumber',
      icon: <Phone size={17} />,
      label: t('mobileNumber'),
      value: driver.mobile_number,
      dir: 'ltr',
    },
    {
      key: 'nationality',
      icon: <Flag size={17} />,
      label: t('nationality'),
      value: driver.nationality,
    },
    {
      key: 'employmentType',
      icon: <Briefcase size={17} />,
      label: t('employmentType'),
      value: driver.employment_type,
    },
    {
      key: 'jobTitle',
      icon: <Briefcase size={17} />,
      label: t('jobTitle'),
      value: driver.job_title,
    },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        title={driver.full_name}
        description={t('driverDetails')}
        onBack={onBack}
        backLabel={t('backToDrivers')}
      />
      <div className="card">
        <DescriptionList items={items} columns={2} />
      </div>
    </div>
  )
}
