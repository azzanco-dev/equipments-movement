import { useSearchParams } from 'next/navigation'
import type { MovementType } from '@/lib/types'
import { EntryExitForm } from '@/components/EntryExitForm'
import {
  EXIT_LINK_EQUIPMENT_PARAM,
  equipmentCodeFromLinkParam,
} from '@/lib/movementExitLink'

export function MovementCreate({
  movementType,
  onClose,
  onViewMovement,
  onGoHome,
  workshopForm = false,
}: {
  movementType: MovementType
  /** The workshop form whatever else the user holds (the workshop home). */
  workshopForm?: boolean
  onClose: () => void
  onViewMovement: (id: string) => void
  onGoHome: () => void
}) {
  // The «ابلاغ الفورمان» link opens /movements/new?type=exit&equipment=CODE:
  // an EXIT starts with that code searched (and the unit selected when the
  // search finds exactly it). An ENTRY ignores the parameter.
  const searchParams = useSearchParams()
  const initialEquipmentCode =
    movementType === 'exit'
      ? equipmentCodeFromLinkParam(searchParams.get(EXIT_LINK_EQUIPMENT_PARAM))
      : null
  return (
    <EntryExitForm
      open
      movementType={movementType}
      pageMode
      initialEquipmentCode={initialEquipmentCode}
      forceWorkshopForm={workshopForm}
      onClose={onClose}
      onSaved={() => undefined}
      onViewMovement={onViewMovement}
      onGoHome={onGoHome}
    />
  )
}
