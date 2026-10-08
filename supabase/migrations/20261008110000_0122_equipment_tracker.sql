-- Migration 0122 (wave 17): link equipment to its Afaqy AVL tracker unit.
--
-- !!! APPLY THIS MIGRATION BEFORE DEPLOYING THE WAVE 17 UI. The new admin   !!!
-- !!! routes (`/api/afaqy/sync`, `/api/afaqy/position`) and the equipment   !!!
-- !!! form read and write the three columns below; without them those      !!!
-- !!! requests fail (the UI shows its error state, nothing else breaks).    !!!
--
-- Owner request (wave 17, approved 2026-10-08): the admin links each
-- equipment to the Afaqy GPS unit installed on it, so the equipment detail
-- and inquiry pages can show the unit's last position to the admin. The
-- Afaqy credentials stay server-side (route handlers only); the database
-- keeps only the link.
--
-- ===========================================================================
-- What this migration adds
-- ===========================================================================
--   Three NULLable columns on `public.equipment` (no default, so every
--   existing row is "not linked" and nothing is rewritten):
--     tracker_unit_id    text         the Afaqy unit `_id` (a 24-hex id)
--     tracker_unit_name  text         the unit name as Afaqy showed it when
--                                     linked, e.g. "(A055) 8631 URA", for
--                                     display only
--     tracker_linked_at  timestamptz  when the link was made
--   Two CHECK constraints (validated when added; every existing row is all
--   NULL, so validation cannot fail):
--     equipment_tracker_unit_id_format  the id is NULL or 24 hex characters
--                                       (the probed Afaqy id format), so a
--                                       free text can never be stored as an
--                                       id; the name is at most 200 chars.
--     equipment_tracker_link_complete   the three columns move together: no
--                                       id means no name and no time; an id
--                                       always has its time.
--   One partial UNIQUE index, `equipment_tracker_unit_id_key`, on
--   `tracker_unit_id WHERE tracker_unit_id IS NOT NULL`: one unit is linked
--   to at most one equipment (a second link fails with 23505, which the sync
--   route reports as a conflict). It also serves the lookups by unit id.
--
-- ===========================================================================
-- Authorization (why there is no new policy or trigger)
-- ===========================================================================
--   Writes: the latest `equipment` policies are 0004's (no later migration
--   redefines them; grep of every migration for `ON equipment` /
--   `ON public.equipment`):
--     insert_equipment  WITH CHECK (public.is_admin())
--     update_equipment  USING / WITH CHECK (public.is_admin())
--     delete_equipment  USING (public.is_admin())
--   so only an admin can write these columns through PostgREST. Every
--   SECURITY DEFINER function that writes `equipment` (quick create 0049 /
--   0064 / 0109, the movement status triggers, the admin Excel update of
--   0102, `admin_change_equipment_code` of 0114 which is INVOKER anyway)
--   names its columns explicitly and none of them names a tracker column, so
--   no non-admin path can set them. A guard trigger would add nothing, so
--   none is added (AGENTS.md: keep it minimal).
--   Reads: `select_equipment` is `USING (true)` (every signed-in role), so the
--   link is readable like the rest of the row. It is not secret: the unit id
--   is useless without the Afaqy credentials, which never leave the server,
--   and the name repeats the code and plate the row already holds. The
--   POSITION is only ever read through the admin-only route.
--
-- ===========================================================================
-- Compatibility
-- ===========================================================================
--   Purely additive. No view or function selects `equipment.*` into a fixed
--   shape (grep: no `e.*`, `SETOF public.equipment` or `%ROWTYPE` of it), so
--   no recreated object is needed. Client reads that use `select('*')` on
--   `equipment` (the detail page, the edit deep link) simply receive three
--   more keys. The live UI never sends these columns, so it is unaffected.
-- ===========================================================================

ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS tracker_unit_id text NULL,
  ADD COLUMN IF NOT EXISTS tracker_unit_name text NULL,
  ADD COLUMN IF NOT EXISTS tracker_linked_at timestamptz NULL;

ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_tracker_unit_id_format;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_tracker_unit_id_format CHECK (
    (tracker_unit_id IS NULL OR tracker_unit_id ~ '^[0-9a-fA-F]{24}$')
    AND (tracker_unit_name IS NULL OR char_length(tracker_unit_name) <= 200)
  );

ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_tracker_link_complete;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_tracker_link_complete CHECK (
    (tracker_unit_id IS NULL
      AND tracker_unit_name IS NULL
      AND tracker_linked_at IS NULL)
    OR (tracker_unit_id IS NOT NULL AND tracker_linked_at IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS equipment_tracker_unit_id_key
  ON public.equipment (tracker_unit_id)
  WHERE tracker_unit_id IS NOT NULL;

COMMENT ON COLUMN public.equipment.tracker_unit_id IS
  'wave 17 (0122): the Afaqy AVL unit `_id` installed on this equipment (24 hex). NULL = not linked. Unique among linked rows. Written by the admin only (update_equipment RLS).';
COMMENT ON COLUMN public.equipment.tracker_unit_name IS
  'wave 17 (0122): the Afaqy unit name as seen when linked, e.g. "(A055) 8631 URA". Display only; NULL when not linked.';
COMMENT ON COLUMN public.equipment.tracker_linked_at IS
  'wave 17 (0122): when the tracker link was made. NULL exactly when tracker_unit_id is NULL.';
