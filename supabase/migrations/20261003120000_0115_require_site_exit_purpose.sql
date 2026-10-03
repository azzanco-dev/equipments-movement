-- Migration 0115: the purpose of a SITE exit becomes required in PostgreSQL.
--
-- Migration 0111 added `entry_exit_logs.exit_purpose` with its checks only, so
-- the form live at that time kept working. The form that sends the purpose is
-- now on production (main = 88879ab, 2026-10-03), so the requirement held
-- back in supabase/pending/0112_require_site_exit_purpose.sql is promoted
-- here unchanged.
--
-- A small separate BEFORE INSERT trigger, so enforce_movement_sequence() is
-- not redefined. It fires after that trigger (same timing, name order: 'm' <
-- 's'); neither reads what the other writes, so the order only decides which
-- error a doubly invalid row reports. The admin Excel import (0063) cannot
-- supply a purpose and is exempt through the same predicate 0108 uses for the
-- driver name: the transaction-local marker AND an admin caller.

CREATE OR REPLACE FUNCTION public.enforce_site_exit_purpose()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only a SITE EXIT carries a purpose. Anything sent with another row is
  -- dropped rather than rejected, like the site facts of a workshop row.
  IF NEW.movement_type IS DISTINCT FROM 'exit'
     OR NEW.movement_context IS DISTINCT FROM 'site' THEN
    NEW.exit_purpose := NULL;
    RETURN NEW;
  END IF;

  IF NEW.exit_purpose IS NULL THEN
    -- The admin Excel import (0063) cannot supply a purpose. Same predicate
    -- as the driver-name exemption of 0108: the transaction-local marker set
    -- by public.import_movement_rows AND an admin caller.
    SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
    IF current_setting('app.movement_excel_import', true) = 'true'
       AND v_role = 'admin' THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'exit_purpose_required'
      USING ERRCODE = '23514',
            HINT = 'Choose the purpose of the site exit: maintenance or work_completed.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_site_exit_purpose() IS
  'BEFORE INSERT trigger on entry_exit_logs: clears exit_purpose on entries and workshop rows, and requires it on a site exit (exit_purpose_required) except for the admin Excel import marked by app.movement_excel_import. Fires after enforce_movement_sequence (alphabetical order).';

-- A trigger function is never called directly (0025).
REVOKE ALL ON FUNCTION public.enforce_site_exit_purpose()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_site_exit_purpose ON public.entry_exit_logs;
CREATE TRIGGER enforce_site_exit_purpose
  BEFORE INSERT ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_site_exit_purpose();

-- PostgREST must see the new column before the API sends it.
NOTIFY pgrst, 'reload schema';
