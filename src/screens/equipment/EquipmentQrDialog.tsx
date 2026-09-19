import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button, Dialog, ErrorState } from '@/components/ui'
import { QRCodeDisplay } from '@/components/QRCodeDisplay'
import { useI18n } from '@/i18n/I18nContext'
import { printEquipmentQr } from '@/lib/printEquipmentQr'
import type { Equipment } from '@/lib/types'

export interface EquipmentQrDialogProps {
  /** The equipment whose QR is shown; null keeps the dialog closed. */
  equipment: Equipment | null
  onOpenChange: (open: boolean) => void
}

export function EquipmentQrDialog({
  equipment,
  onOpenChange,
}: EquipmentQrDialogProps) {
  const { t } = useI18n()
  const [printError, setPrintError] = useState<string | null>(null)

  const print = (target: Equipment) => {
    setPrintError(null)
    void printEquipmentQr(target, () => setPrintError(t('printQrError')))
  }

  return (
    <Dialog
      open={!!equipment}
      onOpenChange={(next) => {
        if (!next) {
          setPrintError(null)
          onOpenChange(false)
        }
      }}
      title={t('qrValue')}
      size="sm"
    >
      {equipment && (
        <div className="flex flex-col items-center gap-4 py-4">
          {printError && (
            <ErrorState title={printError} className="w-full p-4" />
          )}
          <p className="text-lg font-bold">{equipment.code}</p>
          <p className="text-sm text-muted">{equipment.type}</p>
          <QRCodeDisplay value={equipment.qr_value} size={200} />
          <p className="break-all text-center text-xs text-muted">
            {equipment.qr_value}
          </p>
          <Button
            variant="outline"
            icon={<Printer size={16} aria-hidden="true" />}
            onClick={() => print(equipment)}
          >
            {t('printQR')}
          </Button>
        </div>
      )}
    </Dialog>
  )
}
