-- Search fixes (wave 11): EM-113, EM-117 and EM-122.
--
-- EM-113 (high): Arabic spelling variants must not hide a record. A foreman
-- who types «احمد» must find «أحمد», «مصطفي» must find «مصطفى», «شركه» must
-- find «شركة», and «١٢٣» must find «123».
-- EM-117 (medium): the workshop movement form's equipment search never
-- matched `chassis_number`, although the site entry and site exit searches do.
-- EM-122 (low): a few searched columns had no index.
--
-- ===========================================================================
-- Design
-- ===========================================================================
--   ONE normalisation rule, applied to BOTH sides of every comparison it is
--   used in: `public.normalize_search_text(text)` here, and its mirror
--   `normalizeSearchText()` in `src/lib/search.ts` for the search term the
--   browser sends through PostgREST. `tests/search-normalisation.test.cjs`
--   decodes the two strings of the `translate()` below and checks the
--   TypeScript mirror against them, so the two cannot drift silently.
--
--   The rule, in order:
--     1. alif with hamza or madda, and alif wasla  (U+0623 U+0625 U+0622
--        U+0671)                                   -> plain alif  (U+0627)
--     2. alif maqsura (U+0649)                     -> yeh         (U+064A)
--     3. teh marbuta  (U+0629)                     -> heh         (U+0647)
--     4. Arabic-Indic digits (U+0660..U+0669) and extended Arabic-Indic
--        digits (U+06F0..U+06F9)                   -> ASCII 0..9
--     5. tatweel (U+0640), the harakat (U+064B..U+0652) and the superscript
--        alif (U+0670) are removed
--     6. lower case, every whitespace run becomes one space, then trimmed.
--   Hamza on waw/yeh (U+0624, U+0626) is deliberately NOT folded: it changes
--   the word, and the owner asked for the five rules above only.
--
--   Where the normalised text lives (all additions; nothing existing changes):
--     * Master tables that the browser filters through PostgREST get a STORED
--       generated column next to the source column, the same "derived search
--       column beside the real one" idea as `equipment.plate_digits` (0074):
--         drivers.full_name_search          <- full_name
--         companies.name_ar_search          <- name_ar
--         projects.name_ar_search           <- name_ar
--         lessors.name_search               <- name
--         lessors.contact_person_search     <- contact_person
--         equipment.type_search             <- type
--         equipment_types.name_search       <- name
--       A generated column cannot be written by a client (an INSERT/UPDATE
--       naming it is rejected), it can never disagree with its source, and
--       every write path (forms, Excel imports, quick create, the SECURITY
--       DEFINER functions, a future script) fills it without any change.
--       Each gets a trigram index (gin, `extensions.gin_trgm_ops`), the same
--       index type 0035 uses for every other `ilike '%term%'` search.
--     * `entry_exit_logs.driver_name` (the driver snapshot) gets an EXPRESSION
--       trigram index instead of a column: the movement table is the core of
--       the sequence triggers and is read with `select('*')`, so its shape is
--       left alone. The two movement views expose the expression as a new
--       column instead.
--     * English names (`name_en`), codes, plates, chassis numbers, mobile and
--       ID numbers are not normalised: the browser keeps sending them the
--       plain sanitised term (with Arabic-Indic digits converted, as before).
--
--   Why `normalize_search_text` has no `SET search_path`: it is written with
--   a SQL-standard body (`RETURN ...`), which PostgreSQL parses and binds when
--   the function is CREATED, so a caller's search_path can never change what
--   it calls; it reads no table and is not SECURITY DEFINER. A `SET` clause
--   would also stop the planner from inlining it, and inlining is what keeps
--   the per-row cost low in the two views and lets the expression index on
--   `entry_exit_logs` be matched. It is IMMUTABLE and PARALLEL SAFE (required
--   for a generated column and an index expression). EXECUTE is revoked from
--   PUBLIC and anon, like every other function here, and granted to
--   `authenticated` and `service_role`: generated columns and index
--   expressions are evaluated with the privileges of the role that writes the
--   row, so every role that inserts into these tables must hold it.
--
-- ===========================================================================
-- Recreated objects (each body copied verbatim from its latest migration)
-- ===========================================================================
--   `public.movement_log_search`  latest: 0099. Verbatim, plus FOUR columns
--       APPENDED after `equipment_ownership_status`:
--         equipment_type_search, driver_name_search,
--         company_name_ar_search, project_name_ar_search
--   `public.movement_visits`      latest: 0106. Verbatim, plus TWO columns
--       APPENDED after `equipment_ownership_status`:
--         equipment_type_search, driver_name_search
--     `CREATE OR REPLACE VIEW` only allows new columns at the end, and every
--     existing column keeps its name, position and type, so every current
--     select list (`MOVEMENT_LOG_*_SELECT`, `EQUIPMENT_VISITS_SELECT`) is
--     unaffected. `security_invoker = true`, `REVOKE ALL ... FROM PUBLIC,
--     anon` and `GRANT SELECT ... TO authenticated` are repeated.
--   `public.search_entry_equipment(text, text, text)`      latest: 0114
--   `public.search_site_exit_equipment(text, text, text)`  latest: 0114
--   `public.search_workshop_equipment(text, text, text)`   latest: 0114
--     `CREATE OR REPLACE`: the argument list and the RETURNS TABLE are
--     identical to 0114, so the grants survive (they are repeated anyway) and
--     the deployed form keeps calling them unchanged. Each body is 0114's
--     verbatim — fail-closed role checks, fleet predicate, previous-code
--     match and `matched_previous_code`, `ORDER BY e.code LIMIT 20`,
--     SECURITY DEFINER with the same fixed search_path — except:
--       * one new variable, `v_term_search := NULLIF(public.
--         normalize_search_text(v_term), '')`, and
--       * the equipment type branch `e.type ILIKE '%' || v_term || '%'`
--         becomes `e.type_search ILIKE '%' || v_term_search || '%'`
--         (a normalised superset of the old match: every row the old branch
--         matched still matches);
--       * EM-117, `search_workshop_equipment` only: one new branch,
--         `OR e.chassis_number ILIKE '%' || v_term || '%'`, placed exactly
--         where the two site searches have it.
--     None of the three reads or changes the movement chain under a lock;
--     their lateral "latest movement" reads are untouched.
--
-- ===========================================================================
-- Rollout
-- ===========================================================================
--   Apply this migration BEFORE deploying the UI that filters on the new
--   `*_search` columns. Against the UI that is live today it is backward
--   compatible: no column is renamed or removed, no function signature or
--   return shape changes, views only gain trailing columns, and the deployed
--   UI never names a generated column in a write. The deployed searches keep
--   working unchanged (and the three form RPCs already gain the normalised
--   type match and, for the workshop, the chassis number).
--
--   The old raw trigram indexes (0035: drivers.full_name, companies.name_ar,
--   projects.name_ar, lessors.name, equipment.type,
--   entry_exit_logs.driver_name) are kept: the live UI uses them until the
--   new UI is deployed, and the admin entry-report search still filters the
--   raw `entry_exit_logs.driver_name`. They can be dropped in a later
--   migration once nothing filters those raw columns any more.
--
-- ===========================================================================
-- EM-122 indexes
-- ===========================================================================
--   Checked against the current searches:
--     * `profiles.full_name`      — the users list, the foreman filter of
--       `/logs` (through `profile_names`), the import and edit dialogs.
--       No index existed. Added (plain trigram; profiles are not normalised,
--       see the report).
--     * `movement_audit_logs.equipment_code` / `actor_name` — the activity
--       log search (`ilike` on both). No index existed; the table grows with
--       every movement change. Added (plain trigram).
--     * `lessors.contact_person` and `equipment_types.name` — searched, no
--       index. Covered by the trigram indexes on their new normalised
--       columns, which is what the new UI filters.

