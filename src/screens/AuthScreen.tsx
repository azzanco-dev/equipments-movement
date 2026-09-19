import { useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { useTheme } from '@/theme/ThemeContext'
import { Sun, Moon, Languages } from 'lucide-react'
import { PasswordInput } from '@/components/PasswordInput'
import { Alert } from '@/components/Alert'
import { Button, Field, IconButton, Input } from '@/components/ui'
import { useRouter } from 'next/navigation'

export function AuthScreen() {
  const router = useRouter()
  const { t, toggleLanguage, lang } = useI18n()
  const { theme, toggleTheme } = useTheme()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await signIn(email, password)
    if (error) {
      setError(t(error))
    } else {
      router.replace('/dashboard')
    }

    setLoading(false)
  }

  return (
    <div
      className="flex min-h-[100dvh] flex-col"
      style={{ background: 'var(--bg)', color: 'var(--fg)' }}
    >
      {/* Top controls */}
      <div className="absolute top-4 end-4 flex items-center gap-1.5 z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLanguage}
          title={t('toggleLanguage')}
          icon={<Languages size={16} />}
        >
          {lang === 'ar' ? 'EN' : 'ع'}
        </Button>
        <IconButton
          label={t('toggleTheme')}
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-20">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-5 flex flex-col items-center sm:mb-8">
            <img
              src="/azzanco-logo.png"
              alt=""
              aria-hidden="true"
              className="mb-4 h-14 w-14 rounded-2xl object-contain"
            />
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
              <Field label={t('email')} required>
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="username"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('emailPlaceholder')}
                    dir="ltr"
                  />
                )}
              </Field>
              <Field label={t('password')} required>
                {(control) => (
                  <PasswordInput
                    {...control}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('passwordPlaceholder')}
                  />
                )}
              </Field>

              {error && <Alert type="error">{error}</Alert>}

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                className="w-full"
              >
                {t('signInButton')}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
