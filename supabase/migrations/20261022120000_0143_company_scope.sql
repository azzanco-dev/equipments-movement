-- 0143 — company scope: a user with linked companies sees only those
-- companies' data.
--
-- Owner request 2026-10-22: «ربط الشركات بالمستخدمين، بحيث ما تظهر له الا
-- شركاته». The link table `profile_companies` exists since 0058 (the admin
-- assigns «الشركات المسؤول عنها» on the user page) but nothing has ever read
-- it apart from the `companies` permission scope, which no role uses. From
-- this migration on it is the ONE rule, enforced in PostgreSQL:
--
--   * `scoped_company_ids()` — the caller's linked companies, or NULL when
--     the caller has none. NULL means UNRESTRICTED: a user without linked
--     companies (the admin, the workshop roles, a monitor) keeps seeing
--     everything, exactly as today. Nothing changes for anybody until the
--     admin links companies to a user.
--   * `company_in_scope(company_id)` — the same rule for one company, for
--     triggers and functions.
--   * Where it applies (reads through RLS, so every list, selector, view and
--     filter follows from the server with no client-side filtering):
--       - `companies`: only the linked ones (the company selectors of the
--         movement form, the filters and the purchasing dialogs follow);
--       - `entry_exit_logs` PROJECT rows (`movement_context = 'site'`): only
--         those of a linked company, UNDER the existing permission scope
--         (own / site / workshop / companies / all). Workshop rows carry no
--         company and are not affected. `movement_log_search` and
--         `movement_visits` are security_invoker, so «الدخوليات» and the
--         foreman home follow; `movement_scope_allows()` carries the rule to
--         `can_access_movement`, the photos, the driver changes and the
--         notices;
--       - a SITE ENTRY for a company outside the scope is refused with the
--         stable token `company_not_in_scope` (a separate BEFORE INSERT
--         trigger, the 0115/0120 shape; the admin import passes because the
--         admin has no linked companies);
--       - purchasing: `supplier_pos` and `equipment_cards` of a linked
--         company only, and a PO's lines and events through their PO.
--   * The `companies` permission scope changes meaning accordingly: it is
--     «project rows» (like `site`), and the company rule above applies on top
--     — a holder without linked companies sees every project row.
--   * A user who manages users (`users.manage`: the administrator) can never
--     be linked to companies — a BEFORE INSERT trigger on `profile_companies`
--     refuses it (`admin_cannot_be_scoped`) and existing such rows are
--     removed — so the admin is always unrestricted. No gate here tests a
--     role name.
--
-- Not changed (owner-approved assumptions): projects, equipment, drivers,
-- lessors, the equipment inquiry (`get_last_movement`, SECURITY DEFINER),
-- the admin reports, and movements a user recorded earlier for a company
-- that is not linked to him (they stay in the database, visible to the
-- admin, and leave his own lists).
--
-- Every new function: STABLE, fixed search_path, executable by
-- `authenticated` only; trigger functions are callable by nobody.

-- ===========================================================================
-- A. The rule
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.scoped_company_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN ARRAY[]::uuid[]
    ELSE (
      SELECT array_agg(pc.company_id)
      FROM public.profile_companies pc
      WHERE pc.profile_id = auth.uid()
    )
  END;
$$;

COMMENT ON FUNCTION public.scoped_company_ids() IS
  '0143: the caller''s linked companies (profile_companies), or NULL when the caller has none = UNRESTRICTED. No session: an empty array (nothing in scope). Policies evaluate it once per statement as (SELECT public.scoped_company_ids()).';

REVOKE ALL ON FUNCTION public.scoped_company_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scoped_company_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.company_in_scope(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT s IS NULL OR p_company_id = ANY (s)
     FROM (SELECT public.scoped_company_ids() AS s) AS scope),
    false
  );
$$;

COMMENT ON FUNCTION public.company_in_scope(uuid) IS
  '0143: true when the caller has no linked companies, or the company is one of them. NULL company with linked companies: false. Never NULL.';

REVOKE ALL ON FUNCTION public.company_in_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_in_scope(uuid) TO authenticated;

-- ===========================================================================
-- B. Companies: only the linked ones
-- ===========================================================================
DROP POLICY IF EXISTS select_companies ON public.companies;
CREATE POLICY select_companies ON public.companies
FOR SELECT TO authenticated
USING (
  (SELECT public.scoped_company_ids()) IS NULL
  OR id = ANY ((SELECT public.scoped_company_ids()))
);
COMMENT ON POLICY select_companies ON public.companies IS
  '0143: was USING (true) (0009); now the caller''s linked companies, or every company for a caller without links.';

