import { createClient } from '@supabase/supabase-js'
import { recordAuthDebug } from '@/lib/authDiagnostics'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// The only sign-in is email + password inside the app (signInWithPassword);
// there is no OAuth, magic-link, OTP or recovery redirect. URL session
// detection would let any page URL whose fragment carries another account's
// tokens replace the signed-in user's session (security audit run-1,
// em:client:supabase:detectSessionInUrl:implicit-fragment-session-replacement),
// so it stays off. tests/authClientOptions.test.cjs guards this.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    // EM-174: the client's debug lines go to this hook, which keeps only
    // the last refresh error so an automatic sign-out can name its cause
    // on the login screen (src/lib/authDiagnostics.ts). Nothing is printed.
    debug: recordAuthDebug,
  },
})
