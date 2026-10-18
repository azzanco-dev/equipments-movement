-- 0135: workshop purpose at INSERT, equipment code format, search_path hardening
--
-- Security audit run-1 (source-only, 2026-10-18), owner review 2026-10-18.
-- Three independent changes, each marked with the fingerprint of the record
-- it closes. Every object is re-created with CREATE OR REPLACE from its
-- latest definition (0127 for all four functions; 0133 and 0134 did not
-- redefine any of them) and is VERBATIM except for the commented clauses.
--
--   1. em:entry_exit_logs:insert:workshop_purpose  (CONFIRMED, low)
--      A holder of movements.workshop.create without
--      movements.workshop.classify could insert a workshop ENTRY straight
--      through PostgREST with `workshop_purpose` already set, bypassing
--      classify_workshop_entry. The stored value became the unit's derived
--      state (0125). enforce_movement_sequence now clears the purpose on
--      INSERT unless the caller holds the classify key. The Excel import
--      never sets a purpose, so the app.movement_excel_import branch is
--      untouched.
--
--   2. em:notice-text:equipment-code-from-workshop-quick-create
--      quick_create_workshop_equipment stored any non-empty text as
--      `equipment.code` (only upper/btrim, emptiness and duplicate checks),
--      and the code opens every WhatsApp notice sent from the company number.
--      The RPC now accepts 1 to 30 characters of letters, digits, space, `_`
--      and `-` only (token `invalid_equipment_code`, SQLSTATE 22023), and the
--      table gets the same rule as the NOT VALID check
--      `equipment_code_format_check`, so every insert and update path obeys
--      it while existing rows are not re-validated. The check accepts both
--      letter cases: update_equipment_from_excel (0134), the admin form and
--      admin_change_equipment_code store the code as typed (btrim only) and
--      every comparison in the schema is `upper(btrim(code))`, so case is
--      never significant and no path has to change. Production codes verified
--      read-only on 2026-10-18: 802 rows, longest 8 characters, nothing but
--      letters, digits and `-`.
--
--   3. Hunter hardening note: search_workshop_opening_candidates and
--      add_workshop_opening_balance are SECURITY DEFINER with
--      `SET search_path = public` (no pg_temp). They get
--      `SET search_path = public, pg_temp` like every other definer function
--      of 0127; bodies verbatim.
--
-- Rollout: no UI depends on this migration. The client rule of the same code
-- format (quickEquipmentFormSchema) only adds a message before the round
-- trip, and the database tokens are mapped to the code field either way.

-- ===========================================================================
-- 1. enforce_movement_sequence: the purpose needs movements.workshop.classify
-- ===========================================================================
-- em:entry_exit_logs:insert:workshop_purpose
-- 0127 verbatim plus the clause before RETURN NEW.
CREATE OR REPLACE FUNCTION public.enforce_movement_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before text;
  v_after text;
  v_last_entry record;
  v_role text;