-- ===========================================================================
-- 1. The normalisation function
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.normalize_search_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN pg_catalog.btrim(
  pg_catalog.regexp_replace(
    pg_catalog.lower(
      pg_catalog.translate(
        p_value,
        -- FROM. Mapped characters first, then the removed ones:
        --   0623 0625 0622 0671 | 0649 | 0629
        --   0660..0669 | 06F0..06F9
        --   removed: 0640 | 064B..0652 | 0670
        U&'\0623\0625\0622\0671\0649\0629\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9\0640\064B\064C\064D\064E\064F\0650\0651\0652\0670',
        -- TO, position by position. `translate` deletes every FROM character
        -- that has no TO character, which is how the last eleven are removed.
        U&'\0627\0627\0627\0627\064A\0647\0030\0031\0032\0033\0034\0035\0036\0037\0038\0039\0030\0031\0032\0033\0034\0035\0036\0037\0038\0039'
      )
    ),
    '\s+',
    ' ',
    'g'
  )
);

COMMENT ON FUNCTION public.normalize_search_text(text) IS
  'Search normalisation (migration 0116, EM-113): alif with hamza/madda and alif wasla -> alif, alif maqsura -> yeh, teh marbuta -> heh, Arabic-Indic digits -> ASCII, tatweel and harakat removed, lower case, whitespace collapsed and trimmed. NULL in, NULL out. Mirrored by normalizeSearchText() in src/lib/search.ts; both sides of a comparison must use it.';

