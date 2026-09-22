'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FullPageSpinner } from '@/components/Spinner'
import { buildDriverDialogHref } from '@/lib/driverEquipment'

export interface DriverDetailProps {
  driverId: string
  /** Kept so `src/App.tsx` (which still routes `/drivers/:id` here) does not
   *  need to change; unused now that this only redirects. */
  onBack: () => void
}

/**
 * The standalone driver detail page is retired in favor of a dialog on the
 * drivers list (`DriverDetailDialog`, opened via `?driver=<id>` on
 * `/drivers`). This component only keeps the old `/drivers/:id` URL working
 * by redirecting to the new one; it renders no driver data itself.
 */
export function DriverDetail({ driverId }: DriverDetailProps) {
  const router = useRouter()

  useEffect(() => {
    router.replace(buildDriverDialogHref(driverId))
  }, [driverId, router])

  return <FullPageSpinner />
}
