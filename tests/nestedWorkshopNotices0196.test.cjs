const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0196 (owner decisions 2026-11-14, «اعتمد على الثلاثة»): the
// foreman of the open project visit is told when his unit enters the
// workshop and when it leaves it; «ابلاغ الفورمان» goes away.

const ROOT = path.join(__dirname, '..')
const DIR = path.join(ROOT, 'supabase', 'migrations')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const FILE = '20261114130000_0196_nested_workshop_notices.sql'
const read = (file) => fs.readFileSync(path.join(DIR, file), 'utf8')
const SQL = read(FILE)
const M0110 = read('20261001100000_0110_movement_notices.sql')
const M0156 = read('20261028110000_0156_drop_legacy_role.sql')

const strip = (s) => s.replace(/--[^\n]*/g, '')
const squash = (s) => s.replace(/\s+/g, ' ').trim()
const norm = (s) => squash(strip(s))
const CODE = strip(SQL)

function fn(code, name) {
  const start = code.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`))
  assert.ok(start >= 0, `${name} is there`)
  const open = code.indexOf('AS $$', start)
  return code.slice(start, code.indexOf('$$;', open + 5) + 3)
}
const NOW = norm(fn(CODE, 'prepare_movement_notice'))
const OLD = norm(fn(strip(M0156), 'prepare_movement_exit_notice'))

test('0196 is the single 0196 migration, after 0195, LF only', () => {
  assert.equal(FILES.filter((f) => /_0196_/.test(f)).length, 1)
  assert.ok(FILE > '20261114120000_0195_nested_workshop_visits.sql')
  assert.ok(!SQL.includes('\r'))
  assert.ok(!/[أإآ]/.test(SQL))
})

test('the header quotes the owner and names the rollout', () => {
  assert.ok(SQL.includes('اعتمد على الثلاثة'))
  assert.ok(SQL.includes('ابلاغ الفورمان'))
  assert.match(SQL, /Rollout: apply after 0195 and BEFORE deploying the screens/)
})

test('the kind CHECK gains workshop_entry and workshop_return', () => {
  // The 0110 kinds, never altered since.
  assert.match(M0110, /CHECK \(kind IN \('workshop_arrival', 'site_exit', 'workshop_exit'\)\)/)
  for (const f of FILES.filter((x) => x > '20261001100000_0110_movement_notices.sql' && x < FILE)) {
    assert.ok(!/ALTER TABLE (?:public\.)?movement_notices[^;]*CONSTRAINT/i.test(strip(read(f))), f)
  }
  const c = norm(CODE)
  assert.match(c, /pg_get_constraintdef\(c\.oid\) LIKE '%workshop_arrival%' LOOP EXECUTE format\('ALTER TABLE public\.movement_notices DROP CONSTRAINT %I', v_name\); END LOOP;/)
  assert.match(c, /ALTER TABLE public\.movement_notices ADD CONSTRAINT movement_notices_kind_check CHECK \(kind IN \( 'workshop_arrival', 'site_exit', 'workshop_exit', 'workshop_entry', 'workshop_return' \)\);/)
  assert.ok(c.indexOf('DROP CONSTRAINT') < c.indexOf('ADD CONSTRAINT'))
})

test('prepare_movement_notice keeps the signature, caller rule, freshness, key and insert of the exit notice', () => {
  const head = (s) => s.slice(s.indexOf('RETURNS TABLE('), s.indexOf('AS $$'))
  assert.equal(head(NOW), head(OLD))
  assert.match(NOW, /^CREATE OR REPLACE FUNCTION public\.prepare_movement_notice\(p_movement_id uuid\) RETURNS TABLE\(/)
  assert.match(NOW, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$\$/)
  for (const piece of [
    "v_allowed := FOUND AND auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()) AND (public.has_permission('movements.edit_delete') OR v_log.supervisor_id = auth.uid());",
    "RAISE EXCEPTION 'movement_not_accessible' USING ERRCODE = '42501'",
    "IF v_log.created_at < now() - interval '10 minutes' THEN RETURN; END IF;",
    "PERFORM pg_advisory_xact_lock( hashtextextended('movement_notice:' || v_log.equipment_id::text, 0) );",
    'INSERT INTO public.movement_notices ( kind, equipment_id, entry_log_id, movement_id, sender_id, recipient_id, status ) VALUES ( v_kind, v_log.equipment_id, v_site_entry.id, v_log.id, auth.uid(), v_recipient, \'pending\' ) ON CONFLICT DO NOTHING RETURNING id INTO v_notice_id;',
    'SELECT x.* FROM public.movement_notice_payload(v_notice_id) AS x;',
  ]) {
    assert.ok(OLD.includes(piece), `old: ${piece}`)
    assert.ok(NOW.includes(piece), piece)
  }
  // The caller rule comes before anything else is decided.
  assert.ok(NOW.indexOf("'movement_not_accessible'") < NOW.indexOf("v_log.movement_context = 'site' AND v_log.movement_type = 'entry'"))
  assert.ok(!NOW.includes("'movement_not_exit'"))
})

test('the five cases', () => {
  // A site ENTRY: nothing, no error.
  assert.ok(NOW.includes("IF v_log.movement_context = 'site' AND v_log.movement_type = 'entry' THEN RETURN; END IF;"))
  // A workshop movement while the site visit is open.
  assert.ok(NOW.includes("SELECT l.* INTO v_site_last FROM public.entry_exit_logs l WHERE l.equipment_id = v_log.equipment_id AND l.movement_context = 'site' AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id) ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;"))
  assert.ok(NOW.includes("IF FOUND AND v_site_last.movement_type = 'entry' THEN v_kind := CASE WHEN v_log.movement_type = 'entry' THEN 'workshop_entry' ELSE 'workshop_return' END; v_site_entry := v_site_last; v_recipient := v_site_last.supervisor_id; ELSIF v_log.movement_type = 'entry' THEN RETURN;"))
  // The workshop_exit rule, each entry in its own context.
  assert.ok(NOW.includes("AND l.movement_context = 'workshop' AND l.movement_type = 'entry' AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)"))
  assert.ok(NOW.includes("OR v_previous.movement_type IS DISTINCT FROM 'exit' OR v_previous.movement_context IS DISTINCT FROM 'site' THEN RETURN; END IF;"))
  assert.ok(NOW.includes("AND l.movement_context = 'site' AND l.movement_type = 'entry' AND (l.recorded_at, l.id) < (v_previous.recorded_at, v_previous.id)"))
  assert.ok(NOW.includes("v_kind := 'workshop_exit'; v_recipient := v_site_entry.supervisor_id;"))
  // The site_exit rule from the latest SITE entry.
  assert.ok(NOW.includes("AND l.movement_context = 'site' AND l.movement_type = 'entry' AND (l.recorded_at, l.id) < (v_log.recorded_at, v_log.id)"))
  assert.ok(NOW.includes("AND n.kind = 'workshop_arrival' ORDER BY n.created_at DESC, n.id DESC LIMIT 1; IF NOT FOUND OR v_recipient IS NULL THEN RETURN; END IF; v_kind := 'site_exit'; v_site_entry := v_closed_entry;"))
  // Never the caller himself, checked before the insert.
  const self = 'IF v_recipient IS NULL OR v_recipient = auth.uid() THEN RETURN; END IF;'
  assert.ok(NOW.includes(self))
  assert.ok(NOW.indexOf(self) < NOW.indexOf('INSERT INTO public.movement_notices'))
})

test('grants, comment, the exit notice left as it is, the guard', () => {
  assert.match(CODE, /REVOKE ALL ON FUNCTION public\.prepare_movement_notice\(uuid\) FROM PUBLIC, anon;/)
  assert.match(CODE, /GRANT EXECUTE ON FUNCTION public\.prepare_movement_notice\(uuid\) TO authenticated;/)
  assert.match(CODE, /COMMENT ON FUNCTION public\.prepare_movement_notice\(uuid\) IS/)
  for (const name of ['prepare_movement_exit_notice', 'request_workshop_arrival_notice', 'movement_notice_payload', 'complete_movement_notice']) {
    assert.ok(!new RegExp(`FUNCTION public\\.${name}\\(`).test(CODE), name)
  }
  assert.ok(!/POLICY/.test(CODE))
  const guard = CODE.slice(CODE.lastIndexOf('DO $$'))
  assert.match(guard, /<> 1 THEN/)
  assert.match(guard, /position\('workshop_entry' IN v_def\) = 0/)
  assert.match(guard, /to_regprocedure\('public\.prepare_movement_notice\(uuid\)'\) IS NULL/)
  assert.match(guard, /to_regprocedure\('public\.prepare_movement_exit_notice\(uuid\)'\) IS NULL/)
  assert.match(SQL.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})

test('no later migration re-creates the 0196 objects', () => {
  for (const f of FILES.filter((x) => x > FILE)) {
    const text = strip(read(f))
    assert.ok(!/FUNCTION public\.prepare_movement_notice\(/.test(text), f)
    assert.ok(!/movement_notices_kind_check/.test(text), f)
  }
})
