-- EM-196: equipment code change history (owner spec 2026-09-29, approved to
-- start 2026-10-03). Example: A115 -> F84.
--
-- Why a history and not a note: searching an OLD code must still reach the
-- same equipment; the equipment keeps the same id, so its movements, visits
-- and photos stay continuous; and the audit knows who changed the code, when
-- and why.
--
-- ===========================================================================
-- What this migration does
-- ===========================================================================
--   1. `public.equipment_code_changes`, an APPEND-ONLY audit table. Clients
--      may only SELECT it (same audience as `equipment`: every signed-in
--      user, policy `select_equipment` is `USING (true)` since 0004). There
--      is no INSERT/UPDATE/DELETE policy and no such grant: rows are written
--      only by the trigger in (3).
--   2. `guard_equipment_code_history` (BEFORE INSERT OR UPDATE OF code ON
--      equipment): a code that is a PREVIOUS code of ANOTHER equipment may not
--      be used again (owner rule: an old code is never reused unless the owner
--      decides otherwise). Giving a unit back its OWN previous code stays
--      possible. Stable error: message `equipment_code_previously_used`,
--      ERRCODE 23505 (unique_violation), so every existing duplicate-code
--      mapping in the app already shows "code exists" and the equipment form
--      shows the specific message.
--   3. `record_equipment_code_change` (AFTER UPDATE OF code ON equipment):
--      writes one history row whenever the code really changes, from ANY
--      path (the equipment form, the admin Excel update of 0102, a future
--      script), so the history can never be skipped.
--   4. `admin_change_equipment_code(id, new_code, reason)`: the narrow admin
--      RPC that carries the optional reason (see "Reason path").
--   5. The three movement-form equipment selectors (latest definitions in
--      0102) also match previous codes and return `matched_previous_code`.
--
-- ===========================================================================
-- Code normalisation
-- ===========================================================================
--   The existing duplicate checks compare `upper(btrim(code))` (0047, 0051,
--   0109 quick create; 0059+ movement import matching). The history uses the
--   same normalisation: a change that only differs in case or surrounding
--   spaces (a115 -> A115) is NOT a code change and records nothing, and the
--   reuse rule compares normalised values. The stored `old_code`/`new_code`
--   keep the exact text the equipment row held.
--
-- ===========================================================================
-- Reason path (least invasive design)
-- ===========================================================================
--   Today the admin equipment form updates the row with a plain PostgREST
--   `.update(payload)` under the admin-only `update_equipment` RLS policy;
--   there is no equipment RPC. A transaction-local setting cannot travel
--   with a PostgREST request, so the reason goes through a narrow RPC:
--
--     admin_change_equipment_code(p_equipment_id, p_new_code, p_reason)
--       * SECURITY INVOKER: the UPDATE still runs under the caller's RLS
--         (`update_equipment` is admin-only), plus an explicit admin check
--         so a non-admin gets a clean 42501 instead of "0 rows";
--       * sets `app.equipment_code_change_reason` transaction-locally,
--         updates ONLY `code`, then clears the setting;
--       * the AFTER trigger reads the setting into `reason`.
--
--   The form calls this RPC first only when the code changed, then sends its
--   usual `.update(payload)` with the same code (no second history row,
--   because the code no longer differs). A rejected code (duplicate or a
--   previous code of another unit) therefore fails before anything is
--   written. Every other path that changes `code` (the Excel update) is
--   still recorded, with `reason = NULL`.
--
--   Clients cannot set the GUC themselves through PostgREST, and the reason
--   is descriptive only (it grants nothing), so the setting needs no further
--   protection.
--
-- ===========================================================================
-- Concurrency
-- ===========================================================================
--   The reuse rule spans two tables, so the guard serialises on a per-code
--   advisory key, `hashtextextended('equipment_code:' || upper(btrim(code)),
--   0)`: an INSERT locks the new code, a code UPDATE locks the old and the
--   new code in a fixed (sorted) order. A concurrent insert of A115 therefore
--   waits for the A115 -> F84 change to commit and then sees its history row.
--   The `equipment_code:` prefix keeps these keys apart from the movement
--   chain key `hashtextextended(equipment_id::text, 0)`.
--
-- ===========================================================================
-- Recreated functions (DROP + CREATE, return type gains one column)
-- ===========================================================================
--   `search_entry_equipment(text, text, text)`       latest: 0102
--   `search_site_exit_equipment(text, text, text)`   latest: 0102
--   `search_workshop_equipment(text, text, text)`    latest: 0102
--   Each body is 0102's verbatim (role checks, fleet predicate, filters,
--   ORDER BY e.code, LIMIT 20, SECURITY DEFINER and search_path) with two
--   additions: `OR EXISTS (previous code ILIKE term)` in the search
--   predicate, and the new last column `matched_previous_code boolean`
--   (true when the term matched a previous code but not the current code).
--   CREATE OR REPLACE cannot change a return type, hence DROP + CREATE with
--   the same REVOKE/GRANT. The only caller is `src/components/EntryExitForm.tsx`
--   (supabase.rpc by name, rows read by column name), so the extra column is
--   backward compatible with the deployed UI.
--
--   The equipment list and the inquiry suggestions are PostgREST reads, not
--   functions: the app looks up matching `equipment_code_changes` rows first
--   and adds `id.in.(...)` to its existing filter.

