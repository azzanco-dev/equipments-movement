/*
# Step 1 — Equipment Entry/Exit system hardening

## What this migration does (plain English)

1. Adds a new optional `contractor_equipment_code` text column to `entry_exit_logs`.
   This code belongs to the *movement*, not to the equipment master record, because
   the same piece of equipment can carry a different code for each contractor company
   it works under. It is nullable for now.

2. Rewrites the existing `enforce_movement_sequence()` trigger function so that:
   - ENTRY requires `company_id` and `project_id` to be supplied (server-side).
   - EXIT ignores any `company_id`, `project_id`, or `contractor_equipment_code`
     the client tries to send and instead copies them from the equipment's latest
     ENTRY record. The client cannot make an exit belong to a different company
     or project than the one the equipment entered under.
   - The entry/exit sequence is still enforced exactly as before
     (ENTRY → EXIT → ENTRY → EXIT; no ENTRY after ENTRY, no EXIT without a prior
     ENTRY, no EXIT after EXIT).
   - Non-admin callers still have `recorded_at` pinned to `now()`.
   - Concurrency is still serialized per-equipment via `pg_advisory_xact_lock`.

3. Enriches `get_last_movement(p_equipment_id)` so it also returns
   `company_id`, `project_id`, and `contractor_equipment_code`. This gives the
   frontend (later) enough to show the current IN/OUT state, last entry/exit time,
   company, project, and contractor code.

4. Enriches `get_all_equipment_last_movement()` the same way, still admin-only.

## Tables / columns

- `entry_exit_logs`
  - NEW `contractor_equipment_code text` (nullable)

## Functions changed

- `public.enforce_movement_sequence()` — trigger, rewritten
- `public.get_last_movement(uuid)` — dropped then recreated with extra columns
- `public.get_all_equipment_last_movement()` — dropped then recreated with extra columns

## Security

- No new tables, so no new RLS policies.
- `enforce_movement_sequence()` stays callable only by the table trigger (EXECUTE
  was already revoked from anon/authenticated/public in migration 0025).
- `get_last_movement` and `get_all_equipment_last_movement` keep their existing
  EXECUTE grants to `authenticated` only; grants are re-applied after the drop.

## Notes

1. Existing `entry_exit_logs` rows are untouched. The new column is nullable so
   old rows simply have NULL for `contractor_equipment_code`.
2. Existing `movement_type` values (`entry` / `exit`) are preserved — the trigger
   still accepts exactly those two values.
3. `equipment.project_id` is NOT used as a source of truth here; the movement
   history in `entry_exit_logs` is.
4. This migration is safe to re-run: the column add is guarded by a DO block,
   and the functions are `CREATE OR REPLACE` (or dropped first when the return
   shape changes).
*/

-- 1. Add the contractor_equipment_code column if it does not exist yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'entry_exit_logs'
      AND column_name = 'contractor_equipment_code'
  ) THEN
    ALTER TABLE public.entry_exit_logs
      ADD COLUMN contractor_equipment_code text;
  END IF;
END $$;

-- 2. Rewrite the trigger function: entry/exit sequence + exit inheritance + entry requirements
CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last        text;
  v_last_entry  record;
BEGIN
  IF NEW.movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  -- Non-admin callers may not backdate or postdate a movement.
  IF NOT public.is_admin() THEN
    NEW.recorded_at := now();
  END IF;

  -- ENTRY must carry company_id and project_id.
  IF NEW.movement_type = 'entry' THEN
    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION 'company_id is required for an entry';
    END IF;
    IF NEW.project_id IS NULL THEN
      RAISE EXCEPTION 'project_id is required for an entry';
    END IF;
  END IF;

  -- Serialize concurrent inserts for the same equipment so the
  -- sequence check and exit-inheritance below cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));

  -- Latest movement for this equipment, ordered by recorded_at then id.
  SELECT l.movement_type INTO v_last
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  -- Sequence rules
  IF NEW.movement_type = 'entry' AND v_last = 'entry' THEN
    RAISE EXCEPTION 'equipment is already inside the gate';
  END IF;

  IF NEW.movement_type = 'exit' AND (v_last IS NULL OR v_last = 'exit') THEN
    RAISE EXCEPTION 'equipment is not inside the gate';
  END IF;

  -- EXIT inherits company / project / contractor_equipment_code from the latest ENTRY.
  IF NEW.movement_type = 'exit' THEN
    SELECT l.company_id, l.project_id, l.contractor_equipment_code
      INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no prior entry found for this equipment';
    END IF;

    NEW.company_id                := v_last_entry.company_id;
    NEW.project_id                := v_last_entry.project_id;
    NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Enrich get_last_movement with company / project / contractor code
DROP FUNCTION IF EXISTS public.get_last_movement(uuid);

CREATE FUNCTION public.get_last_movement(p_equipment_id uuid)
RETURNS TABLE(
  movement_type text,
  recorded_at timestamptz,
  supervisor_id uuid,
  company_id uuid,
  project_id uuid,
  contractor_equipment_code text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.movement_type,
         l.recorded_at,
         l.supervisor_id,
         l.company_id,
         l.project_id,
         l.contractor_equipment_code
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid) TO authenticated;

-- 4. Enrich get_all_equipment_last_movement the same way (still admin-only)
DROP FUNCTION IF EXISTS public.get_all_equipment_last_movement();

CREATE FUNCTION public.get_all_equipment_last_movement()
RETURNS TABLE(
  equipment_id uuid,
  movement_type text,
  recorded_at timestamptz,
  supervisor_id uuid,
  company_id uuid,
  project_id uuid,
  contractor_equipment_code text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (e.id)
         e.id AS equipment_id,
         l.movement_type,
         l.recorded_at,
         l.supervisor_id,
         l.company_id,
         l.project_id,
         l.contractor_equipment_code
  FROM public.equipment e
  INNER JOIN public.entry_exit_logs l ON l.equipment_id = e.id
  WHERE public.is_admin()
  ORDER BY e.id, l.recorded_at DESC, l.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_equipment_last_movement() TO authenticated;