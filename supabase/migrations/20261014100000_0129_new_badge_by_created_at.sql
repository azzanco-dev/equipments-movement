-- 0129: «جديدة» means "created in the last 7 days", not "never moved"
-- (EM-236).
--
-- Owner decisions 2026-10-13/14. Since 0125 the «جديدة» mark of an equipment
-- meant "no movement recorded yet" (`equipment_is_new(equipment)` and
-- `admin_equipment_state.is_new`). That is wrong for the owner: old units may
-- never have entered a project through this system and are not new at all.
-- From now on «جديدة» means the equipment ROW WAS CREATED within the last
-- 7 days (`created_at >= now() - interval '7 days'`); the mark disappears by
-- itself once the week has passed. The equipment state itself («الحالة»,
-- `equipment_state_from_movement`) does not change: a unit with no movement
-- still reads `available`.
--
-- The manual flag `equipment.master_data_complete`, its badge «بيانات غير
-- مكتملة» and its list filter leave the UI in the same wave (the admin form
-- stops sending it). The column stays in the schema, unused by the UI, like
-- `operational_status` since 0125; the quick-create functions that write it
-- are untouched. Nothing in this migration touches it.
--
-- ===========================================================================
-- 1. Objects
-- ===========================================================================
-- New:
--   `public.equipment_new_window()`  IMMUTABLE SQL, returns interval '7 days'.
--       The window is written ONCE, here; the computed field and the view
--       both call it. Changing the number is one line in a later migration.
--
-- Recreated (each body copied verbatim from its latest definition, with
-- exactly the `is_new` expression changed):
--   `public.equipment_is_new(public.equipment)`   latest: 0125. STABLE,
--       SECURITY INVOKER, fixed search_path, REVOKE / GRANT restated. The
--       body is now `created_at >= now() - equipment_new_window()` instead
--       of `NOT EXISTS (movement)`. Same name, argument and result type, so
--       the PostgREST computed field `equipment_is_new` keeps working for the
--       live list, its export and the detail page (they select, filter and
--       sort it like a column).
--   `public.admin_equipment_state`                latest: 0125. Verbatim except
--       `(m.id IS NULL) AS is_new` becomes the same created_at rule on the
--       equipment row. The column list, names and types are unchanged, so
--       CREATE OR REPLACE VIEW is allowed; security_invoker, REVOKE / GRANT
--       and the COMMENT are restated.
--
-- Not recreated (checked with `rg is_new supabase/migrations`):
--   `public.get_admin_fleet_equipment(...)`  latest: 0127. It returns
--       `s.is_new` straight from the view, so it follows the new rule by
--       itself. Its body comment still says "never moved"; a function is not
--       recreated for a comment.
--   `public.equipment_state_from_movement(text, text, text)`  0125. It never
--       produced `is_new` (it returns the state text only); untouched.
--   `get_admin_fleet_state`, `get_admin_availability_by_type`,
--       `get_workshop_home_stats`, `get_admin_owner_state_matrix`,
--       `get_admin_outside_equipment`: none reads `is_new`.
--
-- ===========================================================================
-- 2. Security and compatibility
-- ===========================================================================
--   No grant is widened and no role check changes. The computed field and
--   the view stay SECURITY INVOKER; `is_new` no longer depends on
--   `entry_exit_logs` at all, only on the equipment row the caller already
--   reads, so a foreman and an admin now see the same mark for the same unit.
--   Same names, argument lists, result types and view columns: the deployed
--   UI keeps working and simply shows the new meaning. The admin home's
--   «المتاحة» table keeps rendering the mark where it did.
--
-- ===========================================================================
-- 3. Indexes
-- ===========================================================================
--   None. Filtering the equipment list by `equipment_is_new` evaluates the
--   computed field once per equipment row (a comparison on the row's own
--   `created_at`, no other table) over a table of a few thousand rows; the
--   view does the same. No index can serve a computed field anyway.

-- ===========================================================================
-- 4. The window: one definition
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.equipment_new_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT interval '7 days'
$$;

REVOKE ALL ON FUNCTION public.equipment_new_window() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_new_window() TO authenticated;

