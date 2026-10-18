// Security audit run-1 (em:client:supabase:detectSessionInUrl:implicit-fragment-session-replacement).
//
// The browser Supabase client must never take a session from the page URL:
// the app signs in only with email + password (signInWithPassword) and has no
// OAuth, magic-link, OTP or recovery redirect, so `detectSessionInUrl` has no
// legitimate consumer. With it on, a link whose fragment carries another
// account's tokens would replace the signed-in user's stored session in every
// tab. These source checks keep the option off (and the flow type PKCE) and
// make sure no redirect-based sign-in is introduced without revisiting them.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

test('the browser client keeps URL session detection off', () => {
  const src = read('src', 'lib', 'supabase.ts')
  const auth = src.match(/auth:\s*\{([\s\S]*?)\}/)
  assert.ok(auth, 'createClient has an auth options block')
  assert.match(auth[1], /detectSessionInUrl:\s*false/, 'detectSessionInUrl must be false')
  assert.doesNotMatch(auth[1], /detectSessionInUrl:\s*true/)
  assert.match(auth[1], /flowType:\s*'pkce'/, 'flowType stays pkce as a second line of defence')
})

test('no redirect-based sign-in exists that would need URL session detection', () => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(ROOT, 'src'))
  walk(path.join(ROOT, 'app'))
  // Supabase auth methods that hand a session over through a redirect URL
  // (matched as `.auth.<method>(` so React state setters such as setSession() do not trip it).
  const forbidden = /\.auth\s*\.\s*(signInWithOAuth|signInWithOtp|verifyOtp|resetPasswordForEmail|exchangeCodeForSession|setSession|signInWithSSO|signInWithIdToken)\s*\(/
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(
      text,
      forbidden,
      `${path.relative(ROOT, file)} introduces a redirect-based auth flow; revisit detectSessionInUrl in src/lib/supabase.ts first`,
    )
  }
})
