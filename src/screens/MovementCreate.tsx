import type { MovementType } from '@/lib/types';
import { EntryExitForm } from '@/components/EntryExitForm';

export function MovementCreate({ movementType, onClose, onViewMovement }: { movementType: MovementType; onClose: () => void; onViewMovement: (id: string) => void }) {
  return <EntryExitForm open movementType={movementType} pageMode onClose={onClose} onSaved={() => undefined} onViewMovement={onViewMovement} />;
}
