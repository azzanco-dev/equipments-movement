import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Input, type InputProps } from '@/components/ui/Input'
import { IconButton } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'

export type PasswordInputProps = Omit<InputProps, 'type' | 'endSlot'>

/**
 * Password field on the shared `Input`. Passwords are always Latin text, so
 * the wrapper fixes `dir="ltr"` on itself (not just the `<input>`): logical
 * `end-*` utilities resolve against the nearest direction, and without this
 * the eye toggle would inherit the ambient RTL document direction and land
 * on the wrong side.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const { t } = useI18n()
    const [visible, setVisible] = useState(false)

    return (
      <div dir="ltr" className={cn('relative', className)}>
        <Input
          ref={ref}
          {...props}
          dir="ltr"
          type={visible ? 'text' : 'password'}
          className="pe-9"
        />
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          label={visible ? t('hidePassword') : t('showPassword')}
          icon={visible ? <EyeOff size={16} /> : <Eye size={16} />}
          onClick={() => setVisible((value) => !value)}
          tabIndex={-1}
          className="absolute end-1 top-1/2 -translate-y-1/2"
        />
      </div>
    )
  },
)
