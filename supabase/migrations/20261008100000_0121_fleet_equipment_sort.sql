-- ===========================================================================
-- Migration 0121 (wave 16): column sorting for the admin home fleet mini
-- tables.
--
-- !!! APPLY THIS MIGRATION BEFORE DEPLOYING THE WAVE 16 UI. The new UI      !!!
-- !!! sends `p_sort` when a header is clicked; without this migration that  !!!
-- !!! call finds no function and the expanded table shows its load error.   !!!
--
-- Owner request 2026-10-08. The three state mini tables of the admin home
-- («داخل المشاريع», «داخل الورشة», «المتاحة») read one page at a time from
-- `get_admin_fleet_equipment` (collapsed: 7 rows; expanded: the shared
-- DataTable with pages of 20; the Excel export walks it in pages of 500).
-- Their order was fixed to the latest movement first. The expanded tables
-- now sort by a clicked column, and because the rows are paged by the
-- database, the sort has to happen in the database too: sorting one page in
-- the browser would order 20 rows of an unsorted whole.
--
-- ===========================================================================
-- The recreated object
-- ===========================================================================
--   `public.get_admin_fleet_equipment` latest: 0118 (whose body is 0107's
--   verbatim plus `last_exit_purpose`). The body below is 0118's VERBATIM -
--   the RETURNS TABLE (unchanged, 16 columns), SECURITY INVOKER with
--   `SET search_path = public, pg_temp`, the fail-closed admin/monitor role
--   check, the allowlisted p_state / p_purpose, the owner filter through
--   `admin_home_owner_filter`, the clamped p_limit (1..500) / p_offset (>= 0),
--   the fleet predicate and `count(*) OVER ()` - with exactly these changes:
--     1. ONE new trailing parameter, `p_sort text DEFAULT NULL`.
--     2. ONE new local, `v_sort text := COALESCE(p_sort, 'last_movement_desc')`.
--     3. ONE new check after the purpose checks: `v_sort` must be one of the
--        allowlisted values below, otherwise `unknown fleet sort` is raised
--        with ERRCODE 22023, like an unknown state or purpose.
--     4. The ORDER BY gains one `CASE WHEN v_sort = ... END` term per
--        allowlisted value in front of the old order, which stays as the
--        tail: `s.last_movement_at DESC NULLS LAST, s.id`. A term whose value
--        is not the requested one is NULL on every row and orders nothing,
--        so with the default the order is exactly 0118's, and every order
--        ends with `s.id`, so paging stays deterministic (a row can never
--        appear on two pages or on none).
--
--   Allowlisted `p_sort` values (NULL = `last_movement_desc`):
--     last_movement_desc  latest movement first, never moved last (default,
--                         0107's order)
--     last_movement_asc   oldest movement first, never moved still last
--     code_asc / code_desc               `s.code`
--     type_asc / type_desc               `s.type`
--     owner_asc / owner_desc             the owner in the fixed order the
--                                        app lists owners in (alazani,
--                                        takween, third_party_f,
--                                        third_party_partnership_b,
--                                        external_supplier), not the raw key
--     company_asc / company_desc         the company Arabic name, then the
--                                        project Arabic name (`name_ar`, the
--                                        values the function returns and the
--                                        Arabic UI shows)
--     workshop_purpose_asc / _desc       maintenance, parking, unclassified
--                                        (NULL purpose = «غير مصنف», a real
--                                        displayed value, so it is ranked 3
--                                        rather than pushed last)
--     exit_purpose_asc / _desc           `s.last_exit_purpose`
--                                        (maintenance, work_completed)
--   Text is compared with the column's default collation, the same order the
--   shared lists get from PostgREST `.order()` (no migration sets a COLLATE).
--   Empty values (no company, no exit purpose, never moved) are NULLS LAST in
--   both directions, like the visits list (`nullsFirst: false`). Within equal
--   values the rows keep the default order (latest movement first, then id).
--
-- ===========================================================================
-- Why DROP + CREATE, and compatibility (rollout: this migration, then UI)
-- ===========================================================================
--   The argument list changes, and `CREATE OR REPLACE FUNCTION` with a new
--   argument list does not replace: it adds a second overload. Two overloads
--   would make the live UI's call ambiguous (its five named arguments match
--   both, and PostgREST answers PGRST203 "could not choose the best candidate
--   function"). So the five-argument signature is DROPPED and the
--   six-argument one CREATED in this same file (one transaction), and the
--   REVOKE, GRANT and COMMENT are repeated for the new signature.
--     * Before 0121: the live UI calls the five-argument function; nothing
--       changes.
--     * After 0121, live (old) UI: it still sends `p_state`, `p_owners`,
--       `p_purpose`, `p_limit`, `p_offset` by name. PostgREST resolves named
--       arguments against the only `get_admin_fleet_equipment` left, whose
--       sixth argument has a default, so the call resolves without ambiguity
--       and returns the same 16 columns in the same order (`p_sort` NULL =
--       the old order). The schema cache is reloaded at the end of the file.
--     * After 0121, new UI: the default order still omits `p_sort` (the
--       payload is identical to the old UI's); a clicked header sends one of
--       the allowlisted values, which the client allowlists as well.
--     * New UI WITHOUT 0121 (wrong order): the default view still works, but
--       a header click sends `p_sort`, which no function accepts (PGRST202),
--       and the table shows its error state. Hence: migration first.
--   No other SQL object calls this function (grep of all migrations).
--
-- ===========================================================================
-- Security - unchanged
-- ===========================================================================
--   SECURITY INVOKER (no DEFINER), so equipment / entry_exit_logs /
--   companies / projects RLS stay authoritative; the explicit role check
--   rejects a NULL role; fixed search_path; `REVOKE ALL ... FROM PUBLIC,
--   anon` and `GRANT EXECUTE ... TO authenticated`. `p_sort` only ever
--   selects one of the fixed ORDER BY terms written below: it is compared,
--   never concatenated into SQL.
--
-- ===========================================================================
-- Indexes
-- ===========================================================================
--   None. The function already reads every active unit through the
--   `admin_equipment_state` view (a lateral latest-movement lookup per unit,
--   served by the existing indexes) before it can count and page them, so
--   the sort is applied to that in-memory set whichever key is chosen; the
--   fleet is a few thousand rows at most.

-- The argument list changes, which CREATE OR REPLACE cannot do: the
-- five-argument function is dropped and the six-argument one created in this
-- same transaction.
DROP FUNCTION IF EXISTS public.get_admin_fleet_equipment(text, text[], text, int, int);

CREATE FUNCTION public.get_admin_fleet_equipment(
  p_state text,
  p_owners text[] DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_limit int DEFAULT 7,
  p_offset int DEFAULT 0,
  p_sort text DEFAULT NULL
)
RETURNS TABLE(
  total_count int,
  id uuid,
  code text,
  type text,
  ownership_status text,
  state text,
  since timestamptz,
  last_movement_id uuid,
  last_movement_type text,
  last_movement_context text,
  workshop_purpose text,
  company_name_ar text,
  company_name_en text,
  project_name_ar text,
  project_name_en text,
  last_exit_purpose text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  -- 500 is the largest page size the shared list system offers, and the
  -- Excel export walks the function in pages of 500.
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 7), 1), 500);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_owners text[];
  v_states text[];
  -- 0121: the requested order; NULL is the order the tables always had.
  v_sort text := COALESCE(p_sort, 'last_movement_desc');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'monitor') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_state IS NULL
     OR p_state NOT IN ('inside_site', 'workshop', 'available') THEN
    RAISE EXCEPTION 'unknown fleet state' USING ERRCODE = '22023';
  END IF;
  IF p_purpose IS NOT NULL THEN
    IF p_state <> 'workshop' THEN
      RAISE EXCEPTION 'a workshop purpose requires the workshop state'
        USING ERRCODE = '22023';
    END IF;
    IF p_purpose NOT IN ('maintenance', 'parking', 'unclassified') THEN
      RAISE EXCEPTION 'unknown workshop purpose' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- 0121: allowlisted, like p_state and p_purpose.
  IF v_sort NOT IN (
    'last_movement_desc', 'last_movement_asc',
    'code_asc', 'code_desc',
    'type_asc', 'type_desc',
    'owner_asc', 'owner_desc',
    'company_asc', 'company_desc',
    'workshop_purpose_asc', 'workshop_purpose_desc',
    'exit_purpose_asc', 'exit_purpose_desc'
  ) THEN
    RAISE EXCEPTION 'unknown fleet sort' USING ERRCODE = '22023';
  END IF;
  v_owners := public.admin_home_owner_filter(p_owners);

  -- The `state` values of `admin_equipment_state` this request covers.
  -- "workshop" is the union of the three workshop states, exactly as the
  -- "في الورشة الان" card counts it.
  v_states := CASE
    WHEN p_state = 'workshop' AND p_purpose IS NULL THEN ARRAY[
      'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'
    ]
    WHEN p_state = 'workshop' THEN ARRAY['workshop_' || p_purpose]
    ELSE ARRAY[p_state]
  END;

  RETURN QUERY
  SELECT
    -- Window functions are evaluated before LIMIT / OFFSET, so this is the
    -- size of the whole filtered set and is identical on every returned row.
    count(*) OVER ()::int AS total_count,
    s.id,
    s.code,
    s.type,
    s.ownership_status,
    s.state,
    -- The latest movement's time: the entry for a unit inside a site or in
    -- the workshop, the exit for an available one, NULL if it never moved.
    s.last_movement_at AS since,
    s.last_movement_id,
    s.last_movement_type,
    s.last_movement_context,
    s.last_workshop_purpose AS workshop_purpose,
    c.name_ar AS company_name_ar,
    c.name_en AS company_name_en,
    p.name_ar AS project_name_ar,
    p.name_en AS project_name_en,
    -- 0118: appended. The purpose of the site exit that made a unit
    -- available; NULL for every other row.
    s.last_exit_purpose
  FROM public.admin_equipment_state s
  LEFT JOIN public.companies c ON c.id = s.last_company_id
  LEFT JOIN public.projects p ON p.id = s.last_project_id
  WHERE s.is_active
    AND s.status = 'active'
    AND (v_owners IS NULL OR s.ownership_status = ANY(v_owners))
    AND s.state = ANY(v_states)
  -- 0121: the requested column first. Each term is NULL on every row unless
  -- it is the requested one, so exactly one of them orders the rows; empty
  -- values go last in both directions.
  ORDER BY
    CASE WHEN v_sort = 'code_asc' THEN s.code END ASC NULLS LAST,
    CASE WHEN v_sort = 'code_desc' THEN s.code END DESC NULLS LAST,
    CASE WHEN v_sort = 'type_asc' THEN s.type END ASC NULLS LAST,
    CASE WHEN v_sort = 'type_desc' THEN s.type END DESC NULLS LAST,
    CASE WHEN v_sort = 'owner_asc' THEN array_position(
      ARRAY[
        'alazani', 'takween', 'third_party_f', 'third_party_partnership_b',
        'external_supplier'
      ],
      s.ownership_status
    ) END ASC NULLS LAST,
    CASE WHEN v_sort = 'owner_desc' THEN array_position(
      ARRAY[
        'alazani', 'takween', 'third_party_f', 'third_party_partnership_b',
        'external_supplier'
      ],
      s.ownership_status
    ) END DESC NULLS LAST,
    CASE WHEN v_sort = 'company_asc' THEN c.name_ar END ASC NULLS LAST,
    CASE WHEN v_sort = 'company_asc' THEN p.name_ar END ASC NULLS LAST,
    CASE WHEN v_sort = 'company_desc' THEN c.name_ar END DESC NULLS LAST,
    CASE WHEN v_sort = 'company_desc' THEN p.name_ar END DESC NULLS LAST,
    CASE WHEN v_sort = 'workshop_purpose_asc' THEN COALESCE(
      array_position(ARRAY['maintenance', 'parking'], s.last_workshop_purpose),
      3
    ) END ASC NULLS LAST,
    CASE WHEN v_sort = 'workshop_purpose_desc' THEN COALESCE(
      array_position(ARRAY['maintenance', 'parking'], s.last_workshop_purpose),
      3
    ) END DESC NULLS LAST,
    CASE WHEN v_sort = 'exit_purpose_asc' THEN s.last_exit_purpose END ASC NULLS LAST,
    CASE WHEN v_sort = 'exit_purpose_desc' THEN s.last_exit_purpose END DESC NULLS LAST,
    CASE WHEN v_sort = 'last_movement_asc' THEN s.last_movement_at END ASC NULLS LAST,
  -- Most recent movement first, and equipment that has never moved last (it
  -- has no date to sort by). `id` breaks ties so paging is deterministic and
  -- a row can never appear on two pages or on none.
    s.last_movement_at DESC NULLS LAST, s.id
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int, text)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_admin_fleet_equipment(text, text[], text, int, int, text) IS
  'Admin home: one page of the active equipment (is_active AND status = '
  '''active'') in one fleet state - inside_site, workshop (optionally one '
  'purpose: maintenance, parking or unclassified) or available - with the '
  'company and project of its latest movement. Ordered by the latest movement '
  'descending with never-moved rows last, and every row carries total_count, '
  'the size of the whole filtered set. p_state and p_purpose are allowlisted, '
  'p_limit is clamped to 1..500, p_offset to >= 0 and p_owners is validated. '
  'SECURITY INVOKER plus an admin/monitor role check. last_exit_purpose '
  '(0118) is the site exit purpose of the latest movement, if any. p_sort '
  '(0121) is an allowlisted order (last_movement, code, type, owner, company, '
  'workshop_purpose or exit_purpose, each _asc or _desc; NULL = '
  'last_movement_desc); every order ends with id.';

NOTIFY pgrst, 'reload schema';
