import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: SignInError | null }>;
  signOut: () => Promise<void>;
}

export type SignInError =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'tooManySignInAttempts'
  | 'authConnectionError'
  | 'authError';

function mapSignInError(error: { code?: string; status?: number }): SignInError {
  if (error.code === 'email_not_confirmed') return 'emailNotConfirmed';
  if (error.status === 429 || error.code === 'over_request_rate_limit') return 'tooManySignInAttempts';
  if (error.code === 'invalid_credentials' || error.status === 400) return 'invalidCredentials';
  return 'authError';
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUserIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return data as Profile | null;
  }, []);

  useEffect(() => {
    let active = true;

    const applySession = async (session: Session | null) => {
      const nextProfile = session?.user ? await fetchProfile(session.user.id) : null;
      if (!active) return;
      currentUserIdRef.current = session?.user.id ?? null;
      setSession(session);
      setUser(session?.user ?? null);
      setProfile(nextProfile);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data: { session } }) => applySession(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === currentUserIdRef.current) {
        // Token refreshes and tab focus events can repeat the same session.
        // Keep the user/profile references stable so screens do not refetch.
        setSession(session);
        return;
      }
      void applySession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (
    email: string,
    password: string,
  ): Promise<{ error: SignInError | null }> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: mapSignInError(error) };

      const nextProfile = await fetchProfile(data.user.id);
      currentUserIdRef.current = data.user.id;
      setSession(data.session);
      setUser(data.user);
      setProfile(nextProfile);
      setLoading(false);
      return { error: null };
    } catch {
      return { error: 'authConnectionError' };
    }
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    setProfile(await fetchProfile(user.id));
  }, [fetchProfile, user]);

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
