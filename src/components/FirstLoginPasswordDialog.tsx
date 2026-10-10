import { useRef, useState } from 'react'
import { Button, Dialog, Field } from '@/components/ui'
import { PasswordInput } from '@/components/PasswordInput'
import { Alert } from '@/components/Alert'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import { supabase } from '@/lib/supabase'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  passwordChangeFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'

interface PasswordChangeValues {
  password: string
  confirmation: string
}
const PASSWORD_FIELD_ORDER = ['password', 'confirmation'] as const

export function FirstLoginPasswordDialog() {
  const { profile, session, refreshProfile } = useAuth()
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<PasswordChangeValues>
  >({})
  const bodyRef = useRef<HTMLDivElement>(null)

  const required = Boolean(profile?.must_change_password)

  async function submit() {
    setError(null)
    // At least 8 characters, typed the same twice; each message goes under
    // the field it is about.
    const invalid = validateWithSchema(passwordChangeFormSchema, {
      password,
      confirmation,
    })
    setFieldErrors(invalid)
    if (hasErrors(invalid)) {
      focusFirstError(invalid, PASSWORD_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    if (!session) return

    setSaving(true)
    try {
      await callEdgeFunction('manage-user', {
        action: 'change_own_password',
        password,
      })
      const email = session.user.email
      if (!email) throw new Error('missing email')
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) throw signInError
      await refreshProfile()
      setPassword('')
      setConfirmation('')
    } catch (cause) {
      setError(
        cause instanceof EdgeFunctionError && cause.code === 'network'
          ? t('networkConnectionError')
          : cause instanceof EdgeFunctionError &&
              cause.code === 'sessionExpired'
            ? t('sessionExpiredError')
            : cause instanceof EdgeFunctionError && cause.code === 'server'
              ? t('serverTemporaryError')
              : t('changePasswordError'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    // No way to skip: `dismissible={false}` hides the close button and
    // blocks Escape/outside-click, and `onOpenChange` here never turns
    // `open` off on its own — only a successful password change (which
    // flips `profile.must_change_password` server-side) does.
    <Dialog
      open={required}
      onOpenChange={() => undefined}
      dismissible={false}
      title={t('firstLoginPasswordTitle')}
      description={t('dialogDescFirstLoginPassword')}
      size="sm"
      footer={
        <Button
          variant="primary"
          className="w-full"
          loading={saving}
          onClick={submit}
        >
          {t('confirm')}
        </Button>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        <Field
          label={t('newPassword')}
          name="password"
          required
          error={fieldErrors.password && t(fieldErrors.password)}
        >
          {(control) => (
            <PasswordInput
              {...control}
              value={password}
              onChange={(event) => {
                setFieldErrors((current) =>
                  clearFieldErrors(current, ['password']),
                )
                setPassword(event.target.value)
              }}
            />
          )}
        </Field>
        <Field
          label={t('confirmPassword')}
          name="confirmation"
          required
          error={fieldErrors.confirmation && t(fieldErrors.confirmation)}
        >
          {(control) => (
            <PasswordInput
              {...control}
              value={confirmation}
              onChange={(event) => {
                setFieldErrors((current) =>
                  clearFieldErrors(current, ['confirmation']),
                )
                setConfirmation(event.target.value)
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
