-- Workshop equipment list with the current state of each row.
--
-- Reported by the product owner (2026-09-22): the workshop movement form shows
-- no state badges ("داخل موقع", "في الورشة") while the foreman's site ENTRY
-- selector does. The screens share one list component, so the difference is in
-- the data: `search_entry_equipment` (0089) returns the state columns the badge
-- is built from, `search_workshop_equipment` (0076) returns plain equipment
-- columns. Since migration 0098 the workshop roles may read site movements, so
-- showing them "inside a site" is now the expected behaviour rather than a leak.
--
-- What changes: the RETURNS TABLE gains 0089's seven state columns, derived
-- exactly the same way, and the EXIT filter is re-scoped to the workshop (see
-- below). The argument list, the role check, the ownership filter, the searched
-- fields, the ordering and the 20-row limit stay 0076's, so every current caller
-- keeps working unchanged.
--
-- ===========================================================================
-- State derivation (identical to 0089)
-- ===========================================================================
--   * The latest movement per equipment across BOTH contexts, ordered
--     deterministically by (recorded_at DESC, id DESC) exactly like the
--     sequence trigger. `state` is 'none' (never moved), 'outside' (latest
--     movement is an exit), 'inside_workshop' or 'inside_site'.
--   * `state_since` is the open visit's `recorded_at`, the company/project
--     names belong to an open SITE visit only, and the workshop purpose to an
--     open WORKSHOP visit only.
--
-- ===========================================================================
-- EXIT scope (restores 0054)
-- ===========================================================================
-- A workshop EXIT must only list equipment whose latest WORKSHOP movement is
-- an entry, which is what 0054 did. 0076 rewrote that lateral without the
-- `movement_context = 'workshop'` predicate, so equipment sitting inside a
-- SITE also appeared in the workshop exit list; registering that exit would
-- close the site visit with a workshop row. The predicate comes back here.
-- 0076's widening stays: workshop staff share workshop movements, so the exit
-- list is NOT restricted to the person who registered the entry.
--
-- ===========================================================================
-- Security model (same as 0089)
-- ===========================================================================
--   * SECURITY DEFINER, as in 0076: the state must be visible regardless of
--     RLS. Since 0098 the workshop roles can read both contexts, so the
--     definer rights mainly keep this list independent of the read policy
--     rather than widening it. The scope stays narrow either way: only
--     equipment master columns the caller can already read from
--     `public.equipment`, plus a minimal state (where, since when, the
--     company / project names of an open site visit, the workshop purpose).
--     It never returns WHO opened the visit (no supervisor id or name) and no
--     notes, so it cannot be used to read movement rows.
--   * The role check fails closed: `admin` plus the three workshop roles, and
--     a NULL role (no profile row) is rejected explicitly. 0076's
--     `v_role NOT IN (...)` evaluated to NULL for a missing profile, which is
--     not TRUE, so the RAISE was skipped and the list was returned.
--   * `p_movement_type` is checked separately from the role so a bad argument
--     no longer reports "workshop role required".
--   * `search_path` is fixed to `public, pg_temp`, execution is revoked from
--     PUBLIC and anon and granted to `authenticated` only.
--   * `p_ownership_status` is validated against a closed list, and the search
--     term has LIKE wildcards and the LIKE escape character stripped as in
--     0089 so a term can never widen the match. No plate-digits probe: that
--     would change the argument list, and the workshop form does not send one.
--
-- The return type changes, so the function is dropped and re-created in full;
-- this file is the complete definition.

DROP FUNCTION IF EXISTS public.search_workshop_equipment(text, text, text);
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
  state_workshop_purpose text
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
    END AS state_workshop_purpose
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
    AND (p_ownership_status IS NULL OR e.ownership_status = p_ownership_status)
    AND (
      v_term IS NULL
      OR e.code ILIKE '%' || v_term || '%'
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
  'Workshop ENTRY/EXIT equipment list with a minimal current state per row, the same state columns as search_entry_equipment. EXIT lists only equipment whose latest workshop movement is an entry. SECURITY DEFINER so the state does not depend on the movement read policy; returns no supervisor identity and no notes.';

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;
