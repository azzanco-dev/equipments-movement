// Migration 0133 (security audit run-1, group B "photos and Storage", owner
// review 2026-10-18): four leads closed in the movement-photo Storage model.
//
//   B-6   select_log_photos: the pending-batch branch admits the caller's own
//         folder only (em:storage.objects:select:pending-batch-unbound-folder).
//   B-7   update_log_photos / delete_log_photos: without
//         movements.photos.delete_any an object still referenced by an
//         entry_exit_photos row cannot be deleted, moved or overwritten, and
//         an UPDATE is bound to the movement or staged batch like an INSERT
//         (em:storage.objects:update-delete:linked-evidence-unguarded).
//   B-8   entry_exit_logs.photo_url: a BEFORE INSERT trigger clears it except
//         for the admin Excel import, and admin_delete_movement returns the
//         legacy path only from the movement's own folder
//         (em:entry_exit_logs:insert:photo_url).
//   B-10  pending_movement_photo_batches: expires_at is forced server-side,
//         every path is <uploaded_by>/<batch id>/<file>, a batch is immutable
//         (em:pending_movement_photo_batches:insert:expires_at-client-controlled).
//
// Source checks only, like the rest of the suite: the re-created objects are
// compared with their previous definitions (0079 / 0127) so that nothing but
// the documented clauses changed, the product flows the policies rely on are
// pinned in the routes, and no later migration silently redefines the
// objects without these clauses.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261018100000_0133_photo_storage_policy_hardening.sql'
const BASE_0079 = '20260909140000_0079_pending_movement_photo_batches.sql'
const BASE_0127 = '20261011140000_0127_permission_keys_in_policies.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const sql0079 = read('supabase', 'migrations', BASE_0079)
const sql0127 = read('supabase', 'migrations', BASE_0127)

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** SQL without `--` comments, whitespace collapsed: for exact comparisons. */
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** `CREATE POLICY <name> ON <table> ... ;` up to the first `\n);`. */
function policy(source, name, table) {
  const match = new RegExp(
    `CREATE POLICY ${escape(name)} ON ${escape(table)}\\b`,
  ).exec(source)
  assert.ok(match, `missing policy ${name} on ${table}`)
  const end = source.indexOf('\n);', match.index)
  assert.ok(end > match.index, `unterminated policy ${name}`)
  return source.slice(match.index, end + 3)
}

