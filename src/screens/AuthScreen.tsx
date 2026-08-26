import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { useTheme } from '@/theme/ThemeContext';
import { Sun, Moon, Languages, AlertCircle } from 'lucide-react';
import { PasswordInput } from '@/components/PasswordInput';
import { useRouter } from 'next/navigation';

export function AuthScreen() {
  const router = useRouter();
  const { t, toggleLanguage, lang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await signIn(email, password);
    if (error) {
      setError(t(error));
    } else {
      router.replace('/dashboard');
    }

    setLoading(false);
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      {/* Top controls */}
      <div className="absolute top-4 end-4 flex items-center gap-1.5 z-10">
        <button onClick={toggleLanguage} className="btn-ghost p-2" title={t('toggleLanguage')}>
          <Languages size={18} />
          <span className="text-xs font-medium">{lang === 'ar' ? 'EN' : 'ع'}</span>
        </button>
        <button onClick={toggleTheme} className="btn-ghost p-2" title={t('toggleTheme')}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-5 flex flex-col items-center sm:mb-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black dark:bg-white mb-4">
              <span className="text-white dark:text-black font-bold text-2xl">E</span>
            </div>
            <h1 className="text-xl font-bold">{t('appName')}</h1>
            <p className="text-sm text-muted mt-1">{t('appSubtitle')}</p>
          </div>

          {/* Auth card */}
          <div className="card">
            <div className="mb-6">
              <h2 className="text-lg font-bold mb-1">{t('signIn')}</h2>
              <p className="text-sm text-muted">{t('signInSubtitle')}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">{t('email')}</label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')}
                  required
                  dir="ltr"
                />
              </div>
              <div>
                <label className="label">{t('password')}</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder')}
                  required
                  dir="ltr"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--fg)' }}>
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? t('loading') : t('signInButton')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