REVOKE ALL ON FUNCTION public.normalize_search_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_search_text(text) TO authenticated, service_role;

-- ===========================================================================
-- 2. Normalised search columns on the master tables, with trigram indexes
-- ===========================================================================

ALTER TABLE public.drivers
  ADD COLUMN full_name_search text
    GENERATED ALWAYS AS (public.normalize_search_text(full_name)) STORED;
CREATE INDEX drivers_full_name_search_trgm_idx
  ON public.drivers USING gin (full_name_search extensions.gin_trgm_ops);

ALTER TABLE public.companies
  ADD COLUMN name_ar_search text
    GENERATED ALWAYS AS (public.normalize_search_text(name_ar)) STORED;
CREATE INDEX companies_name_ar_search_trgm_idx
  ON public.companies USING gin (name_ar_search extensions.gin_trgm_ops);

ALTER TABLE public.projects
  ADD COLUMN name_ar_search text
    GENERATED ALWAYS AS (public.normalize_search_text(name_ar)) STORED;
CREATE INDEX projects_name_ar_search_trgm_idx
  ON public.projects USING gin (name_ar_search extensions.gin_trgm_ops);

ALTER TABLE public.lessors
  ADD COLUMN name_search text
    GENERATED ALWAYS AS (public.normalize_search_text(name)) STORED,
  ADD COLUMN contact_person_search text
    GENERATED ALWAYS AS (public.normalize_search_text(contact_person)) STORED;
CREATE INDEX lessors_name_search_trgm_idx
  ON public.lessors USING gin (name_search extensions.gin_trgm_ops);
CREATE INDEX lessors_contact_person_search_trgm_idx
  ON public.lessors USING gin (contact_person_search extensions.gin_trgm_ops);

ALTER TABLE public.equipment
  ADD COLUMN type_search text
    GENERATED ALWAYS AS (public.normalize_search_text(type)) STORED;
CREATE INDEX equipment_type_search_trgm_idx
  ON public.equipment USING gin (type_search extensions.gin_trgm_ops);

ALTER TABLE public.equipment_types
  ADD COLUMN name_search text
    GENERATED ALWAYS AS (public.normalize_search_text(name)) STORED;
CREATE INDEX equipment_types_name_search_trgm_idx
  ON public.equipment_types USING gin (name_search extensions.gin_trgm_ops);

COMMENT ON COLUMN public.drivers.full_name_search IS
  'normalize_search_text(full_name), generated (0116). Search only; never displayed.';
COMMENT ON COLUMN public.companies.name_ar_search IS
  'normalize_search_text(name_ar), generated (0116). Search only; never displayed.';
COMMENT ON COLUMN public.projects.name_ar_search IS
  'normalize_search_text(name_ar), generated (0116). Search only; never displayed.';
COMMENT ON COLUMN public.lessors.name_search IS
  'normalize_search_text(name), generated (0116). Search only; never displayed.';
COMMENT ON COLUMN public.lessors.contact_person_search IS
  'normalize_search_text(contact_person), generated (0116). Search only; never displayed.';
COMMENT ON COLUMN public.equipment.type_search IS
  'normalize_search_text(type), generated (0116). Search only; never displayed.';
COMMENT ON COLUMN public.equipment_types.name_search IS
  'normalize_search_text(name), generated (0116). Search only; never displayed.';

