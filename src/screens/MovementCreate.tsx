import type { MovementType } from '@/lib/types'
import { EntryExitForm } from '@/components/EntryExitForm'

export function MovementCreate({
  movementType,
  onClose,
  onViewMovement,
  onGoHome,
}: {
  movementType: MovementType
  onClose: () => void
  onViewMovement: (id: string) => void
  onGoHome: () => void
}) {
  return (
    <EntryExitForm
      open
      movementType={movementType}
      pageMode
      onClose={onClose}
      onSaved={() => undefined}
      onViewMovement={onViewMovement}
      onGoHome={onGoHome}
    />
  )
}
