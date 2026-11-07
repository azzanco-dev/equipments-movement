import { ArrowLeft } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Button } from './Button'
import { cn } from './cn'

export interface BackButtonProps {
  onClick: () => void
  /** Defaults to the shared "back" string. */
  label?: string
  className?: string
}

/** A ghost button with a direction-aware chevron (mirrored in RTL via the
 * shared `.rtl-flip` utility, same as the rest of the app). */
export function BackButton({ onClick, label, className }: BackButtonProps) {
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn('-ms-2', className)}
      icon={<ArrowLeft size={16} aria-hidden="true" className="rtl-flip" />}
    >
      {label ?? t('back')}
    </Button>
  )
}