-- ===========================================================================
-- 3. The driver snapshot on the movements: an expression index
-- ===========================================================================
-- Matches `driver_name_search` of the two views below, which is exactly this
-- expression over `entry_exit_logs.driver_name`.
CREATE INDEX entry_exit_logs_driver_name_search_trgm_idx
  ON public.entry_exit_logs
  USING gin (public.normalize_search_text(driver_name) extensions.gin_trgm_ops);

-- ===========================================================================
-- 4. The movement log (`/logs`, the home log tab, the workshop report)
-- ===========================================================================
-- 0099's definition verbatim; the four `*_search` columns are APPENDED.
CREATE OR REPLACE VIEW public.movement_log_search
WITH (security_invoker = true)
AS
SELECT
  l.id,
  l.equipment_id,
  l.supervisor_id,
  l.movement_type,
  l.movement_context,
  l.workshop_purpose,
  l.registration_method,
  l.driver_id,
  l.driver_name,
  l.odometer_reading,
  l.notes,
  l.photo_url,
  l.company_id,
  l.project_id,
  l.contractor_equipment_code,
  l.recorded_at,
  l.created_at,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number AS equipment_plate_number,
  e.plate_digits AS equipment_plate_digits,
  e.plate_letters_en AS equipment_plate_letters_en,
  e.chassis_number AS equipment_chassis_number,
  c.name_ar AS company_name_ar,
  c.name_en AS company_name_en,
  p.name_ar AS project_name_ar,
  p.name_en AS project_name_en,
  s.full_name AS supervisor_name,
  d.mobile_number AS driver_mobile_number,
  e.ownership_status AS equipment_ownership_status,
  -- 0116: appended search-only columns; everything above is 0099 verbatim.
  e.type_search AS equipment_type_search,
  public.normalize_search_text(l.driver_name) AS driver_name_search,
  c.name_ar_search AS company_name_ar_search,
  p.name_ar_search AS project_name_ar_search
FROM public.entry_exit_logs l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.companies c ON c.id = l.company_id
LEFT JOIN public.projects p ON p.id = l.project_id
LEFT JOIN public.profile_names s ON s.id = l.supervisor_id
LEFT JOIN public.drivers d ON d.id = l.driver_id;

REVOKE ALL ON public.movement_log_search FROM PUBLIC, anon;
GRANT SELECT ON public.movement_log_search TO authenticated;

-- 0099's comment, with the normalised search columns described.
COMMENT ON VIEW public.movement_log_search IS
  'Movement rows flattened with the equipment/company/project/foreman/driver '
  'fields the movement log and reports display and search. security_invoker, '
  'so entry_exit_logs RLS stays authoritative for which movements are '
  'returned; the foreman name comes from profile_names (migration 0099), so '
  'it is shown on every movement the caller may read. Search covers equipment '
  'code, type, plate (raw plus normalized digits/letters), chassis number, '
  'the driver_name snapshot, and contractor_equipment_code; movement notes '
  'and the foreman name are deliberately not searchable. Since 0116 the '
  'Arabic text is searched through the *_search columns '
  '(normalize_search_text): equipment type, driver snapshot, company and '
  'project Arabic names.';

