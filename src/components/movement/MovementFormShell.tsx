import type { ReactNode } from 'react'
import { Card, Dialog, PageHeader } from '@/components/ui'

export interface MovementFormShellProps {
  open: boolean
  onClose: () => void
  title: string
  /** Page mode renders the form as a normal page instead of a modal. */
  pageMode: boolean
  children: ReactNode
}

/**
 * Chrome around the movement form: the shared `PageHeader` + `Card` on the
 * dedicated `/movements/new` page, and the shared `Dialog` when the form is
 * opened as a modal.
 */
export function MovementFormShell({
  open,
  onClose,
  title,
  pageMode,
  children,
}: MovementFormShellProps) {
  if (pageMode) {
    if (!open) return null
    return (
      <section className="mx-auto w-full max-w-2xl space-y-4">
        <PageHeader title={title} onBack={onClose} />
        <Card>{children}</Card>
      </section>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={title}
      size="lg"
    >
      {children}
    </Dialog>
  )
}
