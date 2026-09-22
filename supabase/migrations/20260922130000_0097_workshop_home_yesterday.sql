-- Workshop home: the state cards compare today with yesterday.
--
-- The owner replaced the cards' secondary lines ("of which 3 maintenance",
-- "3 of 40 inside") with the change since yesterday, so the stats payload
-- gains a snapshot of the same three counts as they stood at the start of
-- today (Saudi midnight, UTC+03:00), i.e. the end of yesterday. The client
-- renders `now - yesterday` as "+3 since yesterday" / "-2" / "no change".
--
-- Security model is unchanged from 0090: SECURITY INVOKER, fixed search_path,
-- anon revoked, so entry_exit_logs RLS stays authoritative and the yesterday
-- snapshot is built from exactly the rows the caller may read today.
--
-- "Yesterday" = the latest workshop movement of each equipment recorded
-- strictly before today's Saudi midnight, ordered by (recorded_at, id) like
-- every other latest-movement query. The purpose is read from that entry row
-- as it is NOW (a classification made this morning counts for yesterday's
-- split too), which keeps the two snapshots comparable: both split by the
-- current classification, so the delta reflects movements, not paperwork.
--
-- Plan: the same DISTINCT ON scan as the "latest" CTE, once more with a
-- recorded_at bound, both served by idx_entry_exit_logs_equipment_context_time
-- (equipment_id, movement_context, recorded_at, id) from migration 0040.

CREATE OR REPLACE FUNCTION public.get_workshop_home_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH today AS (
  SELECT date_trunc('day', now() AT TIME ZONE INTERVAL '+03:00')
           AT TIME ZONE INTERVAL '+03:00' AS starts
),
latest AS (
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
latest_yesterday AS (
  SELECT DISTINCT ON (l.equipment_id)
    l.equipment_id, l.movement_type, l.workshop_purpose
  FROM public.entry_exit_logs l, today
  WHERE l.movement_context = 'workshop'
    AND l.recorded_at < today.starts
  ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
),
inside_yesterday AS (
  SELECT equipment_id, workshop_purpose
  FROM latest_yesterday
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
  'inside_yesterday', (SELECT count(*)::int FROM inside_yesterday),
  'maintenance_yesterday',
    (SELECT count(*)::int FROM inside_yesterday
     WHERE workshop_purpose = 'maintenance'),
  'parking_yesterday',
    (SELECT count(*)::int FROM inside_yesterday
     WHERE workshop_purpose = 'parking'),
  'pending', COALESCE((SELECT value FROM pending), '[]'::jsonb)
);
$$;
REVOKE ALL ON FUNCTION public.get_workshop_home_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workshop_home_stats() TO authenticated;

COMMENT ON FUNCTION public.get_workshop_home_stats() IS
  'Workshop home stats: equipment whose latest visible workshop movement is an '
  'ENTRY, split into maintenance / parking / not classified yet, the same three '
  'counts as of the start of today (Saudi midnight) for the change since '
  'yesterday, plus the latest 10 unclassified open entries as `pending`. '
  'SECURITY INVOKER, so entry_exit_logs RLS stays authoritative.';