-- ===========================================================================
-- 5. Visits (the foreman and workshop home lists, the `/logs` visits view)
-- ===========================================================================
-- 0106's definition verbatim; the two `*_search` columns are APPENDED.
CREATE OR REPLACE VIEW public.movement_visits
WITH (security_invoker = true)
AS
WITH paired AS (
  SELECT
    l.id,
    l.equipment_id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.company_id,
    l.project_id,
    l.supervisor_id,
    l.driver_id,
    l.driver_name,
    l.recorded_at,
    l.contractor_equipment_code,
    LEAD(l.id) OVER visit_order AS next_id,
    LEAD(l.movement_type) OVER visit_order AS next_movement_type,
    LEAD(l.recorded_at) OVER visit_order AS next_recorded_at,
    LEAD(l.supervisor_id) OVER visit_order AS next_supervisor_id
  FROM public.entry_exit_logs l
  WINDOW visit_order AS (
    PARTITION BY l.equipment_id, l.movement_context
    ORDER BY l.recorded_at, l.id
  )
)
SELECT
  p.id AS entry_id,
  CASE WHEN p.next_movement_type = 'exit' THEN p.next_id END AS exit_id,
  p.equipment_id,
  e.code AS equipment_code,
  e.type AS equipment_type,
  e.plate_number AS equipment_plate_number,
  -- Normalized digits, so a digits-only search term can probe the plate the
  -- same way `buildMovementSearchFilter()` does on `movement_log_search`.
  e.plate_digits AS equipment_plate_digits,
  p.movement_context,
  -- The purpose is the ENTRY's, always: a workshop EXIT has no purpose column
  -- of its own (migration 0076 blanks it), so this view is how an exit row
  -- inherits the classification of the visit it closed.
  p.workshop_purpose,
  p.company_id,
  c.name_ar AS company_name_ar,
  c.name_en AS company_name_en,
  p.project_id,
  pr.name_ar AS project_name_ar,
  pr.name_en AS project_name_en,
  p.supervisor_id AS entry_supervisor_id,
  s.full_name AS entry_supervisor_name,
  CASE
    WHEN p.next_movement_type = 'exit' THEN p.next_supervisor_id
  END AS exit_supervisor_id,
  p.driver_id,
  -- The ENTRY's snapshot. Legacy rows carry only this and no driver record,
  -- so it stays the display value; the list resolves later driver changes the
  -- same way the movement log does.
  p.driver_name,
  p.recorded_at AS entry_at,
  CASE WHEN p.next_movement_type = 'exit' THEN p.next_recorded_at END AS exit_at,
  (p.next_movement_type IS DISTINCT FROM 'exit') AS is_open,
  GREATEST(
    0,
    FLOOR(
      EXTRACT(
        EPOCH FROM (
          CASE
            WHEN p.next_movement_type = 'exit' THEN p.next_recorded_at
            ELSE now()
          END
        ) - p.recorded_at
      ) / 60
    )
  )::int AS duration_minutes,
  -- 0106: appended columns only; everything above is 0099 verbatim.
  -- The ENTRY's company number, searchable from every visits list.
  p.contractor_equipment_code,
  -- The owner, so the admin log's owner filter applies to visits as well.
  e.ownership_status AS equipment_ownership_status,
  -- 0116: appended search-only columns; everything above is 0106 verbatim.
  e.type_search AS equipment_type_search,
  public.normalize_search_text(p.driver_name) AS driver_name_search
FROM paired p
LEFT JOIN public.equipment e ON e.id = p.equipment_id
LEFT JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.projects pr ON pr.id = p.project_id
LEFT JOIN public.profile_names s ON s.id = p.supervisor_id
-- Applied after the window: an EXIT is never a visit of its own, it is the end
-- of the ENTRY before it. A lone legacy EXIT therefore does not appear here at
-- all; the equipment inquiry timeline is the screen that still shows those.
WHERE p.movement_type = 'entry';

REVOKE ALL ON public.movement_visits FROM PUBLIC, anon;
GRANT SELECT ON public.movement_visits TO authenticated;

-- 0106's comment, with the normalised search columns described.
COMMENT ON VIEW public.movement_visits IS
  'One row per visit: each ENTRY paired with the EXIT that follows it in the '
  'same (equipment, movement_context) sequence, ordered deterministically by '
  '(recorded_at, id). is_open is true when no EXIT is visible directly after '
  'the ENTRY, and duration_minutes then runs to now(). workshop_purpose, '
  'company, project and contractor_equipment_code are the ENTRY''s, which is '
  'how a workshop EXIT inherits its visit classification; '
  'equipment_ownership_status is the equipment owner (migration 0106) so the '
  'admin log can filter visits by owner. security_invoker, so entry_exit_logs '
  'RLS stays authoritative and a caller never sees a visit built from a '
  'movement the movement log would hide; entry_supervisor_name comes from '
  'profile_names (migration 0099), so the recorder is named on every visit '
  'the caller may read. Search covers equipment code, type, plate (raw plus '
  'normalized digits), the driver_name snapshot and contractor_equipment_code; '
  'since 0116 the type and the driver snapshot are searched through '
  'equipment_type_search and driver_name_search (normalize_search_text).';

