import { useAuth } from '@/auth/AuthContext'
import { VisitsTable } from '@/components/visits/VisitsTable'

export interface HomeVisitsTableProps {
  /** Workshop roles list workshop visits; a foreman lists their own site ones. */
  workshopMode: boolean
  /** Opens the movement detail of one side of the visit. */
  onSelectMovement: (id: string) => void
  /** Bumped by the screen after a mutation so the tab refetches. */
  refreshToken: number
}

/**
 * The visits tab of the home movements card.
 *
 * The table itself is the shared `VisitsTable` (also used by the admin log's
 * visits view); this wrapper only picks the home's context and scope: the
 * workshop roles see workshop visits, a foreman sees the site visits whose
 * ENTRY they recorded. The list state stays under the `v` URL prefix so it
 * never collides with the log tab's own state and Back restores both.
 */
export function HomeVisitsTable({
  workshopMode,
  onSelectMovement,
  refreshToken,
}: HomeVisitsTableProps) {
  const { user } = useAuth()
  // The foreman scope needs the signed-in user; never list unscoped.
  if (!user) return null
  return (
    <VisitsTable
      context={workshopMode ? 'workshop' : 'site'}
      supervisorId={workshopMode ? undefined : user.id}
      onSelectMovement={onSelectMovement}
      refreshToken={refreshToken}
      urlPrefix="v"
    />
  )
}