/** `CREATE [OR REPLACE] FUNCTION public.<name>(` up to `\n$$;`. */
function fn(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${escape(name)}\\(`,
  ).exec(source)
  assert.ok(match, `missing function ${name}`)
  const end = source.indexOf('\n$$;', match.index)
  assert.ok(end > match.index, `unterminated function ${name}`)
  return source.slice(match.index, end + 4)
}

const DELETE_ANY =
  "(SELECT public.has_permission('movements.photos.delete_any'))"
const LINKED_GUARD = norm(`(
    ${DELETE_ANY}
    OR NOT EXISTS (
      SELECT 1
      FROM public.entry_exit_photos p
      WHERE p.file_path = storage.objects.name
    )
  )`)
const PENDING_BRANCH = norm(`EXISTS (
      SELECT 1
      FROM public.pending_movement_photo_batches pending
      WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
        AND pending.uploaded_by = auth.uid()
        AND pending.expires_at > now()
        AND name = ANY(pending.file_paths)
    )`)
const OWN_FOLDER = '(storage.foldername(name))[1] = auth.uid()::text'

test('0133 is the single 0133 migration, right after 0132', () => {
  // 0134 (permission gaps) follows it; the "no later migration redefines"
  // test below guards the 0133 objects from then on.
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'present')
  assert.equal(
    migrations[at - 1],
    '20261015120000_0132_movement_views_lessor.sql',
  )
  assert.equal(migrations.filter((file) => /_0133_/.test(file)).length, 1)
})

test('the baselines compared below are the latest definitions before 0133', () => {
  // select_log_photos was last defined in 0079; the other three in 0127.
  const between = (from) =>
    migrations.filter((file) => file > from && file < MIGRATION)
  for (const file of between(BASE_0079)) {
    assert.doesNotMatch(
      read('supabase', 'migrations', file),
      /POLICY select_log_photos\b/,
      `${file} redefines select_log_photos after 0079`,
    )
  }
  for (const file of between(BASE_0127)) {
    const text = read('supabase', 'migrations', file)
    assert.doesNotMatch(text, /POLICY (?:update|delete)_log_photos\b/, file)
    assert.doesNotMatch(text, /FUNCTION public\.admin_delete_movement\(/, file)
  }
})

// ---------------------------------------------------------------------------
// B-6
// ---------------------------------------------------------------------------
test('B-6: select_log_photos is 0079 plus the own-folder clause in the batch branch', () => {
  const before = norm(policy(sql0079, 'select_log_photos', 'storage.objects'))
  const after = norm(policy(sql, 'select_log_photos', 'storage.objects'))
  const oldBranch = `OR ${PENDING_BRANCH}`
  assert.ok(before.includes(oldBranch), 'the 0079 batch branch')
  const expected = before.replace(
    oldBranch,
    `OR ( ${OWN_FOLDER} AND ${PENDING_BRANCH} )`,
  )
  assert.equal(after, expected)
  // The photo-row and legacy photo_url branches are untouched.
  assert.ok(
    after.includes(
      norm(`EXISTS (
      SELECT 1 FROM public.entry_exit_photos photo
      WHERE photo.file_path = name
        AND public.can_access_movement(photo.entry_exit_log_id)
    )`),
    ),
  )
  assert.ok(
    after.includes(
      norm(`OR EXISTS (
      SELECT 1 FROM public.entry_exit_logs movement
      WHERE movement.photo_url = name
        AND public.can_access_movement(movement.id)
    )`),
    ),
  )
  assert.match(
    sql,
    /COMMENT ON POLICY select_log_photos ON storage\.objects IS\s+'0133 \(B-6\)/,
  )
})

// ---------------------------------------------------------------------------
// B-7
// ---------------------------------------------------------------------------
test('B-7: delete_log_photos is 0127 plus the linked-row guard for callers without delete_any', () => {
  const before = norm(policy(sql0127, 'delete_log_photos', 'storage.objects'))
  const after = norm(policy(sql, 'delete_log_photos', 'storage.objects'))
  const folderClause = `AND (${OWN_FOLDER} OR ${DELETE_ANY}) AND ( ${DELETE_ANY} OR EXISTS (`
  assert.ok(before.includes(folderClause), 'the 0127 folder clause')
  const expected = before.replace(
    folderClause,
    `AND (${OWN_FOLDER} OR ${DELETE_ANY}) AND ${LINKED_GUARD} AND ( ${DELETE_ANY} OR EXISTS (`,
  )
  assert.equal(after, expected)
  assert.match(
    sql,
    /COMMENT ON POLICY delete_log_photos ON storage\.objects IS\s+'0133 \(B-7\)/,
  )
})

test('B-7: update_log_photos carries the linked-row guard and the insert binding, in USING and WITH CHECK', () => {
  const text = policy(sql, 'update_log_photos', 'storage.objects')
  const usingAt = text.indexOf('\nUSING (')
  const checkAt = text.indexOf('\nWITH CHECK (')
  assert.ok(usingAt > 0 && checkAt > usingAt)
  const using = norm(text.slice(usingAt + '\nUSING ('.length, checkAt))
  const check = norm(text.slice(checkAt + '\nWITH CHECK ('.length))
  // The same predicate on both sides (WITH CHECK ends the statement).
  assert.equal(check, `${using};`)

  const insert = norm(policy(sql0127, 'insert_log_photos', 'storage.objects'))
  const binding = norm(`(
    public.can_write_movement_photos(public.safe_uuid(split_part(name, '/', 2)))
    OR ${PENDING_BRANCH}
  )`)
  assert.ok(insert.includes(binding), 'the 0127 insert binding')
  const expected = norm(`bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND ${OWN_FOLDER}
  AND ${LINKED_GUARD}
  AND ${binding}
)`)
  assert.equal(using, expected)
  // No `OR delete_any` escape on the folder any more: an update is bound to
  // the caller's own folder exactly like an insert.
  assert.ok(!using.includes(`${OWN_FOLDER} OR ${DELETE_ANY}`))
  assert.match(
    sql,
    /COMMENT ON POLICY update_log_photos ON storage\.objects IS\s+'0133 \(B-7\)/,
  )
})

test('B-7: the product flows remove the row first and the object afterwards', () => {
  // One photo: the entry_exit_photos row is deleted (RLS decides), then the
  // object is removed with the same token.
  const photos = read('app', 'api', 'movements', '[id]', 'photos', 'route.ts')
  const rowDelete = photos.indexOf(".from('entry_exit_photos')\n    .delete()")
  const objectRemove = photos.indexOf(
    ".from('log-photos').remove([photo.file_path])",
  )
  assert.ok(rowDelete > 0 && objectRemove > rowDelete)
  assert.match(
    photos.slice(rowDelete, objectRemove),
    /if \(deleteError \|\| !deleted\)\s+return NextResponse\.json\(\{ error: 'photo_delete_failed' \}, \{ status: 403 \}\)/,
  )
  // Whole movement: admin_delete_movement cascades the rows in its own
  // transaction and returns the paths; the route removes them afterwards with
  // the caller's token and never fails the delete on a Storage error.
  const movement = read('app', 'api', 'movements', '[id]', 'route.ts')
  const rpc = movement.indexOf("rpc('admin_delete_movement'")
  const remove = movement.indexOf(".from('log-photos')\n        .remove(paths)")
  assert.ok(rpc > 0 && remove > rpc)
  assert.match(movement, /storage_cleanup: cleaned \? 'done' : 'pending'/)
  // Every upload is an insert, never an upsert, so the UPDATE policy is on no
  // product path.
  for (const file of [
    ['app', 'api', 'movements', 'route.ts'],
    ['app', 'api', 'movements', '[id]', 'photos', 'route.ts'],
    ['src', 'lib', 'movementPhotoUpload.ts'],
  ]) {
    const text = read(...file)
    assert.doesNotMatch(text, /upsert: true/, file.join('/'))
    assert.doesNotMatch(text, /\.(move|copy)\(/, file.join('/'))
  }
})

// ---------------------------------------------------------------------------
// B-8
// ---------------------------------------------------------------------------
test('B-8: enforce_movement_photo_url clears photo_url except for the admin Excel import', () => {
  const body = fn(sql, 'enforce_movement_photo_url')
  assert.match(
    body,
    /RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/,
  )
  assert.equal(
    norm(body.slice(body.indexOf('BEGIN'))),
    norm(`BEGIN
  IF NEW.photo_url IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.movement_excel_import', true) = 'true'
     AND public.has_permission('movements.import') THEN
    RETURN NEW;
  END IF;
  NEW.photo_url := NULL;
  RETURN NEW;
END;
$$;`),
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.enforce_movement_photo_url\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql,
    /DROP TRIGGER IF EXISTS enforce_movement_photo_url ON public\.entry_exit_logs;\s+CREATE TRIGGER enforce_movement_photo_url\s+BEFORE INSERT ON public\.entry_exit_logs\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_movement_photo_url\(\);/,
  )
  // The import marker is the one set by import_movement_rows (0127).
  assert.match(
    sql0127,
    /PERFORM set_config\('app\.movement_excel_import', 'true', true\);/,
  )
})

test('B-8: admin_delete_movement is 0127 verbatim except the guarded photo_url block', () => {
  const before = norm(fn(sql0127, 'admin_delete_movement'))
  const after = norm(fn(sql, 'admin_delete_movement'))
  const oldBlock = norm(`IF NULLIF(btrim(v_log.photo_url), '') IS NOT NULL THEN
    v_paths := array_append(v_paths, btrim(v_log.photo_url)::text);
  END IF;`)
  const newBlock = norm(`IF NULLIF(btrim(v_log.photo_url), '') IS NOT NULL
     AND split_part(btrim(v_log.photo_url), '/', 1) = v_log.supervisor_id::text
     AND split_part(btrim(v_log.photo_url), '/', 2) = p_log_id::text THEN
    v_paths := array_append(v_paths, btrim(v_log.photo_url)::text);
  END IF;`)
  assert.ok(before.includes(oldBlock), 'the 0127 photo_url block')
  assert.equal(after, before.replace(oldBlock, newBlock))
  assert.match(after, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.admin_delete_movement\(uuid\) FROM PUBLIC, anon;\s+GRANT EXECUTE ON FUNCTION public\.admin_delete_movement\(uuid\) TO authenticated;/,
  )
})

test('B-8: nothing in the app writes entry_exit_logs.photo_url', () => {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name))
        files.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
  walk(path.join(root, 'app'))
  walk(path.join(root, 'src'))
  walk(path.join(root, 'supabase', 'functions'))
  // Readers of the legacy column (display, exports, types). Any other file
  // that mentions photo_url is a new writer or reader to review.
  const readers = new Set([
    'src/components/inquiry/EquipmentTimeline.tsx',
    'src/lib/movementLogSearch.ts',
    'src/lib/movementPhotoGallery.ts',
    'src/lib/types.ts',
    'src/lib/visitTimeline.ts',
    'src/screens/EntryReportsAll.tsx',
    'src/screens/MovementDetail.tsx',
    // The orphan cleanup reads the column to keep every legacy object.
    'supabase/functions/storage-cleanup/index.ts',
  ])
  const mentions = files.filter((file) => /photo_url/.test(read(file)))
  assert.deepEqual(
    mentions.filter((file) => !readers.has(file)),
    [],
    'photo_url is read in known files only',
  )
  for (const file of mentions) {
    const text = read(file)
    // No insert/update payload carries the column: the only `photo_url:`
    // forms are the type field and the view-row mapping.
    assert.doesNotMatch(
      text,
      /photo_url:(?! string \| null| row\.photo_url)/,
      file,
    )
  }
  // The one API insert into entry_exit_logs never mentions it.
  assert.doesNotMatch(read('app', 'api', 'movements', 'route.ts'), /photo_url/)
})

// ---------------------------------------------------------------------------
// B-10
// ---------------------------------------------------------------------------
test('B-10: a staged batch gets a server-side expiry and own-folder paths', () => {
  const body = fn(sql, 'enforce_pending_photo_batch_shape')
  assert.match(
    body,
    /RETURNS trigger\s+LANGUAGE plpgsql\s+SET search_path = public, pg_temp/,
  )
  assert.match(body, /NEW\.expires_at := now\(\) \+ interval '2 hours';/)
  assert.match(
    body,
    /v_prefix := NEW\.uploaded_by::text \|\| '\/' \|\| NEW\.id::text \|\| '\/';/,
  )
  assert.match(body, /FOREACH v_path IN ARRAY NEW\.file_paths LOOP/)
  assert.match(
    body,
    /IF v_file IS NULL OR v_file = '' OR position\('\/' IN v_file\) > 0 THEN\s+RAISE EXCEPTION 'invalid_pending_photo_path'\s+USING ERRCODE = '23514'/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.enforce_pending_photo_batch_shape\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql,
    /CREATE TRIGGER enforce_pending_photo_batch_shape\s+BEFORE INSERT ON public\.pending_movement_photo_batches\s+FOR EACH ROW EXECUTE FUNCTION public\.enforce_pending_photo_batch_shape\(\);/,
  )
})

test('B-10: a staged batch is immutable', () => {
  const body = fn(sql, 'protect_pending_photo_batch_identity')
  for (const column of ['id', 'uploaded_by', 'file_paths', 'expires_at']) {
    assert.match(
      body,
      new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
    )
  }
  assert.match(
    body,
    /RAISE EXCEPTION 'pending_photo_batch_immutable'\s+USING ERRCODE = '23514'/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.protect_pending_photo_batch_identity\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    sql,
    /CREATE TRIGGER protect_pending_photo_batch_identity\s+BEFORE UPDATE ON public\.pending_movement_photo_batches\s+FOR EACH ROW EXECUTE FUNCTION public\.protect_pending_photo_batch_identity\(\);/,
  )
})

test('B-10: the photo-uploads route stages exactly the shape the trigger accepts', () => {
  const route = read('app', 'api', 'movements', 'photo-uploads', 'route.ts')
  // <uid>/<batch id>/<random>-<safe name>, the safe name without a slash.
  assert.match(
    route,
    /file\.fileName\.replace\(\/\[\^a-zA-Z0-9\._-\]\/g, '_'\)\.slice\(-80\)/,
  )
  assert.match(
    route,
    /return `\$\{auth\.user\.id\}\/\$\{batchId\}\/\$\{crypto\.randomUUID\(\)\}-\$\{safeName\}`/,
  )
  assert.match(
    route,
    /\.insert\(\{\s+id: batchId,\s+uploaded_by: auth\.user\.id,\s+file_paths: paths,\s+expected_files: files,\s+\}\)/,
  )
  assert.doesNotMatch(route, /expires_at:/)
})

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
test('0133 redefines nothing else', () => {
  const stripped = sql.replace(/--[^\n]*/g, '')
  for (const name of [
    'insert_log_photos',
    'insert_own_pending_movement_photo_batches',
    'select_own_pending_movement_photo_batches',
    'delete_own_pending_movement_photo_batches',
    'insert_entry_exit_logs',
    'select_entry_exit_logs',
  ]) {
    assert.doesNotMatch(stripped, new RegExp(`CREATE POLICY ${name}\\b`), name)
  }
  for (const name of [
    'enforce_movement_sequence',
    'enforce_movement_photo_path',
    'protect_workshop_required_photo',
    'can_access_movement',
    'can_write_movement_photos',
    'import_movement_rows',
    'admin_update_movement',
  ]) {
    assert.doesNotMatch(
      stripped,
      new RegExp(`FUNCTION public\\.${name}\\(`),
      `${name} must not be redefined by 0133`,
    )
  }
  assert.doesNotMatch(stripped, /ALTER TABLE/)
  assert.doesNotMatch(stripped, /set_roles_system_enabled|roles_system/)
  assert.match(stripped, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('no later migration redefines the 0133 objects', () => {
  const later = migrations.filter((file) => file > MIGRATION)
  for (const file of later) {
    const text = read('supabase', 'migrations', file)
    assert.doesNotMatch(
      text,
      /POLICY (?:select|update|delete)_log_photos\b/,
      `${file} redefines a log-photos policy after 0133; carry the 0133 clauses over and update this test`,
    )
    assert.doesNotMatch(
      text,
      /FUNCTION public\.(?:admin_delete_movement|enforce_movement_photo_url|enforce_pending_photo_batch_shape|protect_pending_photo_batch_identity)\(/,
      `${file} redefines a 0133 function`,
    )
    assert.doesNotMatch(
      text,
      /TRIGGER (?:enforce_movement_photo_url|enforce_pending_photo_batch_shape|protect_pending_photo_batch_identity)\b/,
      `${file} touches a 0133 trigger`,
    )
  }
})
