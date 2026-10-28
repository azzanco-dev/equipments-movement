-- 0158 — permission scope fixes for custom roles.
--
-- A review of the roles system on 2026-10-28 found eight places where a
-- custom combination of keys (a role the owner builds on the roles page) gets
-- more, or less, than its keys say. Owner rule: «اهم شي مايتغير شي على
-- المستخدمين» — for the six original roles (admin, supervisor, workshop,
-- assistant_workshop_manager, workshop_manager, monitor, holding the 0126
-- mapping) every result below stays the same; the one exception is the
-- restored select_profiles result of A (see there). Every object is
-- re-created from its LATEST definition (named above it) VERBATIM except the
-- change marked "0158"; SECURITY DEFINER functions keep
-- search_path = public, pg_temp and EXECUTE for authenticated only.
--
--   A. select_profiles (latest 0151): the users.read scope 'workshop' tested
--      EXISTS on profile_roles, which runs under the CALLER's RLS
--      (select_profile_roles: own row unless users.manage), so it never
--      matched another user and a workshop-scoped reader saw only himself
--      since 0151. The new SECURITY DEFINER helper
--      profile_is_workshop_user(uuid) answers "the target's assigned role is
--      active and holds movements.workshop.create" outside the caller's RLS.
--      The admin role is excluded: it holds movements.workshop.create too,
--      and the 0127/0151 rule never listed admins. For the original roles the
--      set is again exactly the users of the three workshop roles (0127's
--      result, which 0151 meant to keep); a custom role that records
--      workshop movements joins them.
--   B. update/delete_entry_exit_photos (latest 0127): another user's photo
--      (movements.photos.delete_any) now needs the photos.manage scope on its
--      movement (can_write_movement_photos, 0127) instead of the read scope
--      (can_access_movement). The uploader's own photo keeps the 0127 rule
--      (read access to the movement), so photos uploaded under an earlier
--      write rule stay removable by their uploader. Only the admin holds
--      delete_any among the original roles, with photos.manage 'all', where
--      both helpers are true for every movement: no change.
--   C. delete_log_photos on storage.objects (latest 0133): delete_any no
--      longer opens every object of the bucket. Its branch goes through the
--      new SECURITY DEFINER helper can_delete_any_log_photo(text): every
--      entry_exit_photos row and every legacy photo_url that references the
--      object must belong to a movement the caller may write photos for, and
--      path segment 2 must be such a movement or no movement at all (a staged
--      batch, or the movement DELETE /api/movements/[id] just removed, whose
--      cleanup runs after admin_delete_movement committed). The helper reads
--      the tables with owner rights: under the caller's RLS a hidden row
--      would make a NOT EXISTS vacuously true. Without delete_any the 0133
--      branches are verbatim. The admin passes the helper for every object
--      (photos.manage 'all'), so the movement delete route and the photo
--      routes behave as before; storage-cleanup uses the service role and is
--      not subject to RLS. update_log_photos is unchanged (it is already
--      bound to the caller's folder and can_write_movement_photos).
--   D. get_last_movement (latest 0156): the latest movement's type, context,
--      workshop purpose and time are still returned to every caller of the
--      gate (the inquiry and the movement forms derive the state and the
--      sequence check from them). The visit details — recorder id, company,
--      project ids, contractor code, driver id / name / mobile, company
--      names — are returned only when can_access_movement() allows that
--      movement. The project names and the foreman name also stay for a
--      holder of a create key (movements.site.create /
--      movements.workshop.create): the movement form's status card names the
--      project and the foreman of a unit that is still inside, to explain a
--      blocked entry, as it does today for a supervisor whose read scope is
--      'own'. Original roles: admin, monitor and the workshop roles read
--      'all'; a supervisor's exit list holds only his own visits (readable),
--      and his entry form keeps the project and foreman of a blocked unit.
--      Only fields no screen of his shows (another foreman's driver, mobile,
--      company, contractor code) become NULL.
--   E. classify_workshop_entry (latest 0156): the entry must also be one the
--      caller may read (can_access_movement), refused like the missing key.
--      The holders among the original roles (admin, the two workshop
--      managers) read 'all'.
--   F. get_admin_foreman_discipline, get_admin_foreman_recent_movements
--      (latest 0156) and get_entry_report_summary (latest 0102) are SECURITY
--      INVOKER and joined public.profiles under select_profiles, so a custom
--      home.admin / reports role without users.read 'all' got blank foreman
--      names. They join the name-only view public.profile_names (0099/0152)
--      instead. Admin and monitor read every profile already.
--   G. get_entry_report_summary: reports.view (enforced_in 'database') was
--      never checked. It is now required (reports_view_required, 42501), and
--      p_context must lie inside its scope: 'all' any context, 'site' only
--      'site', 'workshop' only 'workshop' (reports_context_out_of_scope,
--      42501). Only the admin holds reports.view among the original roles,
--      with 'all'.
--   H. The catalogue text of home.foreman, movements.exit_cross_context and
--      inquiry.view says what the keys do today.
--   I. get_all_equipment_last_movement() (latest 0127) is dropped: nothing in
--      src/, app/ or supabase/functions calls it.

-- ===========================================================================
-- A. select_profiles: the workshop scope outside the caller's RLS
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.profile_is_workshop_user(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_profile_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profile_roles pr
      JOIN public.roles r
        ON r.key = pr.role_key
       AND r.is_active
      JOIN public.role_permissions rp
        ON rp.role_key = pr.role_key
       AND rp.permission_key = 'movements.workshop.create'
      WHERE pr.profile_id = p_profile_id
        AND pr.role_key <> 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.profile_is_workshop_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_is_workshop_user(uuid) TO authenticated;

COMMENT ON FUNCTION public.profile_is_workshop_user(uuid) IS
  '0158: whether a profile is a workshop user for the users.read scope ''workshop'' of select_profiles: its assigned role is active, is not the admin role and holds movements.workshop.create. SECURITY DEFINER so it reads the target''s assignment outside the caller''s RLS. Never NULL.';

-- select_profiles — latest 0151.
DROP POLICY IF EXISTS select_profiles ON public.profiles;
CREATE POLICY select_profiles ON public.profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR (SELECT public.permission_scope('users.read')) = 'all'
  OR (
    (SELECT public.permission_scope('users.read')) = 'workshop'
    -- 0158: was EXISTS on profile_roles under the caller's RLS, with three
    -- hard-coded role keys.
    AND public.profile_is_workshop_user(profiles.id)
  )
);
COMMENT ON POLICY select_profiles ON public.profiles IS
  '0158: the workshop scope of users.read reads the target''s assigned role through profile_is_workshop_user() (active role holding movements.workshop.create, not admin), outside the caller''s RLS (0151 read profile_roles under it). Own row, users.read all: every row.';

-- ===========================================================================
-- B. entry_exit_photos: another user's photo needs the photo write scope
-- ===========================================================================
-- update_entry_exit_photos — latest 0127.
DROP POLICY IF EXISTS update_entry_exit_photos ON public.entry_exit_photos;
CREATE POLICY update_entry_exit_photos ON public.entry_exit_photos
FOR UPDATE TO authenticated
USING (
  (SELECT public.has_permission('movements.photos.manage'))
  AND (
    (uploaded_by = auth.uid() AND public.can_access_movement(entry_exit_log_id))
    -- 0158: delete_any reaches only movements inside the photos.manage scope.
    OR (
      (SELECT public.has_permission('movements.photos.delete_any'))
      AND public.can_write_movement_photos(entry_exit_log_id)
    )
  )
)
WITH CHECK (
  (SELECT public.has_permission('movements.photos.manage'))
  AND (
    (uploaded_by = auth.uid() AND public.can_access_movement(entry_exit_log_id))
    -- 0158: delete_any reaches only movements inside the photos.manage scope.
    OR (
      (SELECT public.has_permission('movements.photos.delete_any'))
      AND public.can_write_movement_photos(entry_exit_log_id)
    )
  )
);
COMMENT ON POLICY update_entry_exit_photos ON public.entry_exit_photos IS
  '0158: movements.photos.manage, and either the uploader with read access to the movement (0127) or movements.photos.delete_any with the photos.manage scope on the movement (can_write_movement_photos; 0127 used the read scope).';

-- delete_entry_exit_photos — latest 0127.
DROP POLICY IF EXISTS delete_entry_exit_photos ON public.entry_exit_photos;
CREATE POLICY delete_entry_exit_photos ON public.entry_exit_photos
FOR DELETE TO authenticated
USING (
  (SELECT public.has_permission('movements.photos.manage'))
  AND (
    (uploaded_by = auth.uid() AND public.can_access_movement(entry_exit_log_id))
    -- 0158: delete_any reaches only movements inside the photos.manage scope.
    OR (
      (SELECT public.has_permission('movements.photos.delete_any'))
      AND public.can_write_movement_photos(entry_exit_log_id)
    )
  )
);
COMMENT ON POLICY delete_entry_exit_photos ON public.entry_exit_photos IS
  '0158: movements.photos.manage, and either the uploader with read access to the movement (0127) or movements.photos.delete_any with the photos.manage scope on the movement (can_write_movement_photos; 0127 used the read scope).';

-- ===========================================================================
-- C. Storage: delete_any bound to the movements the caller may write photos for
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.can_delete_any_log_photo(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    p_name IS NOT NULL
    AND public.has_permission('movements.photos.delete_any')
    -- Every photo row that references the object: a writable movement.
    AND NOT EXISTS (
      SELECT 1
      FROM public.entry_exit_photos photo
      WHERE photo.file_path = p_name
        AND NOT public.can_write_movement_photos(photo.entry_exit_log_id)
    )
    -- Every legacy photo_url that references it: a writable movement.
    AND NOT EXISTS (
      SELECT 1
      FROM public.entry_exit_logs movement
      WHERE movement.photo_url = p_name
        AND NOT public.can_write_movement_photos(movement.id)
    )
    -- Path segment 2: a writable movement, or no movement at all (a staged
    -- batch, or a movement already deleted whose objects are being cleaned).
    AND (
      public.can_write_movement_photos(public.safe_uuid(split_part(p_name, '/', 2)))
      OR NOT EXISTS (
        SELECT 1
        FROM public.entry_exit_logs movement
        WHERE movement.id = public.safe_uuid(split_part(p_name, '/', 2))
      )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.can_delete_any_log_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_delete_any_log_photo(text) TO authenticated;

COMMENT ON FUNCTION public.can_delete_any_log_photo(text) IS
  '0158: whether a holder of movements.photos.delete_any may remove a log-photos object of another user: every entry_exit_photos row and legacy photo_url referencing it belongs to a movement inside the caller''s photos.manage scope (can_write_movement_photos), and path segment 2 is such a movement or no movement (a staged batch, or a deleted movement being cleaned up). SECURITY DEFINER so rows hidden by the caller''s RLS still count. Never NULL.';

-- delete_log_photos — latest 0133.
DROP POLICY IF EXISTS delete_log_photos ON storage.objects;
CREATE POLICY delete_log_photos ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'log-photos'
  AND (SELECT public.has_permission('movements.photos.manage'))
  AND (
    -- 0158: delete_any reaches only objects of movements inside the
    -- photos.manage scope (it was every object of the bucket).
    (
      (SELECT public.has_permission('movements.photos.delete_any'))
      AND public.can_delete_any_log_photo(name)
    )
    -- 0133 without delete_any, verbatim.
    OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND NOT EXISTS (
        SELECT 1
        FROM public.entry_exit_photos p
        WHERE p.file_path = storage.objects.name
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.entry_exit_photos photo
          WHERE photo.file_path = name
            AND public.can_access_movement(photo.entry_exit_log_id)
        )
        OR public.can_access_movement(public.safe_uuid(split_part(name, '/', 2)))
        OR EXISTS (
          SELECT 1
          FROM public.entry_exit_logs movement
          WHERE movement.photo_url = name
            AND public.can_access_movement(movement.id)
        )
        OR EXISTS (
          SELECT 1
          FROM public.pending_movement_photo_batches pending
          WHERE pending.id = public.safe_uuid(split_part(name, '/', 2))
            AND pending.uploaded_by = auth.uid()
            AND name = ANY(pending.file_paths)
        )
      )
    )
  )
);
COMMENT ON POLICY delete_log_photos ON storage.objects IS
  '0158: with movements.photos.delete_any, can_delete_any_log_photo(name) decides (the object''s movements must be inside the photos.manage scope; 0133 admitted every object). Without it, 0133 verbatim: own folder, no entry_exit_photos row still references the object, and the movement, legacy photo_url or own staged batch of the object.';

