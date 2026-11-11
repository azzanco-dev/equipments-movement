import { useEffect, useState } from 'react'
import { PurchasingUnitCell } from '@/components/purchasing/PurchasingUnitCell'
import { SalePrice } from '@/components/sales/SalePrice'
import { Badge, Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { SALE_RATE_UNIT_LABEL_KEYS, saleRateUnitOf } from '@/lib/sales'
import { CLIENT_PO_LINE_SELECT, type ClientPoLineRow } from '@/lib/salesData'
import { supabase } from '@/lib/supabase'

// Pinned to the visible start of the table and capped in width (the
// supplier PO panel's rule): the cell spans the whole table.
const PANEL = 'sticky start-0 max-w-[min(48rem,calc(100vw-3rem))] px-4 py-3'

/**
 * The units of one client PO inside its opened row in the «حسب الاوامر»
 * list: unit, type, period, the price unit and the sale price, unpriced
 * lines marked. Loads the PO's lines when it mounts, i.e. only for the row
 * that is open; a PO holds a handful of lines.
 */
export function ClientPoLinesPanel({ poId }: { poId: string }) {
  const { t } = useI18n()
  const [lines, setLines] = useState<ClientPoLineRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    supabase
      .from('client_po_equipment')
      .select(CLIENT_PO_LINE_SELECT)
      .eq('client_po_id', poId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (controller.signal.aborted) return
        if (error) setFailed(true)
        else setLines((data as unknown as ClientPoLineRow[] | null) ?? [])
      })
    return () => controller.abort()
  }, [poId])

  if (failed)
    return (
      <p role="alert" className={`${PANEL} text-sm text-danger`}>
        {t('dataLoadError')}
      </p>
    )
  if (!lines)
    return (
      <div className={`${PANEL} space-y-2`} aria-busy="true">
        <span className="sr-only" role="status">
          {t('loading')}
        </span>
        {[0, 1].map((index) => (
          <Skeleton key={index} variant="text" className="w-full max-w-md" />
        ))}
      </div>
    )
  if (lines.length === 0)
    return (
      <p className={`${PANEL} text-sm text-muted`}>
        {t('clientPoNoEquipment')}
      </p>
    )

  return (
    <div className={PANEL}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="pb-2 text-start font-normal">
              {t('supplierPoEquipmentField')}
            </th>
            <th className="hidden pb-2 text-start font-normal sm:table-cell">
              {t('equipmentType')}
            </th>
            <th className="pb-2 pe-3 text-start font-normal">
              {t('supplierPoRateUnit')}
            </th>
            <th className="pb-2 text-end font-normal">{t('salePrice')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const unit = line.card?.equipment ?? null
            return (
              <tr key={line.id} className="border-t border-border">
                <td className="py-2.5 pe-3">
                  <PurchasingUnitCell unit={unit} />
                </td>
                <td className="hidden py-2.5 pe-3 text-muted sm:table-cell">
                  {unit?.type ?? '—'}
                </td>
                <td className="whitespace-nowrap py-2.5 pe-3 text-muted">
                  {t(SALE_RATE_UNIT_LABEL_KEYS[saleRateUnitOf(line.rate_unit)])}
                </td>
                <td className="py-2.5 text-end">
                  {line.price === null ? (
                    <Badge tone="warning" size="sm">
                      {t('supplierPoNoPrice')}
                    </Badge>
                  ) : (
                    <SalePrice value={line.price} />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
