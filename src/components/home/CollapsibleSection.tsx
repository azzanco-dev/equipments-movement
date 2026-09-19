import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { translations, type Language } from '@/i18n/translations'
import { Card, SectionHeader } from '@/components/ui/Card'
import { cn } from '@/components/ui/cn'

export interface CollapsibleSectionProps {
  title: ReactNode
  /** Short supporting line under the title. */
  description?: ReactNode
  /** Trailing slot (a link, a filter); it stays outside the toggle button. */
  action?: ReactNode
  /** Open on first render; the section keeps its own state afterwards. */
  defaultOpen?: boolean
  /** Controlled open state; pass `onOpenChange` with it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Heading level, so the page keeps a correct outline. */
  as?: 'h2' | 'h3' | 'h4'
  /** Overrides the ambient interface language for the toggle label. */
  lang?: Language
  /** Emphasizes the section with a stronger border. */
  highlight?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
}

/**
 * A dashboard card whose body can be folded away. The heading holds the toggle
 * button (the ARIA accordion pattern), so screen readers announce the state and
 * the whole section stays one landmark.
 */
export function CollapsibleSection({
  title,
  description,
  action,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  as = 'h3',
  lang: langOverride,
  highlight = false,
  className,
  bodyClassName,
  children,
}: CollapsibleSectionProps) {
  const { lang: ambientLang } = useI18n()
  const lang = langOverride ?? ambientLang
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const bodyId = useId()

  const toggle = () => {
    const next = !open
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const label =
    translations[lang][open ? 'collapseSection' : 'expandSection'] ??
    translations.ar[open ? 'collapseSection' : 'expandSection']

  return (
    <Card
      className={cn(
        'space-y-3',
        highlight && 'border-warning',
        !open && 'space-y-0',
        className,
      )}
    >
      <SectionHeader
        as={as}
        description={open ? description : undefined}
        action={action}
        title={
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={
              typeof title === 'string' ? `${title}: ${label}` : label
            }
            className="-m-1 flex items-center gap-2 rounded-lg p-1 text-start transition-colors hover:text-muted"
          >
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={cn(
                'shrink-0 text-muted transition-transform',
                !open && 'ltr:-rotate-90 rtl:rotate-90',
              )}
            />
            <span className="min-w-0">{title}</span>
          </button>
        }
      />
      <div id={bodyId} hidden={!open} className={cn(open && bodyClassName)}>
        {children}
      </div>
    </Card>
  )
}
