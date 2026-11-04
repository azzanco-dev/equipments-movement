import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Notice, Textarea } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  cardPricingReturnSchema,
  validateWithSchema,
} from '@/lib/formValidation'
import { CARD_MONTH_NOTE_MAX, cardPricingFormMessage } from '@/lib/sales'
import {
  approveEquipmentCardPricing,
  returnEquipmentCardPricing,
} from '@/lib/salesData'

/** The card a pricing dialog acts on: its id and the unit's code. */
export interface CardPricingTarget {
  card_id: string
  equipment_code: string | null
}

/**
 * «اعتماد» of a card's pricing (migration 0174, owner 2026-11-04): the
 * client price is locked by it, and when every unit of the supplier PO is
 * approved the supplier PO becomes approved too, so the dialog says so
 * before the call. Saves through `approve_equipment_card_pricing`, which
 * re-checks `sales.approve`, the draft state and both prices; a refusal
 * shows its mapped message, never the raw error.
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
      title={t('cardPricingApproveConfirmTitle').replace(
        '{unit}',
        card?.equipment_code ?? '—',
      )}
      description={t('cardPricingApproveConfirmDesc')}
      size="sm"
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
            {t('cardPricingApprove')}
          </Button>
        </>
      }
    >
      {message && (
        <Notice tone="danger" size="compact">
          {t(message)}
        </Notice>
      )}
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
      title={t('cardPricingReturnConfirmTitle').replace(
        '{unit}',
        card?.equipment_code ?? '—',
      )}
      description={t('cardPricingReturnConfirmDesc')}
      size="sm"
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
            {t('cardPricingReturn')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
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