-- ===========================================================================
-- 1. The audit table
-- ===========================================================================

CREATE TABLE public.equipment_code_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  old_code text NOT NULL,
  new_code text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NULL,
  CONSTRAINT equipment_code_changes_reason_length
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT equipment_code_changes_codes_differ
    CHECK (upper(btrim(old_code)) <> upper(btrim(new_code)))
);

COMMENT ON TABLE public.equipment_code_changes IS
  'Append-only history of equipment code changes (EM-196). Written only by the record_equipment_code_change trigger; clients may only read it.';

-- The reuse rule and exact lookups compare the normalised old code.
CREATE INDEX equipment_code_changes_old_code_norm_idx
  ON public.equipment_code_changes (upper(btrim(old_code)));
-- The searches match `old_code ILIKE '%term%'`, like the equipment code
-- itself (equipment_code_trgm_idx, 0035).
CREATE INDEX equipment_code_changes_old_code_trgm_idx
  ON public.equipment_code_changes USING gin (old_code extensions.gin_trgm_ops);
-- Per-equipment history (detail and inquiry pages) and the EXISTS probes.
CREATE INDEX equipment_code_changes_equipment_idx
  ON public.equipment_code_changes (equipment_id, changed_at DESC, id DESC);

ALTER TABLE public.equipment_code_changes ENABLE ROW LEVEL SECURITY;

-- Mirrors `select_equipment` (0004): every signed-in user may read equipment.
CREATE POLICY select_equipment_code_changes ON public.equipment_code_changes
  FOR SELECT TO authenticated
  USING (true);

-- Supabase grants new tables to anon/authenticated by default; take that
-- back and leave read-only access for signed-in users.
REVOKE ALL ON public.equipment_code_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.equipment_code_changes TO authenticated;

-- ===========================================================================
-- 2. Reuse guard: a previous code of another equipment is not available
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.guard_equipment_code_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new text := upper(btrim(NEW.code));
  v_old text;
