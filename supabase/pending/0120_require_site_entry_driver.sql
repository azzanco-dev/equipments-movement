-- Migration 0120 (wave 13): the driver becomes required on every SITE ENTRY
-- again, in PostgreSQL.
--
-- !!! APPLY THIS MIGRATION ONLY AFTER THE WAVE 13 UI IS LIVE ON PRODUCTION !!!
-- !!! (THE FORM AND API THAT REQUIRE THE DRIVER). APPLIED EARLIER, IT WOULD !!!
-- !!! MAKE THE LIVE FORM FAIL ON EVERY DRIVERLESS SITE ENTRY.               !!!
--
-- Owner decision 2026-10-05 (D), reversing the decision of 2026-09-23 that
-- made the driver optional (migration 0103; 0108 M8 kept it optional): every
-- site ENTRY recorded through the app names its driver. Workshop entries and
-- exits stay without a driver. Following the 0111 -> 0115 precedent, the new
-- form and API (which already refuse a driverless site entry with the stable
-- code `site_entry_driver_required`) ship first, and this database rule
-- follows once they are live.
--
-- ===========================================================================
-- What this migration does
-- ===========================================================================
--   A small separate BEFORE INSERT trigger, `enforce_site_entry_driver`, in
--   the shape of 0115's `enforce_site_exit_purpose`, so the large
--   `public.enforce_movement_sequence()` (0108) is NOT redefined and its
--   advisory lock, role checks and sequence rules are untouched:
--     * a SITE ENTRY with `driver_id IS NULL` raises the stable code
--       `site_entry_driver_required` (ERRCODE 23514, check_violation);
--     * every other row (a site exit, any workshop row) passes untouched;
--     * the admin Excel import is EXEMPT through exactly the predicate of
--       0108 (M8) and 0115: the transaction-local marker
--       `app.movement_excel_import = 'true'` set by
--       `public.import_movement_rows` (0063) AND an `admin` profile for
--       `auth.uid()`. Clients cannot set that GUC through PostgREST.
--   The trigger never writes NEW, so it cannot change what is stored.
--
-- ===========================================================================
-- Every INSERT path into `entry_exit_logs` (grep of all migrations + app code)
-- ===========================================================================
--   * `app/api/movements/route.ts` — the movement form. Since wave 13 it
--     refuses a site entry without `driver_id` before inserting. Enforced.
--   * Direct PostgREST insert under the `insert_entry_exit_logs` policy (a
--     client that bypasses the API). Same trigger. Enforced.
--   * `public.import_movement_rows` (0063, admin only) — the Excel import of
--     historical visits may carry only a driver name or none. EXEMPT (above).
--   * `public.add_workshop_opening_balance` (0041, admin only) — inserts a
--     WORKSHOP entry: not concerned.
--   * 0066 (one-time A282 visit inside an already applied migration) runs
--     before this trigger exists on any replay.
--
-- ===========================================================================
-- What is NOT changed, and why
-- ===========================================================================
--   * Existing rows: the trigger is BEFORE INSERT only, so open driverless
--     visits (allowed since 0103) are not touched. They can still get a driver
--     through `public.change_active_movement_driver` (0108), which appends a
--     NULL -> driver change (0103 notes), and an admin may still correct
--     their other fields through `public.admin_update_movement` (0108).
--   * `public.admin_update_movement` (0108) is not recreated: it cannot clear
--     a driver. Its `p_driver_id` is applied only when it is NOT NULL and
--     differs from the stored one (`v_driver_changed`); NULL keeps the stored
--     driver. `change_active_movement_driver` resolves its new driver against
--     `public.drivers` and raises `invalid_driver_id` otherwise, so it cannot
--     set NULL either. Clients have no UPDATE policy on `entry_exit_logs`.
--     A BEFORE UPDATE rule is therefore not needed, and is deliberately not
--     added: it would also fire on the admin's correction of a legacy
--     driverless row and refuse it. The admin correction dialog of wave 13
--     refuses a cleared driver on a site entry before calling the API.
--   * `enforce_movement_sequence()` keeps resolving `driver_id` against the
--     driver master (`invalid driver_id`) and snapshotting `driver_name`.
--
-- ===========================================================================
-- Trigger firing order
-- ===========================================================================
--   Triggers of the same timing and event fire in name order:
--   `enforce_movement_sequence` (0021/0108), then `enforce_site_entry_driver`
--   (this one), then `enforce_site_exit_purpose` (0115). Safe in any order:
--     * this trigger reads only `movement_type`, `movement_context` and
--       `driver_id`. The sequence trigger validates the first two without
--       changing them, and on a site entry never changes `driver_id` (it
--       clears it only on a workshop row, which this trigger ignores);
--     * the sequence trigger stays the first authority on role, context and
--       sequence, so a refused caller keeps receiving its established errors;
--     * a raise here aborts the whole statement, including any side effect of
--       the sequence trigger.
--   This trigger does not read the movement chain, so it takes no advisory
--   lock (the sequence trigger already holds the equipment's key).

CREATE OR REPLACE FUNCTION public.enforce_site_entry_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only a SITE ENTRY names a driver. A site exit inherits the visit's
  -- current driver and a workshop row never carries one.
  IF NEW.movement_type IS DISTINCT FROM 'entry'
     OR NEW.movement_context IS DISTINCT FROM 'site'
     OR NEW.driver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- The admin Excel import (0063) may carry a driver name only, or none. Same
  -- predicate as 0108 (M8) and 0115: the transaction-local marker set by
  -- public.import_movement_rows AND an admin caller.
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  IF current_setting('app.movement_excel_import', true) = 'true'
     AND v_role = 'admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'site_entry_driver_required'
    USING ERRCODE = '23514',
          HINT = 'Select the driver of the site entry.';
END;
$$;

COMMENT ON FUNCTION public.enforce_site_entry_driver() IS
  'BEFORE INSERT trigger on entry_exit_logs: a site entry requires driver_id (site_entry_driver_required), except for the admin Excel import marked by app.movement_excel_import. Never writes NEW. Fires after enforce_movement_sequence and before enforce_site_exit_purpose (alphabetical order).';

-- A trigger function is never called directly (0025).
REVOKE ALL ON FUNCTION public.enforce_site_entry_driver()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_site_entry_driver ON public.entry_exit_logs;
CREATE TRIGGER enforce_site_entry_driver
  BEFORE INSERT ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_site_entry_driver();
