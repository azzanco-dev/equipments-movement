import { useEffect, useState } from 'react'
import { Badge, Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import {
  SUPPLIER_PO_LINE_SELECT,
  type SupplierPoLineRow,
} from '@/lib/purchasingData'
import { supabase } from '@/lib/supabase'
import { Price } from './Price'
import { PurchasingUnitCell } from './PurchasingUnitCell'

/**
 * The equipment of one PO inside its opened row in the PO list (owner
 * 2026-10-24, the «اوامر · فتح صف» idea of app/po-test): unit, type, period
 * and price, unpriced lines marked. Loads the PO's lines when it mounts, i.e.
 * only for the row that is open; a PO holds a handful of lines.
 */
export function SupplierPoLinesPanel({ poId }: { poId: string }) {
  const { t } = useI18n()
  const [lines, setLines] = useState<SupplierPoLineRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    supabase
      .from('supplier_po_equipment')
      .select(SUPPLIER_PO_LINE_SELECT)
      .eq('supplier_po_id', poId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (controller.signal.aborted) return
        if (error) setFailed(true)
        else setLines((data as unknown as SupplierPoLineRow[] | null) ?? [])
      })
    return () => controller.abort()
  }, [poId])

  if (failed)
    return (
      <p role="alert" className="px-4 py-3 text-sm text-danger">
        {t('dataLoadError')}
      </p>
    )
  if (!lines)
    return (
      <div className="space-y-2 px-4 py-3" aria-busy="true">
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
      <p className="px-4 py-3 text-sm text-muted">
        {t('supplierPoNoEquipment')}
      </p>
    )

  return (
    <div className="px-4 py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="pb-1.5 text-start font-normal">
              {t('supplierPoEquipmentField')}
            </th>
            <th className="hidden pb-1.5 text-start font-normal sm:table-cell">
              {t('equipmentType')}
            </th>
            <th className="hidden pb-1.5 text-start font-normal md:table-cell">
              {t('equipmentPurchasingPeriod')}
            </th>
            <th className="pb-1.5 text-end font-normal">
              {t('supplierPoPrice')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const unit = line.card?.equipment ?? null
            return (
              <tr key={line.id} className="border-t border-border">
                <td className="py-1.5 pe-3">
                  <PurchasingUnitCell unit={unit} />
                </td>
                <td className="hidden py-1.5 pe-3 text-muted sm:table-cell">
                  {unit?.type ?? '—'}
                </td>
                <td className="hidden whitespace-nowrap py-1.5 pe-3 text-muted md:table-cell">
                  {line.card ? (
                    <bdi dir="ltr">
                      {formatDate(line.card.period_from)} –{' '}
                      {line.card.period_to
                        ? formatDate(line.card.period_to)
                        : t('equipmentPurchasingOpenEnd')}
                    </bdi>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-1.5 text-end">
                  {line.price === null ? (
                    <Badge tone="warning" size="sm">
                      {t('supplierPoNoPrice')}
                    </Badge>
                  ) : (
                    <Price value={line.price} />
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
