-- Visits: every ENTRY paired with the EXIT that closes it.
--
-- The movement log answers "what was recorded"; it cannot answer "how long has
-- this equipment been inside, and who is still in". Until now the only place
-- that paired movements into visits was `src/lib/visitTimeline.ts`, which runs
-- in the browser over the movements of ONE equipment loaded for the inquiry
-- screen. Pairing the whole log that way would mean downloading it, so the
-- foreman/workshop home would have to choose between a wrong page count and a
-- full-table client-side pass.
--
-- `equipment_visits` does the pairing in PostgreSQL, one row per visit, so the
-- home list can search, count, sort and paginate visits server-side exactly
-- like every other list in the unified list system.
--
-- ===========================================================================
-- Security model
-- ===========================================================================
--   * `security_invoker = true` (spelled out, never the implicit default), so
--     `entry_exit_logs` RLS (`select_entry_exit_logs`, migration 0076) stays
--     authoritative and decides both halves of every pair. A caller can never
--     see a visit built from a movement the movement log would hide from them.
--   * No SECURITY DEFINER function is involved and no role check is needed:
--     the view exposes nothing a caller could not already assemble from the
--     rows they may read. It exists so "a visit" has one definition instead of
--     one per screen.
--   * Every join is a LEFT JOIN on a primary key, so a row the caller may not
--     read (a restricted `profiles` row in particular) becomes NULL display
--     columns and never drops a visit. This mirrors migration 0086.
--   * `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT SELECT ... TO authenticated`,
--     so an anonymous PostgREST request cannot reach the view at all.
--
-- ===========================================================================
-- How a visit is built
-- ===========================================================================
--   Ordering is the movement invariant's own key, `(recorded_at, id)`, so
--   historical insertions and two movements sharing a timestamp always pair
--   the same way — the same rule `src/lib/visitTimeline.ts` applies on the
--   client and migration 0094 applies (descending) for the latest movement.
--
--     LEAD(...) OVER (
--       PARTITION BY equipment_id, movement_context
--       ORDER BY recorded_at, id
--     )
--
--   The partition includes `movement_context` because site and workshop are
--   two independent sequences (migration 0040): an open workshop visit must
--   never swallow a site exit.
--
--   The trigger chain (0040/0076/0087/0088) already guarantees a strict
--   ENTRY -> EXIT -> ENTRY sequence per (equipment, context), so the row after
--   an ENTRY is its EXIT whenever one exists. The view still checks
--   `next.movement_type = 'exit'` instead of trusting that, for two reasons:
--     1. RLS runs BEFORE the window function. A foreman reads only their own
--        rows, so if their ENTRY was closed by someone the rule lets close it
--        (an admin running the Excel import or an opening-balance fix; site
--        exits by another foreman are rejected by migration 0087), the EXIT is
--        invisible to them and LEAD returns the NEXT visible row, which is a
--        later ENTRY. Treating "next row is not an exit" as an OPEN visit
--        degrades to "still inside" instead of inventing a visit that ends at
--        the wrong instant.
--     2. Historical rows predate the current trigger set.
--   So `is_open` means "no EXIT is visible to this caller directly after this
--   ENTRY", and `exit_id`/`exit_at`/`exit_supervisor_id` are NULL in that case.
--
--   `duration_minutes` runs to `now()` while the visit is open, which is what
--   the home list shows in its duration column. It is clamped at 0 so a clock
--   skew or a backdated EXIT can never render a negative duration, and it is
--   an integer so no client has to parse an interval.
--
-- ===========================================================================
-- Day boundaries
-- ===========================================================================
--   The view stores instants (`timestamptz`) only and never derives a calendar
--   day, so there is no timezone decision to get wrong here. Every screen that
--   groups visits by day keeps using the Saudi (UTC+03:00) helpers in
--   `src/lib/saudiTime.ts`, exactly as migrations 0090 and 0094 do in SQL.

