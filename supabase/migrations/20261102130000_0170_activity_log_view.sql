-- 0170: `activity_log`, the one list of the rebuilt activity page.
--
-- Owner 2026-11-02 («خلنا نسوي سجل تعديلات المعدات، يكون ضمن النشاط، وصفحة
-- النشاط يبغالها اعادة بناء برضه»; the rebuilt page approved on /ui-kit the
-- same day): /activity shows the movement log (movement_audit_logs, 0069 /
-- 0070) and the equipment change log (equipment_audit_logs, 0168) as ONE
-- list — searched, filtered, sorted and paged on the server by the unified
-- list system, which reads a view directly. This view is that list: the two
-- append-only logs UNION ALL-ed into one shape.
--
-- Columns:
--   id               'm:<id>' / 'e:<id>' — stable text key of the row;
--   kind             'movement' / 'equipment' — which log the row comes from;
--   source_id        the log row's own bigint id (the deterministic tie-break
--                    after created_at: both logs are indexed
--                    (created_at DESC, id DESC), so a page sorted by
--                    created_at, source_id merges the two indexes);
--   record_id        what the row is about: the movement (movement_id, the
--                    page /movements/:id) or the unit (equipment_id, the page
--                    /equipment/:id; NULL once the unit is deleted);
--   action           create / update / delete;
--   actor_id, actor_name, equipment_id, equipment_code — as in both logs
--                    (actor NULL for a service-role or migration write);
--   movement_type, movement_context — the movement log's; NULL for a unit;
--   changed_fields, old_values, new_values, created_at — as in both logs
--                    (the values hold the changed keys only; the «الحقل»
--                    filter of the page overlaps changed_fields).
--
-- Read-only, security_invoker: the two tables' own SELECT policies decide
-- what the reader sees (movements.activity for both; the movement log also
-- within the reader's movements.read scope, 0134). No write path, no
-- function, no policy of its own, no grant beyond the view's select.

CREATE OR REPLACE VIEW public.activity_log
WITH (security_invoker = true)
AS
SELECT
  'm:' || m.id::text AS id,
  'movement'::text AS kind,
  m.id AS source_id,
  m.movement_id AS record_id,
  m.action,
  m.actor_id,
  m.actor_name,
  m.equipment_id,
  m.equipment_code,
  m.movement_type,
  m.movement_context,
  m.changed_fields,
  m.old_values,
  m.new_values,
  m.created_at
FROM public.movement_audit_logs m
UNION ALL
SELECT
  'e:' || e.id::text AS id,
  'equipment'::text AS kind,
  e.id AS source_id,
  e.equipment_id AS record_id,
  e.action,
  e.actor_id,
  e.actor_name,
  e.equipment_id,
  e.equipment_code,
  NULL::text AS movement_type,
  NULL::text AS movement_context,
  e.changed_fields,
  e.old_values,
  e.new_values,
  e.created_at
FROM public.equipment_audit_logs e;

COMMENT ON VIEW public.activity_log IS
  '0170: the activity page''s one list — movement_audit_logs (kind movement, record_id = the movement) UNION ALL equipment_audit_logs (kind equipment, record_id = the unit), id ''m:<id>'' / ''e:<id>'', source_id the log row''s id for a deterministic order after created_at. security_invoker: each log''s own SELECT policy (movements.activity) applies to the reader. Read-only.';

REVOKE ALL ON public.activity_log FROM PUBLIC, anon;
GRANT SELECT ON public.activity_log TO authenticated;
