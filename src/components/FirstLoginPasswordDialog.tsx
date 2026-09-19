import { useState } from 'react'
import { Button, Dialog, Field } from '@/components/ui'
import { PasswordInput } from '@/components/PasswordInput'
import { Alert } from '@/components/Alert'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import { supabase } from '@/lib/supabase'

export function FirstLoginPasswordDialog() {
  const { profile, session, refreshProfile } = useAuth()
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const required = Boolean(profile?.must_change_password)

  async function submit() {
    setError(null)
    if (password.length < 8) {
      setError(t('passwordMinLength'))
      return
    }
    if (password !== confirmation) {
      setError(t('passwordsDoNotMatch'))
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
      description={t('firstLoginPasswordDescription')}
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
      <div className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        <Field label={t('newPassword')} required>
          {(control) => (
            <PasswordInput
              {...control}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Field label={t('confirmPassword')} required>
          {(control) => (
            <PasswordInput
              {...control}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
