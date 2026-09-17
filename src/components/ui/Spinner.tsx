import { Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export type SpinnerSize = 'sm' | 'md' | 'lg'

const SIZES: Record<SpinnerSize, number> = { sm: 14, md: 20, lg: 28 }

export interface SpinnerProps {
  size?: SpinnerSize
  /** Accessible name; defaults to the shared "loading" string. */
  label?: string
  className?: string
}

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const { t } = useI18n()
  return (
    <Loader2
      role="status"
      aria-label={label ?? t('loading')}
      size={SIZES[size]}
      className={cn('animate-spin text-muted', className)}
    />
  )
}
