// Migration 0155 (owner 2026-10-28, EM-210: «الادمن لما يسجل خروج معدة،
// سياق الخروج حسب سياق الدخول»): an EXIT takes the context of the entry it
// closes, set in enforce_movement_sequence before the per-context checks;
// the old refusal tokens stay for a caller without that context's key.
//
// Source checks only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const MIGRATION = '20261028100000_0155_exit_takes_entry_context.sql'
const body = fs
  .readFileSync(path.join(root, 'supabase', 'migrations', MIGRATION), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ')

test('0155 follows 0154', () => {
  const files = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.match(files[files.indexOf(MIGRATION) - 1], /_0154_/)
})

test('an exit takes its entry context before the per-context checks', () => {
  const forcedAt = body.indexOf('NEW.movement_context := v_entry_context;')
  const checkAt = body.indexOf("IF NEW.movement_context = 'workshop' THEN IF NOT public.has_permission('movements.workshop.create')")
  assert.ok(forcedAt > 0 && checkAt > forcedAt)
  assert.match(
    body,
    /IF NEW\.movement_type = 'exit' THEN PERFORM pg_advisory_xact_lock\(hashtextextended\(NEW\.equipment_id::text, 0\)\); v_sent_context := NEW\.movement_context; SELECT l\.movement_context INTO v_entry_context FROM public\.entry_exit_logs l WHERE l\.equipment_id = NEW\.equipment_id AND l\.movement_type = 'entry' AND \(l\.recorded_at, l\.id\) < \(NEW\.recorded_at, NEW\.id\) ORDER BY l\.recorded_at DESC, l\.id DESC LIMIT 1;/,
  )
})

test('the old refusal tokens stay for a caller without that context key', () => {
  assert.match(
    body,
    /IF v_entry_context = 'workshop' AND NOT public\.has_permission\('movements\.workshop\.create'\) THEN RAISE EXCEPTION 'exit_equipment_in_workshop'/,
  )
  assert.match(
    body,
    /IF v_entry_context = 'site' AND NOT public\.has_permission\('movements\.site\.create'\) THEN RAISE EXCEPTION 'exit_equipment_on_site'/,
  )
})

test('the foreman-owner rule of a site exit stays; no legacy role read', () => {
  assert.match(
    body,
    /IF NEW\.movement_context = 'site' AND NOT public\.has_permission\('movements\.exit_cross_context'\) AND public\.movement_scope_allows\(/,
  )
  assert.match(body, /RAISE EXCEPTION 'exit_not_entry_owner'/)
  assert.doesNotMatch(body, /SELECT role INTO|v_role/)
  assert.match(body, /REVOKE ALL ON FUNCTION public\.enforce_movement_sequence\(\) FROM PUBLIC, anon, authenticated;/)
})
