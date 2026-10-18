// Audit run-1 (2026-10-18), lead B-9 — the orphan cleanup of the movement
// photo bucket.
//
// * The Edge Function supabase/functions/storage-cleanup requires
//   `movements.photos.delete_any` through has_permission() evaluated AS THE
//   CALLER (the anon-key client carrying the caller's Authorization header);
//   the service role is created only after that check and used only for the
//   bucket-wide reads, the removals and the expired-batch delete.
// * It never deletes a referenced object (entry_exit_photos.file_path, the
//   legacy entry_exit_logs.photo_url, an unexpired staging batch), never
//   touches another bucket, and has a dry-run path that removes nothing.
// * Settings mounts the card for a holder of the same key only.
// Source checks only, like the rest of the suite.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

const fn = read('supabase', 'functions', 'storage-cleanup', 'index.ts')
/** The code without the comment lines. */
const code = fn
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')

test('the function decides by movements.photos.delete_any as the caller', () => {
  assert.match(
    fn,
    /const userClient = createClient\(supabaseUrl, anonKey, \{\s+global: \{ headers: \{ Authorization: authHeader \} \},\s+\}\)/,
  )
  assert.match(fn, /await userClient\.auth\.getUser\(\)/)
  assert.match(
    fn,
    /if \(userError \|\| !user\) return json\(\{ error: 'Unauthorized' \}, 401\)/,
  )
  assert.match(
    fn,
    /const \{ data: canDeleteAny, error: permissionError \} =\s+await userClient\.rpc\(\s+'has_permission',\s+\{\s+p_key: 'movements\.photos\.delete_any',\s+\},?\s+\)/,
  )
  assert.match(
    fn,
    /if \(permissionError \|\| canDeleteAny !== true\)\s+return json\(\{ error: 'Forbidden' \}, 403\)/,
  )
  assert.equal((code.match(/has_permission/g) ?? []).length, 1)
  assert.ok(!/canDeleteAny\)|canDeleteAny ===? false|!canDeleteAny/.test(fn))
  // The service-role client exists only after the check and never decides.
  const forbiddenAt = fn.indexOf('canDeleteAny !== true')
  const serviceAt = fn.indexOf('createClient(supabaseUrl, serviceRoleKey)')
  assert.ok(forbiddenAt > 0 && serviceAt > forbiddenAt)
  assert.ok(!/adminClient\.rpc\(/.test(fn))
  assert.ok(
    !/userClient\.(storage|from)\b/.test(fn),
    'the caller client only identifies',
  )
  // No role read anywhere.
  assert.ok(!/profiles|\.role\b/.test(code))
})