-- ===========================================================================
-- 6. The movement form equipment selectors (bodies from 0114)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.search_entry_equipment(
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
  v_term_search text;
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
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');
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
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_entry_equipment(text, text, text) IS
  'Site ENTRY equipment list with a minimal current state per row, limited to fleet equipment (is_active AND status = ''active''). SECURITY DEFINER because entry_exit_logs RLS hides other foremen''s movements; returns no supervisor identity and no notes. Since 0114 a previous code (equipment_code_changes.old_code) also matches, flagged by matched_previous_code. Since 0116 the type is matched through equipment.type_search (normalize_search_text).';

REVOKE ALL ON FUNCTION public.search_entry_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_entry_equipment(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_site_exit_equipment(
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
  v_term_search text;
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
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');
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
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      OR e.chassis_number ILIKE '%' || v_term || '%'
      OR (v_digits IS NOT NULL AND e.plate_digits ILIKE '%' || v_digits || '%')
    )
  ORDER BY e.code
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_site_exit_equipment(text, text, text) IS
  'Site EXIT equipment list: fleet equipment (is_active AND status = ''active'') whose latest movement is a site ENTRY the caller may close. SECURITY DEFINER because entry_exit_logs RLS hides other foremen''s movements; returns no supervisor identity and no notes. Since 0114 a previous code (equipment_code_changes.old_code) also matches, flagged by matched_previous_code. Since 0116 the type is matched through equipment.type_search (normalize_search_text).';

REVOKE ALL ON FUNCTION public.search_site_exit_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_site_exit_equipment(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_workshop_equipment(
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
  v_term_search text;
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
  -- 0116: the same term, normalised like equipment.type_search. NULL when
  -- nothing is left (a term of tatweel only), so it never matches every row.
  v_term_search := NULLIF(public.normalize_search_text(v_term), '');

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
      -- 0116: the type is compared normalised on both sides.
      OR e.type_search ILIKE '%' || v_term_search || '%'
      OR e.plate_number ILIKE '%' || v_term || '%'
      -- 0116 (EM-117): the chassis number, as the two site searches match it.
      OR e.chassis_number ILIKE '%' || v_term || '%'
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
  'Workshop ENTRY/EXIT equipment list with a minimal current state per row, limited to fleet equipment (is_active AND status = ''active''). EXIT lists only equipment whose latest workshop movement is an entry. SECURITY DEFINER so the state does not depend on the movement read policy; returns no supervisor identity and no notes. Since 0114 a previous code (equipment_code_changes.old_code) also matches, flagged by matched_previous_code. Since 0116 the type is matched through equipment.type_search (normalize_search_text) and the chassis number is searched too (EM-117).';

REVOKE ALL ON FUNCTION public.search_workshop_equipment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workshop_equipment(text, text, text) TO authenticated;

-- ===========================================================================
-- 7. EM-122: indexes for searched columns that had none
-- ===========================================================================

-- The users list, the `/logs` foreman filter (through profile_names), and
-- the recorder pickers of the import and edit dialogs: `full_name ilike`.
CREATE INDEX IF NOT EXISTS profiles_full_name_trgm_idx
  ON public.profiles USING gin (full_name extensions.gin_trgm_ops);

-- The activity log (`/activity`): `equipment_code ilike OR actor_name ilike`.
CREATE INDEX IF NOT EXISTS movement_audit_logs_equipment_code_trgm_idx
  ON public.movement_audit_logs USING gin (equipment_code extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS movement_audit_logs_actor_name_trgm_idx
  ON public.movement_audit_logs USING gin (actor_name extensions.gin_trgm_ops);

-- ===========================================================================
-- Query plan notes
-- ===========================================================================
--   * Master lists and selectors (`drivers`, `companies`, `projects`,
--     `lessors`, `equipment`, `equipment_types`): the new `*_search ilike`
--     branches are plain column predicates with a trigram index each, the
--     same shape 0035 indexed for the raw columns, so a BitmapOr over the
--     branches stays available exactly as before.
--   * `movement_log_search`: `driver_name_search` inlines to the indexed
--     expression on `entry_exit_logs`; the other new branches live on the
--     joined tables, as `company_name_ar` and `equipment_type` already did,
--     so the plan shape described in 0086/0094 does not change.
--   * `movement_visits`: the search is evaluated after the window over one
--     row per ENTRY (see 0096 and 0106); the two new branches are one more OR
--     arm each and add no window input.
--   * The three selectors scan `equipment` (one row per unit) under the same
--     predicates as 0114, with `type_search` in place of `type`.