BEGIN
  NEW.created_at := now();
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF NEW.movement_type NOT IN ('entry', 'exit')
     OR NEW.movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement';
  END IF;
  IF NEW.recorded_at > now() THEN
    RAISE EXCEPTION 'movement time cannot be in the future';
  END IF;

  IF NEW.movement_context = 'workshop' THEN
    -- Fail closed: a missing profile (NULL role) is rejected too, because
    -- `NULL NOT IN (...)` alone evaluates to NULL and would not raise.
    IF NOT public.has_permission('movements.workshop.create') THEN
      RAISE EXCEPTION 'workshop role required';
    END IF;
    NEW.company_id := NULL;
    NEW.project_id := NULL;
    NEW.contractor_equipment_code := NULL;
    NEW.driver_id := NULL;
    NEW.driver_name := NULL;
  ELSE
    IF NOT public.has_permission('movements.site.create') THEN
      RAISE EXCEPTION 'foreman role required';
    END IF;
    IF NEW.movement_type = 'entry' THEN
      IF NEW.company_id IS NULL THEN RAISE EXCEPTION 'company_id is required for an entry'; END IF;
      IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'project_id is required for an entry'; END IF;
      -- Owner decision 2026-09-23: a site ENTRY may be registered without a
      -- driver. A supplied `driver_id` is resolved against the driver master
      -- so the `driver_name` snapshot can never be forged.
      IF NEW.driver_id IS NULL THEN
        -- A driverless entry stores NULL in both columns. A name without an
        -- id is kept only for the admin Excel import (0063), the one path
        -- that legitimately writes one.
        IF current_setting('app.movement_excel_import', true) = 'true'
           AND public.has_permission('movements.import') THEN
          NEW.driver_name := NULLIF(btrim(NEW.driver_name), '');
        ELSE
          NEW.driver_name := NULL;
        END IF;
      ELSE
        SELECT d.full_name INTO NEW.driver_name
        FROM public.drivers d
        WHERE d.id = NEW.driver_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'invalid driver_id'; END IF;
      END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.equipment_id::text, 0));
  SELECT l.movement_type INTO v_before
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  SELECT l.movement_type INTO v_after
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = NEW.equipment_id
    AND (l.recorded_at, l.id) > (NEW.recorded_at, NEW.id)
  ORDER BY l.recorded_at, l.id
  LIMIT 1;

  IF (v_before IS NOT NULL AND v_before = NEW.movement_type)
     OR (v_after IS NOT NULL AND v_after = NEW.movement_type) THEN
    RAISE EXCEPTION 'sequence would be invalid';
  END IF;
  IF NEW.movement_type = 'exit' AND v_before IS NULL THEN
    RAISE EXCEPTION 'no prior entry found for this equipment';
  END IF;

  IF NEW.movement_type = 'exit' THEN
    SELECT l.* INTO v_last_entry
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = NEW.equipment_id
      AND l.movement_type = 'entry'
      AND (l.recorded_at, l.id) < (NEW.recorded_at, NEW.id)
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'no prior entry found for this equipment'; END IF;

    -- Owner decisions 2026-09-17, 2026-09-19 and 2026-09-30: an EXIT closes
    -- an ENTRY of its OWN context only, and a site exit only for the foreman
    -- who opened the visit. Admins are exempt from both.
    IF NOT public.has_permission('movements.exit_cross_context') THEN
      IF NEW.movement_context = 'site' THEN
        IF v_last_entry.movement_context IS DISTINCT FROM 'site' THEN
          RAISE EXCEPTION 'exit_equipment_in_workshop'
            USING ERRCODE = '42501',
                  HINT = 'The equipment is inside the workshop; a site exit cannot close a workshop entry.';
        END IF;
        IF public.movement_scope_allows(
             public.permission_scope('movements.site.create'),
             v_last_entry.supervisor_id,
             v_last_entry.movement_context,
             v_last_entry.company_id
           ) IS NOT TRUE THEN
          RAISE EXCEPTION 'exit_not_entry_owner'
            USING ERRCODE = '42501',
                  HINT = 'Only the foreman who registered the entry, or an admin, may register this exit.';
        END IF;
      ELSE
        IF v_last_entry.movement_context IS DISTINCT FROM 'workshop' THEN
          RAISE EXCEPTION 'exit_equipment_on_site'
            USING ERRCODE = '42501',
                  HINT = 'The equipment is inside a site; a workshop exit cannot close a site entry.';
        END IF;
      END IF;
    END IF;

    NEW.company_id := v_last_entry.company_id;
    NEW.project_id := v_last_entry.project_id;
    NEW.contractor_equipment_code := v_last_entry.contractor_equipment_code;
    IF NEW.movement_context = 'site' THEN
      -- Both branches may assign NULL: since 2026-09-23 the open visit may
      -- have been opened without a driver, and an exit that inherits NULL is
      -- correct rather than an error.
      SELECT c.new_driver_id, c.new_driver_name INTO NEW.driver_id, NEW.driver_name
      FROM public.movement_driver_changes c
      WHERE c.entry_log_id = v_last_entry.id
      ORDER BY c.changed_at DESC, c.id DESC
      LIMIT 1;
      IF NOT FOUND THEN
        NEW.driver_id := v_last_entry.driver_id;
        NEW.driver_name := v_last_entry.driver_name;
      END IF;
    END IF;
    -- 0125: the operational_status restore that stood here is removed; the
    -- equipment state is derived from the latest movement instead.
  END IF;
  -- 0135 (em:entry_exit_logs:insert:workshop_purpose): a new row starts
  -- unclassified unless the caller holds movements.workshop.classify, the
  -- key classify_workshop_entry requires. Cleared silently (not raised) so
  -- the movement itself is never refused for the purpose alone.
  IF NEW.workshop_purpose IS NOT NULL
     AND NOT public.has_permission('movements.workshop.classify') THEN
    NEW.workshop_purpose := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_movement_sequence()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_movement_sequence() IS
  '0135: 0127 verbatim plus the workshop_purpose clause (em:entry_exit_logs:insert:workshop_purpose): a purpose supplied at INSERT is cleared unless the caller holds movements.workshop.classify.';

COMMENT ON COLUMN public.entry_exit_logs.workshop_purpose IS
  'Classification of a workshop ENTRY: maintenance (صيانة), parking (وقوف) '
  'or out_of_service (خارج الخدمة, since 0125); NULL until classified and on '
  'every other row. Written only by classify_workshop_entry; since 0135 the '
  'sequence trigger clears a value supplied at INSERT by a caller without '
  'movements.workshop.classify.';