CREATE OR REPLACE VIEW public.equipment_visits
WITH (security_invoker = true)
AS
WITH paired AS (
  SELECT
    l.id,
    l.equipment_id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.company_id,
    l.project_id,
    l.supervisor_id,
    l.driver_id,
    l.driver_name,
    l.recorded_at,
    LEAD(l.id) OVER visit_order AS next_id,
    LEAD(l.movement_type) OVER visit_order AS next_movement_type,
    LEAD(l.recorded_at) OVER visit_order AS next_recorded_at,
    LEAD(l.supervisor_id) OVER visit_order AS next_supervisor_id
  FROM public.entry_exit_logs l
  WINDOW visit_order AS (
    PARTITION BY l.equipment_id, l.movement_context
    ORDER BY l.recorded_at, l.id
  )
)
SELECT
  p.id AS entry_id,
  CASE WHEN p.next_movement_type = 'exit' THEN p.next_id END AS exit_id,
  p.equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number AS equipment_plate_number,
  -- Normalized digits, so a digits-only search term can probe the plate the
  -- same way `buildMovementSearchFilter()` does on `movement_log_search`.
  e.plate_digits AS equipment_plate_digits,
  p.movement_context,
  -- The purpose is the ENTRY's, always: a workshop EXIT has no purpose column
  -- of its own (migration 0076 blanks it), so this view is how an exit row
  -- inherits the classification of the visit it closed.
  p.workshop_purpose,
  p.company_id,
  c.name_ar AS company_name_ar,
  c.name_en AS company_name_en,
  p.project_id,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  p.supervisor_id AS entry_supervisor_id,
  s.full_name AS entry_supervisor_name,
  CASE
    WHEN p.next_movement_type = 'exit' THEN p.next_supervisor_id
  END AS exit_supervisor_id,
  p.driver_id,
  -- The ENTRY's snapshot. Legacy rows carry only this and no driver record,
  -- so it stays the display value; the list resolves later driver changes the
  -- same way the movement log does.
  p.driver_name,
  p.recorded_at AS entry_at,
  CASE WHEN p.next_movement_type = 'exit' THEN p.next_recorded_at END AS exit_at,
  (p.next_movement_type IS DISTINCT FROM 'exit') AS is_open,
  GREATEST(
    0,
    FLOOR(
      EXTRACT(
        EPOCH FROM (
          CASE
            WHEN p.next_movement_type = 'exit' THEN p.next_recorded_at
            ELSE now()
          END
        ) - p.recorded_at
      ) / 60
    )
  )::int AS duration_minutes
FROM paired p
LEFT JOIN public.equipment e ON e.id = p.equipment_id
LEFT JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id
LEFT JOIN public.profiles s ON s.id = p.supervisor_id
-- Applied after the window: an EXIT is never a visit of its own, it is the end
-- of the ENTRY before it. A lone legacy EXIT therefore does not appear here at
-- all; the equipment inquiry timeline is the screen that still shows those.
WHERE p.movement_type = 'entry';

REVOKE ALL ON public.equipment_visits FROM PUBLIC, anon;
GRANT SELECT ON public.equipment_visits TO authenticated;

COMMENT ON VIEW public.equipment_visits IS
  'One row per visit: each ENTRY paired with the EXIT that follows it in the '
  'same (equipment, movement_context) sequence, ordered deterministically by '
  '(recorded_at, id). is_open is true when no EXIT is visible directly after '
  'the ENTRY, and duration_minutes then runs to now(). workshop_purpose, '
  'company and project are the ENTRY''s, which is how a workshop EXIT '
  'inherits its visit classification. security_invoker, so entry_exit_logs '
  'RLS stays authoritative and a caller never sees a visit built from a '
  'movement the movement log would hide.';

-- ===========================================================================
-- Query plan notes (no new index is added)
-- ===========================================================================
--   * The window's PARTITION BY / ORDER BY is exactly
--     `idx_entry_exit_logs_equipment_context_time`
--     (equipment_id, movement_context, recorded_at, id) from migration 0040,
--     so the LEAD is fed by an ordered index scan with no extra sort node.
--     That index was added for the per-equipment sequence probes; this view is
--     the second consumer of the same ordering and needs nothing new.
--   * A predicate on `equipment_id` or `movement_context` is on the partition
--     key, so the planner pushes it INTO the WindowAgg's input. Both home tabs
--     filter `movement_context`, which is the case that matters: a workshop
--     user's list never scans site movements and vice versa.
--   * A predicate that is NOT on the partition key (`entry_supervisor_id`,
--     `entry_at`, the search ILIKEs) cannot be pushed past the window, so it
--     filters the ENTRY rows afterwards. For a foreman this is harmless: RLS
--     has already reduced the input to their own movements. For the workshop
--     roles the input is the workshop context only.
--   * `ORDER BY entry_at DESC, entry_id DESC LIMIT n` likewise sorts after the
--     window. It is a top-N sort over one row per ENTRY, which the existing
--     entry_exit_logs volumes handle comfortably; a partial index on
--     `recorded_at` for entries was rejected because the planner cannot use it
--     to satisfy an ordering the WindowAgg has to produce first.
--   * If `entry_exit_logs` ever grows past what this scans comfortably, the
--     follow-up is a maintained `exit_log_id` column on the ENTRY row written
--     by the sequence trigger, not a wider view — the pairing is already
--     decided inside that locked trigger.
