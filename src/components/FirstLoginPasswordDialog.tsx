import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { PasswordInput } from '@/components/PasswordInput';
import { Alert } from '@/components/Alert';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { supabase } from '@/lib/supabase';

export function FirstLoginPasswordDialog() {
  const { profile, session, refreshProfile } = useAuth();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const required = Boolean(profile?.must_change_password);

  async function submit() {
    setError(null);
    if (password.length < 8) { setError(t('passwordMinLength')); return; }
    if (password !== confirmation) { setError(t('passwordsDoNotMatch')); return; }
    if (!session) return;

    setSaving(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'change_own_password', password }),
      });
      if (!response.ok) throw new Error('change failed');
      const email = session.user.email;
      if (!email) throw new Error('missing email');
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      await refreshProfile();
      setPassword('');
      setConfirmation('');
    } catch {
      setError(t('changePasswordError'));
    } finally {
      setSaving(false);
    }
  }

  return <Modal open={required} onClose={() => undefined} title={t('firstLoginPasswordTitle')} size="sm" dismissible={false}>
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('firstLoginPasswordDescription')}</p>
      {error && <Alert type="error">{error}</Alert>}
      <div><label className="label">{t('newPassword')} *</label><PasswordInput dir="ltr" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <div><label className="label">{t('confirmPassword')} *</label><PasswordInput dir="ltr" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
      <button type="button" className="btn-primary w-full" disabled={saving} onClick={submit}>{saving ? t('saving') : t('confirm')}</button>
    </div>
  </Modal>;
}
