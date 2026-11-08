import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { IconButton } from '@/components/ui/Button'

export function DataListActions({
  menuActions,
  primaryAction,
}: {
  menuActions?: ReactNode
  primaryAction?: ReactNode
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div className="flex items-center gap-2" ref={ref}>
      {menuActions && (
        <div className="relative">
          {/* Beside the page header's primary action (a default-size
              Button), so it takes the same default height. */}
          <IconButton
            variant="outline"
            onClick={() => setOpen((value) => !value)}
            label={t('moreActions')}
            icon={<MoreHorizontal size={18} />}
          />
          {open && (
            <div
              className="absolute end-0 top-[calc(100%+6px)] z-40 min-w-[180px] space-y-1 rounded-lg border p-1.5 shadow-xl [&>button]:w-full [&>button]:justify-start"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              onClick={() => setOpen(false)}
            >
              {menuActions}
            </div>
          )}
        </div>
      )}
      {primaryAction}
    </div>
  )
}
