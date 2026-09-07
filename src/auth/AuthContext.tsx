import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  profileLoadError: boolean
  retryProfile: () => Promise<void>
  refreshProfile: () => Promise<void>
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: SignInError | null }>
  signOut: () => Promise<void>
}

export type SignInError =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'tooManySignInAttempts'
  | 'authConnectionError'
  | 'authError'

function mapSignInError(error: {
  code?: string
  status?: number
}): SignInError {
  if (error.code === 'email_not_confirmed') return 'emailNotConfirmed'
  if (error.status === 429 || error.code === 'over_request_rate_limit')
    return 'tooManySignInAttempts'
  if (error.code === 'invalid_credentials' || error.status === 400)
    return 'invalidCredentials'
  return 'authError'
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoadError, setProfileLoadError] = useState(false)
  const currentUserIdRef = useRef<string | null>(null)

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.error('Error fetching profile:', error.code)
      throw error
    }
    return data as Profile | null
  }, [])

  useEffect(() => {
    let active = true
    let revision = 0
    let deferred: ReturnType<typeof setTimeout> | undefined

    const applySession = (session: Session | null) => {
      const userId = session?.user.id ?? null
      if (userId === currentUserIdRef.current && userId) {
        setSession(session)
        return
      }
      const request = ++revision
      clearTimeout(deferred)
      currentUserIdRef.current = userId
      setSession(session)
      setUser(session?.user ?? null)
      setProfile(null)
      setProfileLoadError(false)
      setLoading(Boolean(session))
      if (!userId) return
      // Supabase queries must start after the auth callback releases its lock.
      deferred = setTimeout(async () => {
        try {
          const nextProfile = await fetchProfile(userId)
          if (!active || request !== revision) return
          setProfile(nextProfile)
          setProfileLoadError(!nextProfile)
        } catch {
          if (!active || request !== revision) return
          setProfileLoadError(true)
        } finally {
          if (active && request === revision) setLoading(false)
        }
      }, 0)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // INITIAL_SESSION initializes the provider without a duplicate getSession.
      if (active) applySession(session)
    })

    return () => {
      active = false
      currentUserIdRef.current = null
      clearTimeout(deferred)
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const signIn = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<{ error: SignInError | null }> => {
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) return { error: mapSignInError(error) }

        return { error: null }
      } catch {
        return { error: 'authConnectionError' }
      }
    },
    [],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    try {
      const nextProfile = await fetchProfile(user.id)
      if (currentUserIdRef.current !== user.id) return
      setProfile(nextProfile)
      setProfileLoadError(!nextProfile)
    } catch {
      if (currentUserIdRef.current === user.id) setProfileLoadError(true)
    }
  }, [fetchProfile, user])

  const retryProfile = useCallback(async () => {
    if (!user) return
    setLoading(true)
    await refreshProfile()
    setLoading(false)
  }, [refreshProfile, user])

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        profileLoadError,
        retryProfile,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
