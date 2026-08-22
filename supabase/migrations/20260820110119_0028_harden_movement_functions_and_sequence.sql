/*
# Harden Step 1 — secure movement-state functions + historical sequence validation

## What this migration does (plain English)

### Issue 1: Secure get_last_movement and get_all_equipment_last_movement

Both functions were recreated in migration 0027 (DROP + CREATE), which reset
their EXECUTE grants to the Postgres default (PUBLIC). They were accidentally
callable by the anon role again.

- `get_all_equipment_last_movement()` already returns zero rows for non-admins
  (its body has `WHERE public.is_admin()`). EXECUTE is now revoked from
  anon/PUBLIC so an unauthenticated caller cannot even invoke it.

- `get_last_movement(p_equipment_id)` previously returned the full movement
  record (supervisor, company, project, contractor code) for ANY equipment to
  ANY authenticated caller, because SECURITY DEFINER bypasses the RLS on
  entry_exit_logs. Now:
    * EXECUTE revoked from anon/PUBLIC.
    * For admins: returns all columns as before.
    * For non-admins: returns only movement_type and recorded_at; the
      supervisor_id, company_id, project_id, and contractor_equipment_code
      columns are returned as NULL. A supervisor can still see whether a
      piece of equipment is currently inside or outside (needed for the
      entry/exit form), but cannot see who logged the movement or which
      company/project/contractor-code it belongs to.

No existing RLS policies are changed or weakened.

### Issue 2: Protect historical movement sequence

The previous trigger only checked the *latest* movement for the equipment.
An admin who supplied a custom recorded_at could insert a movement in the
middle of the timeline and create an invalid chronological sequence
(e.g. ENTRY between ENTRY and EXIT, producing ENTRY → ENTRY → EXIT).

The rewritten trigger now:
  1. Finds the movement immediately *before* the new row's position
     (ordered by recorded_at, then id).
  2. Finds the movement immediately *after* the new row's position.
  3. Rejects if the new movement_type equals the before-movement's type
     (no two same-type movements in a row).
  4. Rejects if the new movement_type equals the after-movement's type.
  5. Rejects an EXIT that has no prior movement at all (exit with no entry).
  6. For EXIT inheritance, finds the latest ENTRY *before* the new row's
     recorded_at (not the latest ENTRY in the whole table), so a historical
     exit inherits from the correct entry.

Per-equipment concurrency is still serialized via pg_advisory_xact_lock.

## Functions changed

- `public.enforce_movement_sequence()` — trigger, rewritten with before/after checks
- `public.get_last_movement(uuid)` — body rewritten to redact columns for non-admins
- `public.get_all_equipment_last_movement()` — no body change; EXECUTE grants fixed

## Security

- EXECUTE on both movement-state functions revoked from anon and PUBLIC.
- EXECUTE granted to authenticated only.
- No RLS policy changes.
- The trigger function stays callable only by the table trigger (EXECUTE was
  revoked from all roles in migration 0025 and is not re-granted here).

## Notes

1. Existing movement records are never modified or deleted.
2. Existing entry/exit values are preserved.
3. EXIT still inherits company_id, project_id, and contractor_equipment_code
   from the latest ENTRY before it.
4. Non-admin callers still get recorded_at = now() (no backdating).
5. This migration is safe to re-run (CREATE OR REPLACE for functions whose
   signature is unchanged; grants are idempotent).
*/

-- ─────────────────────────────────────────────────────────
-- Issue 1: Fix EXECUTE grants on movement-state functions
-- ─────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.get_all_equipment_last_movement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_all_equipment_last_movement() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_equipment_last_movement() TO authenticated;

REVOKE ALL ON FUNCTION public.get_last_movement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_last_movement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────
-- Issue 1: Redact sensitive columns for non-admin callers
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_last_movement(p_equipment_id uuid)
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
         CASE WHEN public.is_admin() THEN l.supervisor_id ELSE NULL END AS supervisor_id,
         CASE WHEN public.is_admin() THEN l.company_id   ELSE NULL END AS company_id,
         CASE WHEN public.is_admin() THEN l.project_id   ELSE NULL END AS project_id,
         CASE WHEN public.is_admin() THEN l.contractor_equipment_code ELSE NULL END AS contractor_equipment_code
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = p_equipment_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────
-- Issue 2: Historical sequence validation in the trigger
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before      text;
  v_after       text;
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

  -- Serialize concurrent inserts for the same equipment.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));

  -- Movement immediately BEFORE the new row's chronological position.
  -- "Before" = strictly less than (recorded_at, id) in the combined ordering.
  SELECT l.movement_type INTO v_before
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;

  -- Movement immediately AFTER the new row's chronological position.
  SELECT l.movement_type INTO v_after
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at ASC, l.id ASC
  LIMIT 1;

  -- Rule: no two adjacent movements of the same type.
  IF v_before IS NOT NULL AND v_before = NEW.movement_type THEN
    RAISE EXCEPTION 'the movement before this one is also % — sequence would be invalid', NEW.movement_type;
  END IF;

  IF v_after IS NOT NULL AND v_after = NEW.movement_type THEN
    RAISE EXCEPTION 'the movement after this one is also % — sequence would be invalid', NEW.movement_type;
  END IF;

  -- An exit with no prior movement at all is invalid.
  IF NEW.movement_type = 'exit' AND v_before IS NULL AND v_after IS NULL THEN
    RAISE EXCEPTION 'equipment is not inside the gate';
  END IF;

  -- EXIT inherits company / project / contractor_equipment_code
  -- from the latest ENTRY *before* this exit's recorded_at.
  IF NEW.movement_type = 'exit' THEN
    SELECT l.company_id, l.project_id, l.contractor_equipment_code
      INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
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