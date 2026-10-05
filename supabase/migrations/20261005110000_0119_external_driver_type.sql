-- Migration 0119 (wave 13): the employment type «مورد خارجي» for the drivers
-- of external-supplier equipment, and its automatic use by Quick Create.
--
-- Owner decisions 2026-10-05:
--   A. A new employment type «مورد خارجي» ("external supplier") for the
--      drivers who come with an external supplier's equipment. It is a value
--      of the existing `drivers.employment_type` column, stored exactly as
--      the Arabic string `مورد خارجي` (plain alif, no hamza form).
--   B. When the site movement form quick-creates a NEW driver for a unit whose
--      owner is the external supplier (`equipment.ownership_status =
--      'external_supplier'`), that driver gets the new employment type. The
--      decision is made HERE, from the equipment row, never from a value the
--      client sends. An existing driver is never changed.
--
-- Rollout: apply this migration BEFORE the UI of wave 13 is deployed (the new
-- form sends `p_equipment_id`). It is safe for the UI that is live now, see
-- "Compatibility" below. The driver requirement on a site ENTRY (decision D)
-- is NOT here: it ships later as 0120, after the new UI is live, following the
-- 0111 -> 0115 precedent.
--
-- ===========================================================================
-- 1. `drivers.employment_type` CHECK constraint (A)
-- ===========================================================================
--   Latest definition: the inline column CHECK of 0033
--     employment_type IN ('العزاني', 'تكوين', 'البناء', 'البدراني',
--                         'امدادات العربة', 'نقدي')
--   and 0034 made the column nullable (a NULL passes the CHECK). No later
--   migration touches it (grep of every migration for `employment_type`).
--   The constraint carries PostgreSQL's generated name, which is not trusted:
--   every CHECK constraint whose only column is `employment_type` is looked up
--   in the catalog and dropped, then the same rule is added again under the
--   explicit name `drivers_employment_type_check` with ONE value appended,
--   'مورد خارجي', and the NULL case written out (`IS NULL OR`), which is what
--   the old constraint already allowed. The six existing values are unchanged
--   and in the same order, so every existing row satisfies the new
--   constraint and its validation cannot fail. The frontend list
--   (`DRIVER_EMPLOYMENT_TYPES`, src/lib/driverExcel.ts) changes with it.
--
-- ===========================================================================
-- 2. `public.quick_create_driver` gains `p_equipment_id uuid DEFAULT NULL` (B)
-- ===========================================================================
--   Latest definition: 0109 (`quick_create_driver(text, text)`, section 3,
--   M5); nothing later redefines it (grep). The body below is 0109's
--   VERBATIM — the fail-closed admin/supervisor role check with the
--   `quick_driver_not_allowed` / 42501 error, the `invalid_quick_driver`
--   validation, the deduplication by mobile number that returns the existing
--   driver untouched, SECURITY DEFINER and `search_path = public, pg_temp` —
--   with exactly these changes:
--     * a third argument `p_equipment_id uuid DEFAULT NULL`;
--     * a new local `v_employment_type text`, NULL unless the equipment named
--       by `p_equipment_id` exists AND its `ownership_status` is
--       'external_supplier', in which case it is 'مورد خارجي'. It is read only
--       AFTER the duplicate check, so an existing driver (found by mobile) is
--       returned unchanged and never gets the type;
--     * the INSERT writes `employment_type = v_employment_type`. When it is
--       NULL the row is exactly what 0109 inserted (the column has no
--       default, so 0109's rows were NULL as well).
--   An unknown or NULL `p_equipment_id` is not an error: it simply leaves the
--   type empty, as before. The equipment lookup is a primary-key read of one
--   column; it returns nothing to the caller beyond the new driver row.
--
--   The argument list changes, which `CREATE OR REPLACE FUNCTION` cannot do
--   (it would create a second overload instead). So the two-argument function
--   is DROPPED and the three-argument one CREATED in this same migration (one
--   transaction): no ambiguous overload remains, and there is no moment
--   without a function. Its COMMENT, REVOKE (PUBLIC, anon) and GRANT
--   (authenticated) are repeated for the new signature. No view, policy or
--   other function depends on it (grep), so the DROP needs no CASCADE.
--
-- ===========================================================================
-- Compatibility with the UI that is live (rollout: this migration first)
-- ===========================================================================
--   * Before 0119: unchanged.
--   * After 0119, old UI: the form calls `rpc('quick_create_driver',
--     { p_full_name, p_mobile_number })`. PostgREST resolves a call by the
--     argument names it receives and fills a defaulted parameter, so that
--     call reaches the new function with `p_equipment_id = NULL` and behaves
--     exactly like 0109. `NOTIFY pgrst` at the end reloads PostgREST's schema
--     cache so it sees the new signature at once. The old driver form and
--     the old Excel import do not offer the new value, so nothing creates it
--     until the new UI is deployed.
--   * After 0119, new UI: the form also sends `p_equipment_id`; the list,
--     form, filter and Excel import offer «مورد خارجي».
--   * 0120 (later, after the new UI is live) does not touch either object.

-- The constraint swap takes a brief ACCESS EXCLUSIVE lock on `drivers`, which
-- the movement form reads. Fail fast instead of queueing the application.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. A: the employment type allowlist
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_constraint record;
BEGIN
  -- Every CHECK constraint on `drivers` whose only column is
  -- `employment_type`, whatever its name.
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.drivers'::regclass
      AND c.contype = 'c'
      AND c.conkey = ARRAY[(
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'employment_type'
      )]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.drivers DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_employment_type_check
  CHECK (
    employment_type IS NULL
    OR employment_type IN (
      'العزاني', 'تكوين', 'البناء', 'البدراني', 'امدادات العربة', 'نقدي',
      'مورد خارجي'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. B: Quick Create of a driver decides the employment type in the database
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.quick_create_driver(text, text);

CREATE FUNCTION public.quick_create_driver(
  p_full_name text,
  p_mobile_number text,
  p_equipment_id uuid DEFAULT NULL
)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_driver public.drivers;
  v_role text;
  v_employment_type text;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = auth.uid();
  -- Only the roles that record a site movement may quick-create a driver.
  -- Fail closed: no session and a missing profile (NULL role) are rejected.
  IF auth.uid() IS NULL
     OR v_role IS NULL
     OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'quick_driver_not_allowed'
      USING ERRCODE = '42501',
            HINT = 'Only an admin or a site foreman may quick-create a driver.';
  END IF;

  IF btrim(p_full_name) = '' OR btrim(p_mobile_number) !~ '^\+?[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'invalid_quick_driver';
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE mobile_number = btrim(p_mobile_number)
  LIMIT 1;
  IF FOUND THEN RETURN v_driver; END IF;

  -- wave 13: a NEW driver of an external supplier's unit gets the
  -- external-supplier employment type. Decided from the equipment row; an
  -- unknown or missing equipment leaves the type empty, as before.
  IF p_equipment_id IS NOT NULL THEN
    SELECT 'مورد خارجي' INTO v_employment_type
    FROM public.equipment e
    WHERE e.id = p_equipment_id
      AND e.ownership_status = 'external_supplier';
  END IF;

  INSERT INTO public.drivers(full_name, mobile_number, employment_type)
  VALUES (btrim(p_full_name), btrim(p_mobile_number), v_employment_type)
  RETURNING * INTO v_driver;
  RETURN v_driver;
END;
$$;

COMMENT ON FUNCTION public.quick_create_driver(text, text, uuid) IS
  'Quick Create of a driver from the site movement form: full name and mobile number only, deduplicated by mobile number (an existing driver is returned unchanged). A NEW driver gets employment_type ''مورد خارجي'' when p_equipment_id names an external_supplier unit. Admin and supervisor only.';

REVOKE ALL ON FUNCTION public.quick_create_driver(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_driver(text, text, uuid) TO authenticated;

-- PostgREST must see the new signature before the new form calls it.
NOTIFY pgrst, 'reload schema';
