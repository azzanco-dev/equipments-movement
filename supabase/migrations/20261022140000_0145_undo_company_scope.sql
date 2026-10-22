-- 0145 — undo the company scope of 0143 and 0144.
--
-- Owner 2026-10-22 («رجع كل شي اول»): the company links of a user
-- (`profile_companies`, 0058) must NOT restrict what he reads. What the
-- owner wants is only that the company and project selectors of the
-- movement entry form are filtered by his linked companies — a client-side
-- concern (`src/components/movement/useMovementFormOptions.ts`), no RLS.
--
-- 0143 and 0144 are already applied, so this migration restores every
-- object they changed to its previous definition, verbatim:
--   * `select_companies` (0009) and `select_projects` (0004): USING (true);
--   * `select_entry_exit_logs`: the 0127 policy;
--   * `movement_scope_allows()`: the 0126 body;
--   * the four purchasing read policies: the 0136 ones;
--   * the two triggers and the six functions of 0143 are dropped.
-- `profile_companies` keeps its rows and its 0127 policies.

-- ===========================================================================
-- A. Policies back to their previous definitions
-- ===========================================================================
DROP POLICY IF EXISTS select_companies ON public.companies;
CREATE POLICY select_companies ON public.companies
FOR SELECT TO authenticated
USING (true);
COMMENT ON POLICY select_companies ON public.companies IS
  '0145: back to the 0009 definition (every company for every signed-in user); 0143 had scoped it by profile_companies.';

DROP POLICY IF EXISTS select_projects ON public.projects;
CREATE POLICY select_projects ON public.projects
FOR SELECT TO authenticated
USING (true);
COMMENT ON POLICY select_projects ON public.projects IS
  '0145: back to the 0004 definition (every project for every signed-in user); 0144 had scoped it by company_projects.';

DROP POLICY IF EXISTS select_entry_exit_logs ON public.entry_exit_logs;
CREATE POLICY select_entry_exit_logs ON public.entry_exit_logs
FOR SELECT TO authenticated
USING (
  supervisor_id = auth.uid()
  OR CASE (SELECT public.permission_scope('movements.read'))
    WHEN 'all' THEN true
    WHEN 'site' THEN movement_context = 'site'
    WHEN 'workshop' THEN movement_context = 'workshop'
    WHEN 'companies' THEN
      movement_context = 'site'
      AND company_id IN (
        SELECT pc.company_id
        FROM public.profile_companies pc
        WHERE pc.profile_id = auth.uid()
      )
    ELSE false
  END
);
COMMENT ON POLICY select_entry_exit_logs ON public.entry_exit_logs IS
  '0127: was a role-name test (latest 0098); now permission key movements.read. Same result for every legacy role while the roles system is inactive. 0145: the 0127 definition restored verbatim after 0143.';

DROP POLICY IF EXISTS select_supplier_pos ON public.supplier_pos;
CREATE POLICY select_supplier_pos ON public.supplier_pos
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));
COMMENT ON POLICY select_supplier_pos ON public.supplier_pos IS
  '0145: the 0136 definition restored after 0143.';

DROP POLICY IF EXISTS select_equipment_cards ON public.equipment_cards;
CREATE POLICY select_equipment_cards ON public.equipment_cards
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));
COMMENT ON POLICY select_equipment_cards ON public.equipment_cards IS
  '0145: the 0136 definition restored after 0143.';

DROP POLICY IF EXISTS select_supplier_po_equipment ON public.supplier_po_equipment;
CREATE POLICY select_supplier_po_equipment ON public.supplier_po_equipment
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));
COMMENT ON POLICY select_supplier_po_equipment ON public.supplier_po_equipment IS
  '0145: the 0136 definition restored after 0143.';

DROP POLICY IF EXISTS select_supplier_po_events ON public.supplier_po_events;
CREATE POLICY select_supplier_po_events ON public.supplier_po_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_permission('purchasing.view')));
COMMENT ON POLICY select_supplier_po_events ON public.supplier_po_events IS
  '0145: the 0136 definition restored after 0143.';

-- ===========================================================================
-- B. movement_scope_allows back to its 0126 body
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.movement_scope_allows(
  p_scope text,
  p_supervisor_id uuid,
  p_movement_context text,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    CASE
      WHEN p_scope IS NULL THEN false
      WHEN auth.uid() IS NOT NULL AND p_supervisor_id = auth.uid() THEN true
      WHEN p_scope = 'all' THEN true
      WHEN p_scope = 'site' THEN p_movement_context = 'site'
      WHEN p_scope = 'workshop' THEN p_movement_context = 'workshop'
      WHEN p_scope = 'companies' THEN
        p_movement_context = 'site'
        AND EXISTS (
          SELECT 1
          FROM public.profile_companies pc
          WHERE pc.profile_id = auth.uid()
            AND pc.company_id = p_company_id
        )
      ELSE false
    END,
    false
  );
$$;

REVOKE ALL ON FUNCTION public.movement_scope_allows(text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.movement_scope_allows(text, uuid, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.movement_scope_allows(text, uuid, text, uuid) IS
  'Whether a movement row (its recorder, context and company) is inside a scope (0126). NULL scope: false. Every scope includes the caller''s own rows. site/workshop: rows of that context. companies: project rows of the caller''s profile_companies. all: every row. Never NULL. 0145: the 0126 body restored after 0143.';

-- ===========================================================================
-- C. The 0143 triggers and functions are gone
-- ===========================================================================
DROP TRIGGER IF EXISTS enforce_site_entry_company_scope ON public.entry_exit_logs;
DROP FUNCTION IF EXISTS public.enforce_site_entry_company_scope();

DROP TRIGGER IF EXISTS enforce_company_assignment_target ON public.profile_companies;
DROP FUNCTION IF EXISTS public.enforce_company_assignment_target();

DROP FUNCTION IF EXISTS public.profile_holds_permission(uuid, text);
DROP FUNCTION IF EXISTS public.company_in_scope(uuid);
DROP FUNCTION IF EXISTS public.scoped_company_ids();
DROP FUNCTION IF EXISTS public.company_links_required();

COMMENT ON TABLE public.profile_companies IS
  '0058/0145: the companies linked to a user, assigned by the admin on the user page. They filter only the company and project selectors of the movement entry form (client side); they restrict no read and no write (0143/0144 tried that and 0145 undid it the same day).';