-- ===========================================================================
-- C. Movements: project rows of a linked company only, under the scope
-- ===========================================================================
DROP POLICY IF EXISTS select_entry_exit_logs ON public.entry_exit_logs;
CREATE POLICY select_entry_exit_logs ON public.entry_exit_logs
FOR SELECT TO authenticated
USING (
  (
    movement_context <> 'site'
    OR (SELECT public.scoped_company_ids()) IS NULL
    OR company_id = ANY ((SELECT public.scoped_company_ids()))
  )
  AND (
    supervisor_id = auth.uid()
    OR CASE (SELECT public.permission_scope('movements.read'))
      WHEN 'all' THEN true
      WHEN 'site' THEN movement_context = 'site'
      WHEN 'workshop' THEN movement_context = 'workshop'
      WHEN 'companies' THEN movement_context = 'site'
      ELSE false
    END
  )
);
COMMENT ON POLICY select_entry_exit_logs ON public.entry_exit_logs IS
  '0143: the 0127 policy (permission key movements.read) AND the company rule on project rows: a caller with linked companies sees project rows of those companies only. The companies scope is now «project rows» under that rule.';

-- movement_scope_allows: latest 0126. Same rule for the functions that read
-- one movement (can_access_movement, can_write_movement_photos, the driver
-- changes, the notices): a project row outside the linked companies is
-- outside every scope, the caller's own rows included.
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
    (
      p_movement_context IS DISTINCT FROM 'site'
      OR public.company_in_scope(p_company_id)
    )
    AND CASE
      WHEN p_scope IS NULL THEN false
      WHEN auth.uid() IS NOT NULL AND p_supervisor_id = auth.uid() THEN true
      WHEN p_scope = 'all' THEN true
      WHEN p_scope = 'site' THEN p_movement_context = 'site'
      WHEN p_scope = 'workshop' THEN p_movement_context = 'workshop'
      WHEN p_scope = 'companies' THEN p_movement_context = 'site'
      ELSE false
    END,
    false
  );
$$;

COMMENT ON FUNCTION public.movement_scope_allows(text, uuid, text, uuid) IS
  'Whether a movement row (its recorder, context and company) is inside a scope (0126), AND (0143) a project row belongs to one of the caller''s linked companies when he has any. NULL scope: false. Every scope includes the caller''s own rows. site/workshop: rows of that context. companies: project rows (the company rule applies on top). all: every row. Never NULL.';

-- ===========================================================================
-- D. A site ENTRY only for a company inside the scope
-- ===========================================================================
-- A small separate BEFORE INSERT trigger, like 0115 / 0120, so the large
-- enforce_movement_sequence() is not redefined. The admin Excel import needs
-- no exemption: the admin has no linked companies (section F).
CREATE OR REPLACE FUNCTION public.enforce_site_entry_company_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.movement_type IS DISTINCT FROM 'entry'
     OR NEW.movement_context IS DISTINCT FROM 'site'
     OR NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.company_in_scope(NEW.company_id) THEN
    RAISE EXCEPTION 'company_not_in_scope'
      USING ERRCODE = '42501',
            HINT = 'The company is not linked to the caller''s account.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_site_entry_company_scope() IS
  'BEFORE INSERT trigger on entry_exit_logs (0143): a site entry for a company outside the caller''s linked companies raises company_not_in_scope. Never writes NEW.';

REVOKE ALL ON FUNCTION public.enforce_site_entry_company_scope()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_site_entry_company_scope ON public.entry_exit_logs;
CREATE TRIGGER enforce_site_entry_company_scope
  BEFORE INSERT ON public.entry_exit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_site_entry_company_scope();

-- ===========================================================================
-- E. Purchasing: a linked company's POs and cards only
-- ===========================================================================
DROP POLICY IF EXISTS select_supplier_pos ON public.supplier_pos;
CREATE POLICY select_supplier_pos ON public.supplier_pos
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('purchasing.view'))
  AND (
    (SELECT public.scoped_company_ids()) IS NULL
    OR company_id = ANY ((SELECT public.scoped_company_ids()))
  )
);
COMMENT ON POLICY select_supplier_pos ON public.supplier_pos IS
  '0143: purchasing.view (0136) AND the company rule.';

