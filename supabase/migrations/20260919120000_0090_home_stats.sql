-- Home page stats for the foreman and the workshop roles (owner-approved home
-- page, 2026-09-19).
--
-- One function per role so each home screen loads its whole stat row in a
-- single request instead of counting rows in the browser.
--
-- Security model
--   * Both functions are SECURITY INVOKER (the default, spelled out here), so
--     `entry_exit_logs` RLS stays authoritative exactly as it is for the lists
--     these numbers summarize. No SECURITY DEFINER, no elevation, and the
--     caller can never read a movement the movement list would hide.
--   * `search_path` is fixed to `public` so the bodies cannot be redirected.
--   * Execution is revoked from PUBLIC/anon and granted to `authenticated`
--     only. A role with no matching movements simply gets zeros.
--   * `get_foreman_home_stats` additionally scopes to `supervisor_id =
--     auth.uid()` in SQL, so the numbers match the foreman list's own
--     `supervisor_id = user.id` scoping and never widen for a role whose RLS
--     is broader (an admin calling it sees their own movements only).
--
-- Day boundaries
--   Saudi Arabia is UTC+03:00 all year, so the Saudi day is computed here with
--   a fixed interval offset (never the server or browser timezone):
--   `date_trunc('day', now() AT TIME ZONE INTERVAL '+03:00') AT TIME ZONE
--   INTERVAL '+03:00'` is the Saudi midnight that starts today, as a
--   timestamptz. The interval form is used rather than a zone name so the
--   POSIX sign convention (`'UTC+3'` meaning UTC-3) can never apply. The range
--   is half-open: `>= start AND < start + 1 day`.
--
-- Definitions
--   Foreman: entries/exits recorded today in the `site` context by the caller,
--   and "my equipment inside sites now" = equipment whose latest movement
--   among the caller's own site movements is an ENTRY. A site EXIT may only be
--   registered by the foreman who opened the visit or by an admin (0087/0088),
--   so the caller's own rows are the complete picture for their own visits;
--   the rare admin-registered exit is invisible to that foreman by RLS and
--   would keep the visit counted as open, which is the honest invoker-rights
--   answer and matches what their list shows.
--
--   Workshop: equipment whose latest visible `workshop` movement is an ENTRY
--   is inside the workshop now, split by `workshop_purpose`
--   (maintenance / parking / not classified yet). Workshop roles see every
--   workshop-context movement by RLS, and after a workshop ENTRY only a
--   workshop EXIT can follow (the sequence trigger rejects ENTRY -> ENTRY and
--   0088 stops a site EXIT from closing a workshop entry), so the latest
--   workshop movement is the current state. The three splits therefore always
--   add up to `inside_now`, and `pending_classification` is exactly the list
--   the classification section shows. The workshop function also returns the
--   latest 10 of those unclassified open entries as `pending`, ordered
--   deterministically by (recorded_at DESC, id DESC), so the classification
--   section and its counter can never disagree and the workshop home page
--   needs one request for both.
--
-- Query plan: the per-equipment "latest movement" lookups are DISTINCT ON
-- (equipment_id) ORDER BY (equipment_id, recorded_at DESC, id DESC), served by
-- `idx_entry_exit_logs_equipment_context_time` (equipment_id,
-- movement_context, recorded_at, id) from 0040 and
-- `idx_entry_exit_logs_equipment_time` from 0043; today's counts use
-- `idx_logs_supervisor_id` / `idx_logs_recorded_at` from 0001. No new index is
-- added.

CREATE OR REPLACE FUNCTION public.get_foreman_home_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH saudi_day AS (
  SELECT date_trunc('day', now() AT TIME ZONE INTERVAL '+03:00')
           AT TIME ZONE INTERVAL '+03:00' AS starts
),
mine AS (
  SELECT l.id, l.equipment_id, l.movement_type, l.recorded_at
  FROM public.entry_exit_logs l
  WHERE l.movement_context = 'site'
    AND l.supervisor_id = auth.uid()
),
today AS (
  SELECT m.movement_type, count(*)::int AS total
  FROM mine m, saudi_day d
  WHERE m.recorded_at >= d.starts
    AND m.recorded_at < d.starts + interval '1 day'
  GROUP BY m.movement_type
),
latest AS (
  SELECT DISTINCT ON (m.equipment_id) m.equipment_id, m.movement_type
  FROM mine m
  ORDER BY m.equipment_id, m.recorded_at DESC, m.id DESC
)
SELECT jsonb_build_object(
  'entries_today',
    COALESCE((SELECT total FROM today WHERE movement_type = 'entry'), 0),
  'exits_today',
    COALESCE((SELECT total FROM today WHERE movement_type = 'exit'), 0),
  'inside_now',
    (SELECT count(*)::int FROM latest WHERE movement_type = 'entry')
);
$$;

REVOKE ALL ON FUNCTION public.get_foreman_home_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_foreman_home_stats() TO authenticated;

COMMENT ON FUNCTION public.get_foreman_home_stats() IS
  'Foreman home stats: site entries/exits recorded today in Saudi time '
  '(UTC+03:00) by the caller, and the equipment still inside sites from the '
  'caller''s own site movements. SECURITY INVOKER, so entry_exit_logs RLS '
  'stays authoritative, and scoped to supervisor_id = auth.uid().';

CREATE OR REPLACE FUNCTION public.get_workshop_home_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH latest AS (
  SELECT DISTINCT ON (l.equipment_id)
    l.id, l.equipment_id, l.movement_type, l.workshop_purpose, l.recorded_at
  FROM public.entry_exit_logs l
  WHERE l.movement_context = 'workshop'
  ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
),
inside AS (
  SELECT id, equipment_id, workshop_purpose, recorded_at
  FROM latest
  WHERE movement_type = 'entry'
),
pending AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'equipment_id', p.equipment_id,
      'equipment_code', e.code,
      'equipment_type', e.type,
      'recorded_at', p.recorded_at
    )
    ORDER BY p.recorded_at DESC, p.id DESC
  ) AS value
  FROM (
    SELECT id, equipment_id, recorded_at
    FROM inside
    WHERE workshop_purpose IS NULL
    ORDER BY recorded_at DESC, id DESC
    LIMIT 10
  ) p
  LEFT JOIN public.equipment e ON e.id = p.equipment_id
)
SELECT jsonb_build_object(
  'inside_now', (SELECT count(*)::int FROM inside),
  'maintenance',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'maintenance'),
  'parking',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'parking'),
  'pending_classification',
    (SELECT count(*)::int FROM inside WHERE workshop_purpose IS NULL),
  'pending', COALESCE((SELECT value FROM pending), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.get_workshop_home_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workshop_home_stats() TO authenticated;

COMMENT ON FUNCTION public.get_workshop_home_stats() IS
  'Workshop home stats: equipment whose latest visible workshop movement is an '
  'ENTRY, split into maintenance / parking / not classified yet, plus the '
  'latest 10 unclassified open entries as `pending`. SECURITY INVOKER, so '
  'entry_exit_logs RLS stays authoritative.';