-- ===========================================================================
-- 2. The equipment code format: quick create and the table check
-- ===========================================================================
-- em:notice-text:equipment-code-from-workshop-quick-create
-- quick_create_workshop_equipment: 0127 verbatim plus the format check after
-- the emptiness check.
CREATE OR REPLACE FUNCTION public.quick_create_workshop_equipment(
  p_numbering_status text,
  p_code text,
  p_plate_number text
)
RETURNS public.equipment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_equipment public.equipment;
  v_plate text := upper(btrim(p_plate_number));
  v_code text;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF COALESCE(public.permission_scope('equipment.quick_create'), '') NOT IN ('all', 'workshop')
     OR p_numbering_status NOT IN ('numbered', 'unnumbered')
     OR v_plate = '' THEN
    RAISE EXCEPTION 'invalid_workshop_equipment';
  END IF;

  SELECT * INTO v_equipment
  FROM public.equipment
  WHERE upper(btrim(plate_number)) = v_plate
  LIMIT 1;
  IF FOUND THEN RETURN v_equipment; END IF;

  IF p_numbering_status = 'numbered' THEN
    v_code := upper(btrim(p_code));
    IF v_code = '' THEN RAISE EXCEPTION 'equipment code required'; END IF;
    -- 0135 (em:notice-text:equipment-code-from-workshop-quick-create): the
    -- code opens every WhatsApp notice, so it is letters, digits, space,
    -- `_` and `-` only, at most 30 characters. Same rule as
    -- equipment_code_format_check below; the client maps the token.
    IF char_length(v_code) > 30 OR v_code !~ '^[A-Z0-9][A-Z0-9 _-]*$' THEN
      RAISE EXCEPTION 'invalid_equipment_code' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.equipment WHERE upper(btrim(code)) = v_code) THEN
      RAISE EXCEPTION 'duplicate equipment code';
    END IF;
  ELSE
    LOOP
      v_code := 'U' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = v_code);
    END LOOP;
  END IF;

  INSERT INTO public.equipment(
    code, type, plate_number, operational_status, ownership_status,
    qr_value, master_data_complete, numbering_status
  )
  VALUES (
    v_code, 'غير محدد', v_plate, 'operational', 'alazani',
    gen_random_uuid()::text, false, p_numbering_status
  )
  RETURNING * INTO v_equipment;
  RETURN v_equipment;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_create_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quick_create_workshop_equipment(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.quick_create_workshop_equipment(text, text, text) IS
  '0135: 0127 verbatim plus the code format check (em:notice-text:equipment-code-from-workshop-quick-create): a numbered code is 1 to 30 characters of letters, digits, space, _ and - (token invalid_equipment_code, 22023). Gate: equipment.quick_create scope all or workshop.';

-- The same rule for every insert and update path (admin form, Excel import
-- and update, admin_change_equipment_code, the quick creates). NOT VALID:
-- existing rows are not re-validated, and a row whose code already breaks
-- the rule keeps saving until its code changes (PostgreSQL checks a NOT VALID
-- constraint on every INSERT and on every UPDATE of the row). Both letter
-- cases are accepted (see the header).
ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_code_format_check;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_code_format_check
  CHECK (
    char_length(code) <= 30
    AND code ~ '^[A-Za-z0-9][A-Za-z0-9 _-]*$'
  ) NOT VALID;

COMMENT ON CONSTRAINT equipment_code_format_check ON public.equipment IS
  '0135 (em:notice-text:equipment-code-from-workshop-quick-create): the code is 1 to 30 characters of letters, digits, space, _ and - (both cases). NOT VALID: existing rows are not re-validated.';

-- ===========================================================================
-- 3. search_path hardening of two SECURITY DEFINER functions
-- ===========================================================================
-- Hunter hardening note: `SET search_path = public` without pg_temp.
-- Both bodies 0127 verbatim; only the SET clause changes.
CREATE OR REPLACE FUNCTION public.search_workshop_opening_candidates(p_search text DEFAULT NULL)
RETURNS TABLE(id uuid, code text, type text, plate_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_permission('movements.import') THEN RAISE EXCEPTION 'admin required'; END IF;
  RETURN QUERY SELECT e.id,e.code,e.type,e.plate_number FROM public.equipment e
  WHERE e.is_active
    AND NOT EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id=e.id AND l.movement_context='workshop')
    AND (NULLIF(btrim(p_search),'') IS NULL OR e.code ILIKE '%'||btrim(p_search)||'%' OR e.type ILIKE '%'||btrim(p_search)||'%' OR e.plate_number ILIKE '%'||btrim(p_search)||'%')
  ORDER BY e.code LIMIT 20;
END; $$;

REVOKE ALL ON FUNCTION public.search_workshop_opening_candidates(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_opening_candidates(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_workshop_opening_balance(p_equipment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_log_id uuid;
BEGIN
  IF NOT public.has_permission('movements.import') THEN RAISE EXCEPTION 'admin required'; END IF;
  IF EXISTS (SELECT 1 FROM public.entry_exit_logs l WHERE l.equipment_id=p_equipment_id AND l.movement_context='workshop') THEN
    RAISE EXCEPTION 'workshop movement already exists';
  END IF;
  INSERT INTO public.entry_exit_logs(equipment_id,supervisor_id,movement_type,movement_context,registration_method,notes,recorded_at)
  VALUES (p_equipment_id,auth.uid(),'entry','workshop','manual','رصيد افتتاحي للورشة',now()) RETURNING id INTO v_log_id;
  RETURN v_log_id;
END; $$;

REVOKE ALL ON FUNCTION public.add_workshop_opening_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_workshop_opening_balance(uuid) TO authenticated;