test('the body is {dry_run, older_than_hours} with a safe default and minimum', () => {
  assert.match(fn, /const dryRun = body\.dry_run !== false/)
  assert.match(fn, /const DEFAULT_OLDER_THAN_HOURS = 2\n/)
  assert.match(fn, /const MIN_OLDER_THAN_HOURS = 1\n/)
  assert.match(
    fn,
    /if \(value === undefined \|\| value === null\) return DEFAULT_OLDER_THAN_HOURS/,
  )
  assert.match(
    fn,
    /if \(value < MIN_OLDER_THAN_HOURS \|\| value > MAX_OLDER_THAN_HOURS\) return null/,
  )
  assert.match(fn, /if \(hours === null\)\s+return json\(/)
  assert.match(fn, /const cutoff = now - hours \* 60 \* 60 \* 1000/)
})

test('an orphan is an unreferenced object older than the cutoff; the references are complete', () => {
  assert.match(
    fn,
    /const orphans = objects\.filter\(\s+\(object\) => !referenced\.has\(object\.name\) && object\.createdAt <= cutoff,\s+\)/,
  )
  assert.match(
    fn,
    /columnValues\(\s*client,\s*'entry_exit_photos',\s*'file_path',?\s*\)/,
  )
  assert.match(
    fn,
    /columnValues\(\s*client,\s*'entry_exit_logs',\s*'photo_url',?\s*\)/,
  )
  assert.match(
    fn,
    /\.from\('pending_movement_photo_batches'\)\s+\.select\('file_paths'\)\s+\.gt\('expires_at', nowIso\)/,
  )
  // Every reference read is paged, never capped at one page.
  assert.match(fn, /\.range\(from, from \+ PAGE_SIZE - 1\)/)
  assert.match(fn, /if \(rows\.length < PAGE_SIZE\) break/)
  // An object of unknown age is treated as new, never deleted.
  assert.match(
    fn,
    /createdAt: Number\.isFinite\(createdAt\) \? createdAt : Date\.now\(\)/,
  )
  // The whole tree is walked (a listing entry without an id is a folder).
  assert.match(fn, /if \(entry\.id === null\) \{\s+folders\.push\(name\)/)
  assert.match(fn, /if \(entries\.length < PAGE_SIZE\) break/)
})

test('only the log-photos bucket is read or written', () => {
  assert.match(fn, /const BUCKET = 'log-photos'\n/)
  const buckets = [...code.matchAll(/storage\s*\.from\(([^)]*)\)/g)].map(
    (m) => m[1],
  )
  assert.ok(buckets.length >= 2, 'the bucket is listed and written')
  assert.deepEqual([...new Set(buckets)], ['BUCKET'])
  // The only tables touched are the two reference columns (read through
  // `columnValues`, whose `table` argument is one of them) and the batches.
  const froms = [...code.matchAll(/\.from\(([^)]*)\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(froms)].sort(), [
    "'pending_movement_photo_batches'",
    'BUCKET',
    'table',
  ])
  const columnReads = [
    ...code.matchAll(/columnValues\(\s*client,\s*'(\w+)',\s*'(\w+)',?\s*\)/g),
  ].map((m) => `${m[1]}.${m[2]}`)
  assert.deepEqual(columnReads.sort(), [
    'entry_exit_logs.photo_url',
    'entry_exit_photos.file_path',
  ])
  assert.ok(!/\.(move|copy|upload|update|upsert)\(/.test(code))
})

test('the dry run removes nothing; the real run deletes in batches of 100 then the expired batches', () => {
  const dryAt = fn.indexOf('if (dryRun) {')
  const removeAt = fn.indexOf('.remove(batch.map((object) => object.name))')
  assert.ok(dryAt > 0 && removeAt > dryAt)
  const dryBlock = fn.slice(dryAt, removeAt)
  assert.ok(!/\.remove\(|\.delete\(/.test(dryBlock), 'the dry run is read-only')
  assert.match(dryBlock, /return json\(\{\s+dry_run: true,/)
  assert.match(dryBlock, /folders: \[\.\.\.folders\.entries\(\)\]\.map\(/)
  // The dry-run report carries counts and bytes per uploader folder only.
  assert.match(
    dryBlock,
    /\(\[folder, entry\]\) => \(\{\s+folder,\s+objects: entry\.objects,\s+bytes: entry\.bytes,\s+\}\)/,
  )
  assert.ok(!/name/.test(dryBlock.slice(dryBlock.indexOf('return json'))))
  assert.match(fn, /const REMOVE_BATCH_SIZE = 100\n/)
  assert.match(
    fn,
    /for \(let at = 0; at < orphans\.length; at \+= REMOVE_BATCH_SIZE\) \{\s+const batch = orphans\.slice\(at, at \+ REMOVE_BATCH_SIZE\)/,
  )
  // The expired batches of every user go after the objects.
  const batchDelete = fn.indexOf(
    ".from('pending_movement_photo_batches')\n      .delete()\n      .lte('expires_at', nowIso)",
  )
  assert.ok(batchDelete > removeAt)
  assert.match(
    fn,
    /return json\(\{\s+dry_run: false,\s+older_than_hours: hours,\s+deleted_objects: deletedObjects,\s+freed_bytes: freedBytes,\s+deleted_batches: deletedBatches,\s+\}\)/,
  )
})

test('nothing sensitive is logged', () => {
  for (const call of code.matchAll(/console\.\w+\(([\s\S]*?)\)\n/g)) {
    assert.ok(
      !/\bname\b|\.file_path|\.photo_url|file_paths|authHeader|serviceRoleKey|user\.(id|email)/.test(
        call[1],
      ),
      call[0],
    )
  }
  assert.ok(!/console\.\w+\([^)]*error\)/.test(code), 'no raw error objects')
})

test('the Settings card exists for movements.photos.delete_any only and drives the function', () => {
  const card = read('src', 'components', 'settings', 'StorageCleanupCard.tsx')
  assert.match(card, /const \{ can \} = usePermissions\(\)/)
  assert.match(
    card,
    /if \(!can\('movements\.photos\.delete_any'\)\) return null/,
  )
  assert.match(
    card,
    /callEdgeFunction<StorageCleanupReport>\(\s+'storage-cleanup',\s+\{ dry_run: true \},\s+\)/,
  )
  assert.match(
    card,
    /callEdgeFunction<StorageCleanupResult>\(\s+'storage-cleanup',\s+\{ dry_run: false, older_than_hours: report\.older_than_hours \},\s+\)/,
  )
  // The real run waits for a confirmation, and is offered only after a check.
  assert.match(
    card,
    /const confirmed = await confirm\(\{[\s\S]*?tone: 'danger',\s+\}\)\s+if \(!confirmed\) return/,
  )
  assert.match(card, /onClick=\{\(\) => void clean\(report\)\}/)
  assert.ok(card.indexOf('{hasWork ? (') < card.indexOf('void clean(report)'))
  // Failures are visible, never an empty state.
  assert.match(card, /<Notice tone="danger" size="compact">\s+\{error\}/)
  assert.ok(!/supabase\.storage|service_role|SERVICE_ROLE/i.test(card))
  // Shared components and tokens only.
  assert.match(card, /from '@\/components\/ui'/)
  assert.ok(!/#[0-9a-f]{3,6}\b|\b(gray|emerald|red|green|amber)-\d/.test(card))
})

test('Settings mounts the card once, with a two-line edit', () => {
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.equal(
    (
      settings.match(
        /import \{ StorageCleanupCard \} from '@\/components\/settings\/StorageCleanupCard'/g,
      ) ?? []
    ).length,
    1,
  )
  assert.equal((settings.match(/<StorageCleanupCard \/>/g) ?? []).length, 1)
  // On the settings index page, after the section cards.
  const grid = settings.indexOf(
    'className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"',
  )
  const mount = settings.indexOf('<StorageCleanupCard />')
  const types = settings.indexOf(
    'const columns: DataTableColumn<EquipmentTypeRow>[]',
  )
  assert.ok(grid > 0 && mount > grid && types > mount)
})

test('the copy exists in both languages and the Arabic uses the plain alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...translations.matchAll(
      /\/\/ audit-storage-cleanup — start\n([\s\S]*?)\/\/ audit-storage-cleanup — end/g,
    ),
  ].map((m) => m[1])
  assert.equal(blocks.length, 2, 'one block per language')
  const keys = (block) =>
    [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).sort()
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.ok(keys(blocks[0]).length >= 20)
  assert.ok(!/[أإآ]/.test(blocks[0]), 'no hamza or madda alif in new copy')
  const card = read('src', 'components', 'settings', 'StorageCleanupCard.tsx')
  for (const key of [...card.matchAll(/t\('(storageCleanup\w+)'\)/g)].map(
    (m) => m[1],
  ))
    assert.ok(keys(blocks[0]).includes(key), `${key} is translated`)
})

test('the README lists the function and its deploy command', () => {
  const readme = read('README.md')
  assert.match(
    readme,
    /`storage-cleanup`: the orphan cleanup of the `log-photos` bucket/,
  )
  assert.match(readme, /npx supabase functions deploy <name>/)
})