COMMENT ON FUNCTION public.equipment_new_window() IS
  'How long after its creation an equipment row is marked «جديدة»: 7 days. '
  'The single definition read by equipment_is_new() and '
  'admin_equipment_state.is_new (0129).';

-- ===========================================================================
-- 5. The computed field (0125's header, the new body)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.equipment_is_new(p_equipment public.equipment)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT p_equipment.created_at >= now() - public.equipment_new_window()
$$;

REVOKE ALL ON FUNCTION public.equipment_is_new(public.equipment)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_is_new(public.equipment)
  TO authenticated;

COMMENT ON FUNCTION public.equipment_is_new(public.equipment) IS
  'Computed field: true while the equipment row was created within '
  'equipment_new_window() (7 days), shown as «جديدة» next to its state. Since '
  '0129 it no longer means "no movement yet". SECURITY INVOKER.';

-- ===========================================================================
-- 6. The admin home's shared state view (0125's definition, is_new changed)
-- ===========================================================================
CREATE OR REPLACE VIEW public.admin_equipment_state
WITH (security_invoker = true)
AS
SELECT
  e.id,
  e.code,
  e.type,
  e.ownership_status,
  e.is_active,
  m.recorded_at AS last_movement_at,
  m.movement_type AS last_movement_type,
  m.movement_context AS last_movement_context,
  m.workshop_purpose AS last_workshop_purpose,
  CASE
    WHEN m.id IS NULL THEN 'available'
    WHEN m.movement_type <> 'entry' THEN 'available'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'maintenance' THEN 'workshop_maintenance'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'parking' THEN 'workshop_parking'
    WHEN m.movement_context = 'workshop'
      AND m.workshop_purpose = 'out_of_service' THEN 'workshop_out_of_service'
    WHEN m.movement_context = 'workshop' THEN 'workshop_unclassified'
    ELSE 'inside_site'
  END AS state,
  e.status,
  -- Appended in 0107. They describe the same latest movement as the columns
  -- above; all three are NULL for equipment that has never moved.
  m.id AS last_movement_id,
  m.company_id AS last_company_id,
  m.project_id AS last_project_id,
  -- Appended in 0118: the site exit purpose (0111) of that same latest
  -- movement; NULL unless it is a site exit recorded with a purpose.
  m.exit_purpose AS last_exit_purpose,
  -- Appended in 0125: the one equipment state (working, available,
  -- maintenance, parking, out_of_service, unclassified) of that same
  -- latest movement.
  public.equipment_state_from_movement(
    m.movement_type, m.movement_context, m.workshop_purpose
  ) AS equipment_state,
  -- 0129: «جديدة» is now "created within equipment_new_window()" (7 days),
  -- the same rule as the equipment_is_new computed field; it no longer means
  -- "never moved".
  (e.created_at >= now() - public.equipment_new_window()) AS is_new
FROM public.equipment e
LEFT JOIN LATERAL (
  SELECT
    l.id,
    l.movement_type,
    l.movement_context,
    l.workshop_purpose,
    l.recorded_at,
    l.company_id,
    l.project_id,
    l.exit_purpose
  FROM public.entry_exit_logs l
  WHERE l.equipment_id = e.id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1
) m ON true;

REVOKE ALL ON public.admin_equipment_state FROM PUBLIC, anon;
GRANT SELECT ON public.admin_equipment_state TO authenticated;

COMMENT ON VIEW public.admin_equipment_state IS
  'Every equipment row with the state derived from its latest movement across '
  'both contexts, ordered by (recorded_at DESC, id DESC). security_invoker, '
  'so equipment and entry_exit_logs RLS stay authoritative. Shared by the '
  'admin home functions so "current state" has exactly one definition. '
  'Carries both is_active and status; the fleet predicate is '
  '(is_active AND status = ''active''). last_movement_id, last_company_id and '
  'last_project_id (0107) identify that same latest movement; '
  'last_exit_purpose (0118) is its site exit purpose, if any. Since 0125 '
  'state also yields workshop_out_of_service and equipment_state is the one '
  'equipment state (equipment_state_from_movement). Since 0129 is_new is '
  'true while the row was created within equipment_new_window() (7 days), '
  'no longer "never moved".';

NOTIFY pgrst, 'reload schema';