-- ===========================================================================
-- D. get_last_movement: the visit details follow the movement read scope
-- ===========================================================================
-- get_last_movement — latest 0156.
CREATE OR REPLACE FUNCTION public.get_last_movement(
  p_equipment_id uuid,
  p_movement_context text DEFAULT 'site'
)
RETURNS TABLE(
  movement_type text,
  movement_context text,
  workshop_purpose text,
  recorded_at timestamptz,
  supervisor_id uuid,
  supervisor_name text,
  company_id uuid,
  project_id uuid,
  project_name_ar text,
  project_name_en text,
  contractor_equipment_code text,
  driver_id uuid,
  driver_name text,
  driver_mobile_number text,
  company_name_ar text,
  company_name_en text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_can_record boolean;
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF NOT (
    public.has_permission('movements.read')
    OR public.has_permission('movements.site.create')
    OR public.has_permission('movements.workshop.create')
  ) THEN
    RAISE EXCEPTION 'authenticated role required';
  END IF;
  IF p_movement_context NOT IN ('site', 'workshop') THEN
    RAISE EXCEPTION 'invalid movement context';
  END IF;

  -- 0158: a movement recorder keeps the project and foreman names (the
  -- movement form explains a blocked entry with them).
  v_can_record := public.has_permission('movements.site.create')
    OR public.has_permission('movements.workshop.create');

  -- 0158: the type, context, purpose and time always; the visit details only
  -- when can_access_movement() allows the movement (else NULL).
  RETURN QUERY
  SELECT
    m.movement_type,
    m.movement_context,
    m.workshop_purpose,
    m.recorded_at,
    CASE WHEN acc.can_read THEN m.supervisor_id END,
    CASE WHEN acc.can_read OR v_can_record THEN m.supervisor_name END,
    CASE WHEN acc.can_read THEN m.company_id END,
    CASE WHEN acc.can_read THEN m.project_id END,
    CASE WHEN acc.can_read OR v_can_record THEN m.project_name_ar END,
    CASE WHEN acc.can_read OR v_can_record THEN m.project_name_en END,
    CASE WHEN acc.can_read THEN m.contractor_equipment_code END,
    CASE WHEN acc.can_read THEN m.driver_id END,
    CASE WHEN acc.can_read THEN m.driver_name END,
    CASE WHEN acc.can_read THEN m.driver_mobile_number END,
    CASE WHEN acc.can_read THEN m.company_name_ar END,
    CASE WHEN acc.can_read THEN m.company_name_en END
  FROM (
    SELECT
      l.id AS log_id,
      l.movement_type,
      l.movement_context,
      l.workshop_purpose,
      l.recorded_at,
      l.supervisor_id,
      s.full_name AS supervisor_name,
      l.company_id,
      l.project_id,
      p.name_ar AS project_name_ar,
      p.name_en AS project_name_en,
      l.contractor_equipment_code,
      COALESCE(c.new_driver_id, l.driver_id) AS driver_id,
      COALESCE(c.new_driver_name, l.driver_name) AS driver_name,
      d.mobile_number AS driver_mobile_number,
      co.name_ar AS company_name_ar,
      co.name_en AS company_name_en
    FROM public.entry_exit_logs l
    LEFT JOIN public.profiles s ON s.id = l.supervisor_id
    LEFT JOIN public.projects p ON p.id = l.project_id
    LEFT JOIN LATERAL (
      SELECT x.new_driver_id, x.new_driver_name
      FROM public.movement_driver_changes x
      WHERE x.entry_log_id = l.id
      ORDER BY x.changed_at DESC, x.id DESC
      LIMIT 1
    ) c ON l.movement_type = 'entry'
    LEFT JOIN public.drivers d ON d.id = COALESCE(c.new_driver_id, l.driver_id)
    LEFT JOIN public.companies co ON co.id = l.company_id
    WHERE l.equipment_id = p_equipment_id
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) m
  CROSS JOIN LATERAL (
    SELECT public.can_access_movement(m.log_id) AS can_read
  ) acc;
END;
$$;

REVOKE ALL ON FUNCTION public.get_last_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_last_movement(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.get_last_movement(uuid, text) IS
  'The latest movement of a unit across both contexts, ordered by (recorded_at, id). Gate: movements.read or a create key. Type, context, workshop purpose and time always; since 0158 the recorder, company, project, contractor code and driver only when can_access_movement() allows the movement (else NULL), except the project and foreman names, which a holder of movements.site.create or movements.workshop.create also gets.';

-- ===========================================================================
-- E. classify_workshop_entry: the entry must be readable
-- ===========================================================================
-- classify_workshop_entry — latest 0156.
CREATE OR REPLACE FUNCTION public.classify_workshop_entry(p_entry_log_id uuid, p_purpose text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.entry_exit_logs;
  v_is_open boolean;
BEGIN
  -- Fail closed: a missing profile (NULL role) is rejected too.
  IF NOT public.has_permission('movements.workshop.classify') THEN
    RAISE EXCEPTION 'workshop manager required';
  END IF;
  IF p_purpose NOT IN ('maintenance', 'parking', 'out_of_service') THEN
    RAISE EXCEPTION 'invalid workshop purpose';
  END IF;

  SELECT * INTO v_entry
  FROM public.entry_exit_logs
  WHERE id = p_entry_log_id
    AND movement_context = 'workshop'
    AND movement_type = 'entry'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workshop entry not found'; END IF;

  -- 0158: only an entry inside the caller's movements.read scope.
  IF NOT public.can_access_movement(v_entry.id) THEN
    RAISE EXCEPTION 'workshop manager required';
  END IF;

  v_is_open := NOT EXISTS (
    SELECT 1
    FROM public.entry_exit_logs l
    WHERE l.equipment_id = v_entry.equipment_id
      AND (l.recorded_at, l.id) > (v_entry.recorded_at, v_entry.id)
  );
  IF NOT v_is_open THEN
    UPDATE public.entry_exit_logs
    SET workshop_purpose = p_purpose, previous_operational_status = NULL
    WHERE id = v_entry.id;
    RETURN;
  END IF;

  -- 0125: an open entry only records its purpose. The equipment state is
  -- derived from this row (equipment_state_from_movement), so nothing
  -- else is written: operational_status and previous_operational_status
  -- are retired.
  UPDATE public.entry_exit_logs
  SET workshop_purpose = p_purpose
  WHERE id = v_entry.id;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_workshop_entry(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.classify_workshop_entry(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.classify_workshop_entry(uuid, text) IS
  'Sets the purpose (maintenance, parking, out_of_service) of a workshop entry. Gate: movements.workshop.classify and, since 0158, read access to the entry (can_access_movement); both refusals raise ''workshop manager required''. The equipment state is derived from the row (0125).';

-- ===========================================================================
-- F. Admin home: the foreman names from the name-only view
-- ===========================================================================
-- get_admin_foreman_discipline — latest 0156.
CREATE OR REPLACE FUNCTION public.get_admin_foreman_discipline(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(
  supervisor_id uuid,
  foreman_name text,
  entries int,
  exits int,
  open_visits int
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH period AS (
    SELECT
      l.supervisor_id AS sid,
      count(*) FILTER (WHERE l.movement_type = 'entry')::int AS entries,
      count(*) FILTER (WHERE l.movement_type = 'exit')::int AS exits
    FROM public.entry_exit_logs l
    WHERE l.recorded_at >= p_from
      AND l.recorded_at <= p_to
    GROUP BY l.supervisor_id
  ),
  -- Open site visits are a "right now" number, not a period number: the
  -- latest site movement of the equipment is an ENTRY and that entry is the
  -- foreman's. Deterministic by (recorded_at DESC, id DESC).
  open_now AS (
    SELECT latest.supervisor_id AS sid, count(*)::int AS open_visits
    FROM (
      SELECT DISTINCT ON (l.equipment_id)
        l.equipment_id, l.supervisor_id, l.movement_type
      FROM public.entry_exit_logs l
      WHERE l.movement_context = 'site'
      ORDER BY l.equipment_id, l.recorded_at DESC, l.id DESC
    ) latest
    WHERE latest.movement_type = 'entry'
    GROUP BY latest.supervisor_id
  )
  SELECT
    p.sid,
    pr.full_name,
    p.entries,
    p.exits,
    COALESCE(o.open_visits, 0)
  FROM period p
  LEFT JOIN open_now o ON o.sid = p.sid
  -- 0158: the name-only view, not profiles under select_profiles.
  LEFT JOIN public.profile_names pr ON pr.id = p.sid
  ORDER BY (p.entries + p.exits) DESC, pr.full_name, p.sid
  LIMIT 20;
END;
$$;

-- get_admin_foreman_recent_movements — latest 0156.
CREATE OR REPLACE FUNCTION public.get_admin_foreman_recent_movements(
  p_limit_per_foreman int DEFAULT 7
)
RETURNS TABLE(
  supervisor_id uuid,
  foreman_name text,
  total_movements int,
  movement_rank int,
  movement_id uuid,
  equipment_id uuid,
  equipment_code text,
  movement_type text,
  movement_context text,
  recorded_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(COALESCE(p_limit_per_foreman, 7), 1), 20);
BEGIN
  IF NOT public.has_permission('home.admin') THEN
    RAISE EXCEPTION 'admin or monitor role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      l.id,
      l.supervisor_id AS sid,
      l.equipment_id,
      l.movement_type,
      l.movement_context,
      l.recorded_at,
      -- Deterministic exactly like every other movement ordering in this
      -- system: recorded_at first, then id, so two movements sharing a
      -- timestamp still resolve to one order.
      row_number() OVER (
        PARTITION BY l.supervisor_id
        ORDER BY l.recorded_at DESC, l.id DESC
      )::int AS rn,
      count(*) OVER (PARTITION BY l.supervisor_id)::int AS total
    FROM public.entry_exit_logs l
    WHERE l.supervisor_id IS NOT NULL
  ),
  busiest AS (
    SELECT r.sid, max(r.total) AS total
    FROM ranked r
    GROUP BY r.sid
    ORDER BY max(r.total) DESC, r.sid
    LIMIT 20
  )
  SELECT
    r.sid,
    pr.full_name,
    b.total,
    r.rn,
    r.id,
    r.equipment_id,
    e.code,
    r.movement_type,
    r.movement_context,
    r.recorded_at
  FROM ranked r
  JOIN busiest b ON b.sid = r.sid
  -- LEFT JOINed: a profile or an equipment row the caller cannot read becomes
  -- NULL and never drops the movement from the foreman's list.
  -- 0158: the name-only view, not profiles under select_profiles.
  LEFT JOIN public.profile_names pr ON pr.id = r.sid
  LEFT JOIN public.equipment e ON e.id = r.equipment_id
  WHERE r.rn <= v_limit
  ORDER BY b.total DESC, r.sid, r.rn;
END;
$$;

-- ===========================================================================
-- F + G. get_entry_report_summary: reports.view, its scope, the name view
-- ===========================================================================
-- get_entry_report_summary — latest 0102.
CREATE OR REPLACE FUNCTION public.get_entry_report_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_owners text[] DEFAULT NULL,
  p_context text DEFAULT 'site'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owners text[];
  -- NULL means "both contexts"; the default keeps 0081/0083's site-only
  -- behaviour for any caller that does not pass the argument.
  v_context text;
  v_result jsonb;
  -- 0158: the caller's reports.view scope.
  v_scope text;
BEGIN
  -- 0158: reports.view is required.
  v_scope := public.permission_scope('reports.view');
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'reports_view_required'
      USING ERRCODE = '42501';
  END IF;

  v_owners := public.admin_home_owner_filter(p_owners);
  IF p_context IS NULL OR p_context = 'all' THEN
    v_context := NULL;
  ELSIF p_context IN ('site', 'workshop') THEN
    v_context := p_context;
  ELSE
    RAISE EXCEPTION 'unknown movement context' USING ERRCODE = '22023';
  END IF;

  -- 0158: 'all' reads any context; 'site' / 'workshop' only their own.
  IF v_scope <> 'all' AND v_context IS DISTINCT FROM v_scope THEN
    RAISE EXCEPTION 'reports_context_out_of_scope'
      USING ERRCODE = '42501';
  END IF;

  WITH entries AS (
    SELECT
      l.id, l.equipment_id, l.supervisor_id, l.movement_type, l.movement_context,
      l.driver_id, l.driver_name, l.contractor_equipment_code, l.registration_method,
      l.odometer_reading, l.notes, l.photo_url, l.company_id, l.project_id,
      l.recorded_at, l.created_at, e.code equipment_code, e.type equipment_type,
      e.plate_number, e.chassis_number, c.name_ar company_name_ar,
      c.name_en company_name_en, p.name_ar project_name_ar, p.name_en project_name_en,
      pr.full_name supervisor_name, d.mobile_number driver_mobile
    FROM public.entry_exit_logs l
    LEFT JOIN public.equipment e ON e.id = l.equipment_id
    LEFT JOIN public.companies c ON c.id = l.company_id
    LEFT JOIN public.projects p ON p.id = l.project_id
    -- 0158: the name-only view, not profiles under select_profiles.
    LEFT JOIN public.profile_names pr ON pr.id = l.supervisor_id
    LEFT JOIN public.drivers d ON d.id = l.driver_id
    WHERE (v_context IS NULL OR l.movement_context = v_context)
      AND l.movement_type = 'entry'
      AND l.recorded_at >= p_from
      AND l.recorded_at <= p_to
      AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
  ), open_rows AS (
    -- Current state, so the fleet predicate applies here.
    SELECT v.equipment_code, v.equipment_type, v.company_name_ar,
           v.company_name_en, v.project_name_ar, v.project_name_en,
           v.driver_name, v.entry_recorded_at
    FROM public.equipment_visits v
    JOIN public.equipment e ON e.id = v.equipment_id
    WHERE (v_context IS NULL OR v.movement_context = v_context)
      AND v.exit_log_id IS NULL
      AND e.is_active
      AND e.status = 'active'
      AND (v_owners IS NULL OR e.ownership_status = ANY(v_owners))
  ), ranked AS (
    SELECT COALESCE(company_name_ar, company_name_en, '—') name, count(*)::int count
    FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
  ), projects AS (
    SELECT COALESCE(project_name_ar, project_name_en, '—') name, count(*)::int count
    FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
  ), foremen AS (
    SELECT COALESCE(supervisor_name, '—') name, count(*)::int count, max(recorded_at) last_entry
    FROM entries GROUP BY 1 ORDER BY count(*) DESC, name LIMIT 5
  ), open_visits AS (
    SELECT jsonb_agg(jsonb_build_object(
      'equipment_code', equipment_code, 'equipment_type', equipment_type,
      'company_name', COALESCE(company_name_ar, company_name_en),
      'project_name', COALESCE(project_name_ar, project_name_en),
      'driver_name', driver_name, 'entry_recorded_at', entry_recorded_at
    ) ORDER BY entry_recorded_at DESC) value
    FROM (
      SELECT equipment_code, equipment_type, company_name_ar, company_name_en,
        project_name_ar, project_name_en, driver_name, entry_recorded_at
      FROM open_rows
      ORDER BY entry_recorded_at DESC LIMIT 5
    ) v
  ), latest AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'equipment_id', equipment_id, 'supervisor_id', supervisor_id,
      'movement_type', movement_type, 'movement_context', movement_context,
      'driver_name', driver_name, 'driver_id', driver_id, 'recorded_at', recorded_at,
      'created_at', created_at, 'contractor_equipment_code', contractor_equipment_code,
      'registration_method', registration_method, 'odometer_reading', odometer_reading,
      'notes', notes, 'photo_url', photo_url,
      'equipment', jsonb_build_object(
        'id', equipment_id, 'code', equipment_code, 'type', equipment_type,
        'plate_number', plate_number, 'chassis_number', chassis_number
      ),
      'company', CASE WHEN company_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', company_id, 'name_ar', company_name_ar, 'name_en', company_name_en
      ) END,
      'project', CASE WHEN project_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', project_id, 'name_ar', project_name_ar, 'name_en', project_name_en
      ) END,
      'supervisor', jsonb_build_object('id', supervisor_id, 'full_name', supervisor_name),
      'driver', CASE WHEN driver_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', driver_id, 'mobile_number', driver_mobile
      ) END
    ) ORDER BY recorded_at DESC, id DESC) value
    FROM (SELECT * FROM entries ORDER BY recorded_at DESC, id DESC LIMIT 10) x
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM entries),
    'equipment', (SELECT count(DISTINCT equipment_id)::int FROM entries),
    'companies', (SELECT count(DISTINCT company_id)::int FROM entries WHERE company_id IS NOT NULL),
    'projects', (SELECT count(DISTINCT project_id)::int FROM entries WHERE project_id IS NOT NULL),
    'open', (SELECT count(*)::int FROM open_rows),
    'latest', COALESCE((SELECT value FROM latest), '[]'::jsonb),
    'open_visits', COALESCE((SELECT value FROM open_visits), '[]'::jsonb),
    'top_companies', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM ranked r), '[]'::jsonb),
    'top_projects', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM projects r), '[]'::jsonb),
    'foremen', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM foremen r), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION
  public.get_entry_report_summary(timestamptz, timestamptz, text[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.get_entry_report_summary(timestamptz, timestamptz, text[], text)
  TO authenticated;

COMMENT ON FUNCTION
  public.get_entry_report_summary(timestamptz, timestamptz, text[], text) IS
  'Entry report summary for a Saudi-time range. p_owners is a validated list '
  'of ownership_status values (NULL or empty means every owner); p_context is '
  '''site'' (the default, the previous behaviour), ''workshop'' or ''all''. '
  'The entry counts are the movements as they were recorded; the open-visit '
  'count and list are current state and therefore only fleet equipment '
  '(is_active AND status = ''active''). SECURITY INVOKER, so entry_exit_logs '
  'RLS stays authoritative. Since 0158: reports.view is required '
  '(reports_view_required, 42501), p_context must lie inside its scope '
  '(all: any; site / workshop: that context only; else '
  'reports_context_out_of_scope, 42501), and the foreman names come from '
  'profile_names.';

-- ===========================================================================
-- H. The catalogue text
-- ===========================================================================
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.permissions
    WHERE key IN ('home.foreman', 'movements.exit_cross_context', 'inquiry.view')
  ) <> 3 THEN
    RAISE EXCEPTION '0158: a permission key to describe is missing';
  END IF;
END;
$$;

UPDATE public.permissions
SET description_ar = 'لوحة الفورمان وازرار تسجيل حركات المشاريع. نطاقها لا يغير القائمة: الحركات المعروضة تتبع نطاق «عرض الحركات»: «الخاص به» يعرض حركاته، و«المشاريع» و«شركاته» و«الكل» تعرض السجل كاملا، و«الورشة» تعرض سجل الورشة.',
    description_en = 'The foreman home with the project movement buttons. Its scope does not change the list: the movements shown follow the scope of "View movements": "His own" lists his movements, "Projects", "His companies" and "All" list the full log, "Workshop" lists the workshop log.'
WHERE key = 'home.foreman';

UPDATE public.permissions
SET description_ar = 'خروج مشروع يغلق زيارة فتحها مستخدم اخر، وقائمة الخروج تعرض كل الزيارات المفتوحة. الخروج ياخذ دائما سياق الدخول الذي يغلقه (مشروع او ورشة).',
    description_en = 'A project exit may close a visit another user opened, and the exit list shows every open visit. An exit always takes the context of the entry it closes (project or workshop).'
WHERE key = 'movements.exit_cross_context';

UPDATE public.permissions
SET description_ar = 'فتح صفحة الاستعلام عن معدة وحالتها وزياراتها. لا تعرض الصفحة شيئا بدون «عرض الحركات».',
    description_en = 'Open the equipment inquiry page: its state and visits. It shows nothing without "View movements".'
WHERE key = 'inquiry.view';

-- ===========================================================================
-- I. The unused reader of every unit's last movement
-- ===========================================================================
DROP FUNCTION IF EXISTS public.get_all_equipment_last_movement();

NOTIFY pgrst, 'reload schema';