DROP POLICY IF EXISTS select_equipment_cards ON public.equipment_cards;
CREATE POLICY select_equipment_cards ON public.equipment_cards
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('purchasing.view'))
  AND (
    (SELECT public.scoped_company_ids()) IS NULL
    OR company_id = ANY ((SELECT public.scoped_company_ids()))
  )
);
COMMENT ON POLICY select_equipment_cards ON public.equipment_cards IS
  '0143: purchasing.view (0136) AND the company rule.';

DROP POLICY IF EXISTS select_supplier_po_equipment ON public.supplier_po_equipment;
CREATE POLICY select_supplier_po_equipment ON public.supplier_po_equipment
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('purchasing.view'))
  AND EXISTS (
    SELECT 1
    FROM public.supplier_pos p
    WHERE p.id = supplier_po_id
      AND (
        (SELECT public.scoped_company_ids()) IS NULL
        OR p.company_id = ANY ((SELECT public.scoped_company_ids()))
      )
  )
);
COMMENT ON POLICY select_supplier_po_equipment ON public.supplier_po_equipment IS
  '0143: purchasing.view (0136) AND the company rule through the PO.';

DROP POLICY IF EXISTS select_supplier_po_events ON public.supplier_po_events;
CREATE POLICY select_supplier_po_events ON public.supplier_po_events
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('purchasing.view'))
  AND EXISTS (
    SELECT 1
    FROM public.supplier_pos p
    WHERE p.id = supplier_po_id
      AND (
        (SELECT public.scoped_company_ids()) IS NULL
        OR p.company_id = ANY ((SELECT public.scoped_company_ids()))
      )
  )
);
COMMENT ON POLICY select_supplier_po_events ON public.supplier_po_events IS
  '0143: purchasing.view (0136) AND the company rule through the PO.';

-- ===========================================================================
-- F. The administrator is never scoped
-- ===========================================================================
-- Whether a given profile holds a permission key in the current mode (the
-- same answer permission_scope() gives for the caller, for any profile).
CREATE OR REPLACE FUNCTION public.profile_holds_permission(
  p_profile_id uuid,
  p_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_profile_id IS NULL OR p_key IS NULL THEN false
    WHEN public.roles_system_enabled() THEN EXISTS (
      SELECT 1
      FROM public.profile_roles pr
      JOIN public.roles r
        ON r.key = pr.role_key
       AND r.is_active
      JOIN public.role_permissions rp
        ON rp.role_key = pr.role_key
       AND rp.permission_key = p_key
      WHERE pr.profile_id = p_profile_id
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.profiles p
      CROSS JOIN LATERAL public.legacy_role_permissions(p.role) AS m
      WHERE p.id = p_profile_id
        AND m.permission_key = p_key
    )
  END;
$$;

COMMENT ON FUNCTION public.profile_holds_permission(uuid, text) IS
  '0143: whether a profile holds a permission key in the current mode (flag off: legacy_role_permissions of profiles.role; flag on: profile_roles -> active role -> role_permissions). Never NULL.';

REVOKE ALL ON FUNCTION public.profile_holds_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_holds_permission(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_company_assignment_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The one who manages users (the administrator) is never restricted.
  IF public.profile_holds_permission(NEW.profile_id, 'users.manage') THEN
    RAISE EXCEPTION 'admin_cannot_be_scoped'
      USING ERRCODE = '23514',
            HINT = 'A user who manages users cannot be linked to companies.';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_company_assignment_target() IS
  'BEFORE INSERT trigger on profile_companies (0143): a holder of users.manage (the administrator) cannot be linked to companies (admin_cannot_be_scoped), so the administrator is always unrestricted.';

REVOKE ALL ON FUNCTION public.enforce_company_assignment_target()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_company_assignment_target ON public.profile_companies;
CREATE TRIGGER enforce_company_assignment_target
  BEFORE INSERT ON public.profile_companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_assignment_target();

-- Rows linked to an administrator before this rule (none expected: the user
-- page offered the field to foremen only).
DELETE FROM public.profile_companies pc
WHERE public.profile_holds_permission(pc.profile_id, 'users.manage');

COMMENT ON TABLE public.profile_companies IS
  '0058/0143: the companies linked to a user. Since 0143 a user with linked companies sees only those companies'' data (companies, project movements, purchasing) and records project entries for them only; a user without links is unrestricted; a holder of users.manage can never be linked.';