BEGIN
  IF v_new IS NULL OR v_new = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := upper(btrim(OLD.code));
    IF v_old IS NOT DISTINCT FROM v_new THEN
      RETURN NEW;
    END IF;
    -- Both codes, in a fixed order so two swaps cannot deadlock.
    IF v_old IS NOT NULL AND v_old <> '' THEN
      IF v_old < v_new THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('equipment_code:' || v_old, 0));
        PERFORM pg_advisory_xact_lock(hashtextextended('equipment_code:' || v_new, 0));
      ELSE
        PERFORM pg_advisory_xact_lock(hashtextextended('equipment_code:' || v_new, 0));
        PERFORM pg_advisory_xact_lock(hashtextextended('equipment_code:' || v_old, 0));
      END IF;
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended('equipment_code:' || v_new, 0));
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('equipment_code:' || v_new, 0));
  END IF;

  -- Re-assigning a unit its OWN previous code stays possible.
  IF EXISTS (
    SELECT 1
    FROM public.equipment_code_changes c
    WHERE upper(btrim(c.old_code)) = v_new
      AND c.equipment_id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'equipment_code_previously_used'
      USING ERRCODE = '23505',
            DETAIL = 'The code is a previous code of another equipment.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_equipment_code_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_equipment_code_history ON public.equipment;
CREATE TRIGGER guard_equipment_code_history
  BEFORE INSERT OR UPDATE OF code ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_equipment_code_history();

-- ===========================================================================
-- 3. The writer: one history row per real code change
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.record_equipment_code_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text;
BEGIN
  -- Case or surrounding spaces only: not a code change (see header).
  IF upper(btrim(OLD.code)) IS NOT DISTINCT FROM upper(btrim(NEW.code)) THEN
    RETURN NULL;
  END IF;

  v_reason := NULLIF(btrim(current_setting('app.equipment_code_change_reason', true)), '');

  INSERT INTO public.equipment_code_changes (
    equipment_id, old_code, new_code, changed_by, reason
  ) VALUES (
    NEW.id, OLD.code, NEW.code, auth.uid(), left(v_reason, 500)
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_equipment_code_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_equipment_code_change ON public.equipment;
CREATE TRIGGER record_equipment_code_change
  AFTER UPDATE OF code ON public.equipment
  FOR EACH ROW
  WHEN (OLD.code IS DISTINCT FROM NEW.code)
  EXECUTE FUNCTION public.record_equipment_code_change();

-- ===========================================================================
-- 4. The admin RPC that carries the reason
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_change_equipment_code(
  p_equipment_id uuid,
  p_new_code text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := btrim(p_new_code);
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_equipment_id IS NULL OR v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'equipment_code_required' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'equipment_code_reason_too_long' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.equipment_code_change_reason', COALESCE(v_reason, ''), true);

  UPDATE public.equipment
  SET code = v_code
  WHERE id = p_equipment_id;

  IF NOT FOUND THEN
    PERFORM set_config('app.equipment_code_change_reason', '', true);
    RAISE EXCEPTION 'equipment_not_found' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.equipment_code_change_reason', '', true);
END;
$$;

COMMENT ON FUNCTION public.admin_change_equipment_code(uuid, text, text) IS
  'Admin only. Changes an equipment code and passes the optional reason to the record_equipment_code_change trigger through a transaction-local setting. SECURITY INVOKER: update_equipment RLS stays authoritative.';

REVOKE ALL ON FUNCTION public.admin_change_equipment_code(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_change_equipment_code(uuid, text, text) TO authenticated;

-- ===========================================================================
-- 5. The movement equipment selectors (definitions from 0102)
-- ===========================================================================

DROP FUNCTION IF EXISTS public.search_entry_equipment(text, text, text);
DROP FUNCTION IF EXISTS public.search_site_exit_equipment(text, text, text);
DROP FUNCTION IF EXISTS public.search_workshop_equipment(text, text, text);

CREATE FUNCTION public.search_entry_equipment(
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL,
  p_plate_digits text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  chassis_number text,
  ownership_status text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_term text;
  v_digits text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  v_digits := NULLIF(btrim(p_plate_digits), '');
  IF v_digits IS NOT NULL AND v_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid plate digits';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.chassis_number,
    e.ownership_status,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  -- The latest movement per equipment, ordered deterministically by
  -- (recorded_at, id) exactly like the sequence trigger and 0087/0088.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  WHERE e.is_active
    AND e.status = 'active'
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      OR e.type ILIKE '%' || v_term || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_entry_equipment(text, text, text) IS
  'Site ENTRY equipment list with a minimal current state per row, limited to fleet equipment (is_active AND status = ''active''). SECURITY DEFINER because entry_exit_logs RLS hides other foremen''s movements; returns no supervisor identity and no notes. Since 0114 a previous code (equipment_code_changes.old_code) also matches, flagged by matched_previous_code.';

REVOKE ALL ON FUNCTION public.search_entry_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_entry_equipment(text, text, text) TO authenticated;

CREATE FUNCTION public.search_site_exit_equipment(
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL,
  p_plate_digits text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  chassis_number text,
  ownership_status text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_is_admin boolean;
  v_term text;
  v_digits text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF v_role IS NULL OR v_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'foreman role required';
  END IF;
  v_is_admin := v_role = 'admin';

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');
  v_digits := NULLIF(btrim(p_plate_digits), '');
  IF v_digits IS NOT NULL AND v_digits !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'invalid plate digits';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.chassis_number,
    e.ownership_status,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.supervisor_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  WHERE e.is_active
    AND e.status = 'active'
    -- Only equipment currently inside, i.e. with an open visit.
    AND last_movement.movement_type = 'entry'
    -- A site exit closes a site entry only; equipment inside the workshop is
    -- never offered here (2026-09-19).
    AND last_movement.movement_context = 'site'
    AND (v_is_admin OR last_movement.supervisor_id = auth.uid())
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      OR e.type ILIKE '%' || v_term || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_site_exit_equipment(text, text, text) IS
  'Site EXIT equipment list: fleet equipment (is_active AND status = ''active'') whose latest movement is a site ENTRY the caller may close. SECURITY DEFINER because entry_exit_logs RLS hides other foremen''s movements; returns no supervisor identity and no notes. Since 0114 a previous code (equipment_code_changes.old_code) also matches, flagged by matched_previous_code.';

REVOKE ALL ON FUNCTION public.search_site_exit_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_site_exit_equipment(text, text, text) TO authenticated;

CREATE FUNCTION public.search_workshop_equipment(
  p_movement_type text,
  p_search text DEFAULT NULL,
  p_ownership_status text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  code text,
  type text,
  plate_number text,
  ownership_status text,
  qr_value text,
  is_active boolean,
  master_data_complete boolean,
  numbering_status text,
  state text,
  state_since timestamptz,
  state_company_name_ar text,
  state_company_name_en text,
  state_project_name_ar text,
  state_project_name_en text,
  state_workshop_purpose text,
  matched_previous_code boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_term text;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Fail closed: a missing profile (NULL role) must be rejected too, and
  -- `NULL NOT IN (...)` alone evaluates to NULL, which would let it through.
  IF v_role IS NULL
     OR v_role NOT IN ('admin', 'workshop', 'assistant_workshop_manager', 'workshop_manager') THEN
    RAISE EXCEPTION 'workshop role required';
  END IF;

  IF p_movement_type IS NULL OR p_movement_type NOT IN ('entry', 'exit') THEN
    RAISE EXCEPTION 'invalid movement type';
  END IF;

  IF p_ownership_status IS NOT NULL
     AND p_ownership_status NOT IN ('alazani', 'takween', 'third_party_f', 'third_party_partnership_b', 'external_supplier') THEN
    RAISE EXCEPTION 'invalid ownership status';
  END IF;

  -- LIKE wildcards and the LIKE escape character are stripped so a search term
  -- can never widen the match. chr(92) is the backslash.
  v_term := NULLIF(btrim(translate(p_search, '%_' || chr(92), '')), '');

  RETURN QUERY
  SELECT
    e.id,
    e.code,
    e.type,
    e.plate_number,
    e.ownership_status,
    e.qr_value,
    e.is_active,
    e.master_data_complete,
    e.numbering_status,
    CASE
      WHEN last_movement.movement_type IS NULL THEN 'none'
      WHEN last_movement.movement_type <> 'entry' THEN 'outside'
      WHEN last_movement.movement_context = 'workshop' THEN 'inside_workshop'
      ELSE 'inside_site'
    END::text AS state,
    CASE
      WHEN last_movement.movement_type = 'entry' THEN last_movement.recorded_at
    END AS state_since,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_ar
    END AS state_company_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN co.name_en
    END AS state_company_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_ar
    END AS state_project_name_ar,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'site' THEN pr.name_en
    END AS state_project_name_en,
    CASE
      WHEN last_movement.movement_type = 'entry'
       AND last_movement.movement_context = 'workshop' THEN last_movement.workshop_purpose
    END AS state_workshop_purpose,
    (
      v_term IS NOT NULL
      AND e.code NOT ILIKE '%' || v_term || '%'
      AND EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
    ) AS matched_previous_code
  FROM public.equipment e
  -- The latest movement per equipment in ANY context: this is the state the
  -- badge reports, the same source 0089 uses.
  LEFT JOIN LATERAL (
    SELECT l.movement_type, l.movement_context, l.recorded_at,
           l.workshop_purpose, l.company_id, l.project_id
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_movement ON true
  -- The latest WORKSHOP movement, which decides what a workshop EXIT may
  -- close. Kept separate from the state above on purpose.
  LEFT JOIN LATERAL (
    SELECT l.movement_type
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = e.id
      AND l.movement_context = 'workshop'
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) last_workshop_movement ON true
  LEFT JOIN public.companies co ON co.id = last_movement.company_id
  LEFT JOIN public.projects pr ON pr.id = last_movement.project_id
  WHERE e.is_active
    AND e.status = 'active'
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
      -- 0114: a previous code (A115 -> F84) still finds the same equipment.
      OR EXISTS (
        SELECT 1
        FROM public.equipment_code_changes c
        WHERE c.equipment_id = e.id
          AND c.old_code ILIKE '%' || v_term || '%'
      )
      OR e.type ILIKE '%' || v_term || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
    )
    AND (
      p_movement_type = 'entry'
      OR (
        p_movement_type = 'exit'
        AND last_workshop_movement.movement_type = 'entry'
      )
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_workshop_equipment(text, text, text) IS
  'Workshop ENTRY/EXIT equipment list with a minimal current state per row, limited to fleet equipment (is_active AND status = ''active''). EXIT lists only equipment whose latest workshop movement is an entry. SECURITY DEFINER so the state does not depend on the movement read policy; returns no supervisor identity and no notes. Since 0114 a previous code (equipment_code_changes.old_code) also matches, flagged by matched_previous_code.';

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;
