-- Wave 10: purpose of a SITE exit ("غرض الخروج").
--
-- Owner request 2026-10-01: when an EXIT is recorded, the user chooses its
-- purpose, "for maintenance" or "work completed". Lead decisions: the purpose
-- belongs to SITE exits only (a foreman, or an admin using the site form,
-- closing a site visit); workshop exits and every ENTRY never carry one. It is
-- REQUIRED for a new site exit recorded through the app, with no default.
-- Existing rows keep NULL and keep displaying (the muted dash).
--
-- ===========================================================================
-- What this migration does
-- ===========================================================================
--   1. `entry_exit_logs.exit_purpose text NULL`, values `maintenance` and
--      `work_completed` (CHECK), and a second CHECK that only a SITE EXIT may
--      carry a value. Both checks hold for every existing row (all NULL), and
--      they also guard every UPDATE path (the admin correction of 0108 does
--      not write the column; clients have no UPDATE policy on the table).
--   2. A small separate `BEFORE INSERT` trigger,
--      `enforce_site_exit_purpose`, so the large
--      `public.enforce_movement_sequence()` (0108) is NOT redefined:
--        * an ENTRY or a WORKSHOP row always stores NULL (a value sent by a
--          client is dropped, as the sequence trigger drops site facts on a
--          workshop row);
--        * a SITE EXIT without a purpose raises the stable code
--          `exit_purpose_required` (ERRCODE 23514, check_violation) — except
--          on the admin Excel import (see the insert paths below).
--
-- ===========================================================================
-- Every INSERT path into `entry_exit_logs` (grep of all migrations + app code)
-- ===========================================================================
--   * `app/api/movements/route.ts` — the movement form, with the signed-in
--     user's token. Sends `exit_purpose` for a site exit. Enforced.
--   * Direct PostgREST insert under the `insert_entry_exit_logs` policy (any
--     client that bypasses the API). Same trigger, same rule. Enforced.
--   * `public.import_movement_rows` (0063, admin only) — the Excel import of
--     historical visits. Its spreadsheet has no purpose column and its site
--     exits cannot supply one, so it is EXEMPT. It marks itself with the
--     transaction-local GUC `app.movement_excel_import = 'true'`; the
--     exemption requires that marker AND an `admin` profile for `auth.uid()`,
--     exactly the predicate 0108 (M8) uses for its driver-name exemption.
--     Clients cannot set that GUC through PostgREST. Imported exits store
--     NULL, like every legacy row.
--   * `public.add_workshop_opening_balance` (0041, admin only) — inserts a
--     WORKSHOP ENTRY: forced to NULL, never raises.
--   * 0066 (one-time A282 historical visit, a DO block inside an already
--     applied migration). It inserted a site exit without a purpose, but it
--     runs before this migration on any replay, so the trigger does not exist
--     yet when it runs. Its row stays NULL.
--   * A future data-fix script without a JWT is already rejected by the
--     sequence trigger since 0108 (M4); a script that impersonates an admin
--     must set the import marker or supply a purpose.
--
-- ===========================================================================
-- Trigger firing order
-- ===========================================================================
--   PostgreSQL fires triggers of the same timing and event in alphabetical
--   order of their names: `enforce_movement_sequence` (0021/0108) runs first,
--   `enforce_site_exit_purpose` second ('m' < 's'). The order is safe either
--   way and this one is preferred because:
--     * neither trigger reads a column the other writes: the sequence trigger
--       never reads or writes `exit_purpose`, and this trigger reads only
--       `movement_type` and `movement_context`, which the sequence trigger
--       validates but never changes;
--     * the sequence trigger stays the first authority on role, context and
--       sequence, so a refused caller keeps receiving its established codes
--       (`exit_not_entry_owner`, `exit_equipment_in_workshop`, ...);
--     * this trigger has the last word on `exit_purpose` for the row that is
--       actually stored;
--     * a raise here aborts the whole statement, so the sequence trigger's
--       side effect (restoring `equipment.operational_status` when a
--       maintenance workshop visit closes) is rolled back with it.
--   This trigger does not read the movement chain, so it takes no advisory
--   lock (the sequence trigger already holds the equipment's key).
--
-- ===========================================================================
-- Out of scope
-- ===========================================================================
--   No edit path: `public.admin_update_movement` (0108) is not changed and
--   cannot write the column. `movement_log_search` and the visits view are
--   not changed; they are the natural place for a later list/report column.
--
-- Security: the trigger function is SECURITY DEFINER only to read the
-- caller's role from `profiles` the same way 0108 does; it has a fixed
-- `search_path = public, pg_temp` and is not executable by any client role.

-- `entry_exit_logs` is written by every movement. Fail fast instead of
-- queueing the application behind this migration if another session holds a
-- lock on it.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Column and checks
-- ---------------------------------------------------------------------------
ALTER TABLE public.entry_exit_logs
  ADD COLUMN IF NOT EXISTS exit_purpose text;

ALTER TABLE public.entry_exit_logs
  DROP CONSTRAINT IF EXISTS entry_exit_logs_exit_purpose_check;
ALTER TABLE public.entry_exit_logs
  ADD CONSTRAINT entry_exit_logs_exit_purpose_check
  CHECK (exit_purpose IS NULL OR exit_purpose IN ('maintenance', 'work_completed'));

ALTER TABLE public.entry_exit_logs
  DROP CONSTRAINT IF EXISTS entry_exit_logs_exit_purpose_site_exit_only;
ALTER TABLE public.entry_exit_logs
  ADD CONSTRAINT entry_exit_logs_exit_purpose_site_exit_only
  CHECK (
    exit_purpose IS NULL
    OR (movement_type = 'exit' AND movement_context = 'site')
  );

COMMENT ON COLUMN public.entry_exit_logs.exit_purpose IS
  'Purpose of a SITE exit: maintenance or work_completed. Required for a new site exit by the movement API and form; the database requirement (trigger enforce_site_exit_purpose) follows in a later migration once the new form is live. NULL on every entry, every workshop row and every row recorded before migration 0111.';

-- ---------------------------------------------------------------------------
-- 2. Required rule for a new site exit
-- ---------------------------------------------------------------------------

-- Rollout (2026-10-01). This migration only adds the column and its checks,
-- so the form that is live when it is applied keeps working (it sends no
-- purpose and a NULL is allowed). The API and the new form require the
-- purpose for a new site exit. The database requirement is held back in
-- supabase/pending/0112_require_site_exit_purpose.sql and becomes the next
-- migration once the new form is deployed; applying both together would make
-- every site exit fail on the old form until the deploy finishes.

NOTIFY pgrst, 'reload schema';
