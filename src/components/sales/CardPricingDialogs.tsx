import { useEffect, useState } from 'react'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import {
  Button,
  DescriptionList,
  Dialog,
  Field,
  Notice,
  Textarea,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  cardPricingReturnSchema,
  validateWithSchema,
} from '@/lib/formValidation'
import {
  CARD_MONTH_NOTE_MAX,
  cardMargin,
  cardMarginPct,
  cardPricingFormMessage,
  formatMarginPct,
  type SaleRateUnit,
} from '@/lib/sales'
import {
  approveEquipmentCardPricing,
  returnEquipmentCardPricing,
} from '@/lib/salesData'
import { CardSupplierPriceCell } from './CardPricingCells'
import { SalePrice } from './SalePrice'

/**
 * The card a pricing dialog acts on: its id, the unit's code and, when the
 * caller has them, the facts the dialog shows before the decision (owner
 * 2026-11-04, «حسن الـ dialog حق الاعتماد … والوصف»): the client price, the
 * supplier price with its unit and the supplier PO's number.
 */
export interface CardPricingTarget {
  card_id: string
  equipment_code: string | null
  client_price?: number | string | null
  /** 0185: the unit of the client price (month when unknown). */
  client_price_unit?: SaleRateUnit | null
  supplier_price?: number | string | null
  supplier_rate_unit?: SaleRateUnit | null
  supplier_po_number?: string | null
}

const unitOf = (card: CardPricingTarget | null) => card?.equipment_code ?? '—'
const poOf = (card: CardPricingTarget | null) => card?.supplier_po_number ?? '—'

/** The prices and the margin the decision is about, as a two-column list. */
function PricingFacts({ card }: { card: CardPricingTarget }) {
  const { t } = useI18n()
  const clientUnit = card.client_price_unit ?? 'month'
  const margin = cardMargin(
    card.client_price,
    clientUnit,
    card.supplier_price,
    card.supplier_rate_unit,
  )
  const pct = cardMarginPct(margin, card.client_price)
  const dash = <span className="text-muted">—</span>
  return (
    <DescriptionList
      columns={2}
      className="rounded-lg border bg-surface px-3 py-1"
      items={[
        {
          key: 'client',
          label: t('cardPriceClient'),
          value:
            card.client_price === null || card.client_price === undefined ? (
              dash
            ) : (
              <CardSupplierPriceCell
                price={card.client_price}
                rateUnit={clientUnit}
                className="font-semibold"
              />
            ),
        },
        {
          key: 'supplier',
          label: t('cardPriceSupplier'),
          value:
            card.supplier_price === null ||
            card.supplier_price === undefined ? (
              dash
            ) : (
              <CardSupplierPriceCell
                price={card.supplier_price}
                rateUnit={card.supplier_rate_unit}
                className="font-semibold"
              />
            ),
        },
        {
          key: 'margin',
          label: t('equipmentCardMargin'),
          value:
            margin === null ? (
              dash
            ) : (
              <span className="inline-flex flex-wrap items-baseline gap-x-2">
                <SalePrice value={margin} className="font-semibold" />
                <span className="text-xs text-muted">
                  {formatMarginPct(pct)}
                </span>
              </span>
            ),
        },
        {
          key: 'po',
          label: t('supplierPo'),
          value: card.supplier_po_number ? (
            <bdi dir="ltr" className="font-semibold">
              {card.supplier_po_number}
            </bdi>
          ) : (
            dash
          ),
        },
      ]}
    />
  )
}

/**
 * «اعتماد» of a card's pricing (migration 0174, owner 2026-11-04): the
 * dialog asks the question the owner worded («هل انت متاكد من اعتماد السعر؟
 * فبالتالي اعتماد امر شراء المورد»), shows the prices and the margin it
 * decides on, and says what follows: the client price is locked, and when
 * every unit of the supplier PO is approved the supplier PO becomes approved
 * too. Saves through `approve_equipment_card_pricing`, which re-checks
 * `sales.approve`, the draft state and both prices; a refusal shows its
 * mapped message, never the raw error.
 */
export function ApproveCardPricingDialog({
  card,
  open,
  onOpenChange,
  onApproved,
}: {
  card: CardPricingTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApproved: (card: CardPricingTarget) => void
}) {
  const { t } = useI18n()
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setMessage(null)
    setSaving(false)
  }, [open])

  const approve = async () => {
    if (!card || saving) return
    setSaving(true)
    setMessage(null)
    const result = await approveEquipmentCardPricing(card.card_id)
    setSaving(false)
    if (result.error) {
      setMessage(cardPricingFormMessage(result.error))
      return
    }
    onApproved(card)
  }

  return (
    <Dialog
      open={open && card !== null}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 size={18} aria-hidden="true" className="text-success" />
          {t('cardPricingApproveConfirmTitle').replace('{unit}', unitOf(card))}
        </span>
      }
      description={t('cardPricingApproveConfirmDesc')}
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={approve}>
            {t('cardPricingApproveConfirmButton')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {card && <PricingFacts card={card} />}
        <Notice tone="info" size="compact">
          {t('cardPricingApproveConsequence')}
        </Notice>
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}

/**
 * «رجوع للتعديل»: the pricing goes back to draft (and an approved OPEN
 * supplier PO back to draft with it) with an optional note, kept for the
 * reasons the owner may ask for later. Saves through
 * `return_equipment_card_pricing` (`sales.approve`).
 */
export function ReturnCardPricingDialog({
  card,
  open,
  onOpenChange,
  onReturned,
}: {
  card: CardPricingTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onReturned: (card: CardPricingTarget) => void
}) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<TranslationKey | null>(null)
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setNote('')
    setNoteError(null)
    setMessage(null)
    setSaving(false)
  }, [open])

  const submit = async () => {
    if (!card || saving) return
    const errors = validateWithSchema(cardPricingReturnSchema, { note })
    if (errors.note) {
      setNoteError(errors.note)
      return
    }
    setSaving(true)
    setMessage(null)
    const result = await returnEquipmentCardPricing({
      cardId: card.card_id,
      note,
    })
    setSaving(false)
    if (result.error) {
      setMessage(cardPricingFormMessage(result.error))
      return
    }
    onReturned(card)
  }

  return (
    <Dialog
      open={open && card !== null}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <RotateCcw size={18} aria-hidden="true" className="text-warning" />
          {t('cardPricingReturnConfirmTitle').replace('{unit}', unitOf(card))}
        </span>
      }
      description={t('cardPricingReturnConfirmDesc').replace(
        '{po}',
        poOf(card),
      )}
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            {t('cardPricingReturnConfirmButton')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {card && <PricingFacts card={card} />}
        <Notice tone="warning" size="compact">
          {t('cardPricingReturnConsequence')}
        </Notice>
        <Field
          label={t('cardPricingReturnNote')}
          error={noteError ? t(noteError) : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={CARD_MONTH_NOTE_MAX}
              value={note}
              onChange={(event) => {
                setNoteError(null)
                setNote(event.target.value)
              }}
            />
          )}
        </Field>
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}
