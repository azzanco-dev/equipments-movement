-- 0130: retire the projects-map permission `map.view` («خريطة المشاريع»).
--
-- Owner decision 2026-10-14: the projects map is CANCELLED. Its permission
-- key was added to the catalogue by 0126 (group `map`, enforced in the
-- interface, granted to the admin by the frozen legacy mapping and suggested
-- for the custom roles «رئيس الفورمين» and «مشتريات») before any screen used
-- it; no policy, function, route or page ever tested it. The roles page hid
-- it already (src/components/roles/RolePermissionsTab.tsx); this migration
-- removes it from the database so the catalogue, the mapping and the role
-- editor agree.
--
-- What this migration does
--   * DELETE the key from public.role_permissions first (the seeds of 0126:
--     admin, foreman_lead, purchasing, plus any custom grant). The 0126 FK is
--     ON DELETE CASCADE, so the second delete would take these rows anyway;
--     the explicit delete keeps the audit obvious: the audit_role_change
--     trigger writes one `permission_revoked` row per grant into
--     public.role_changes (changed_by NULL: a migration). The audit table has
--     no foreign keys, so every text row that names `map.view` stays.
--   * DELETE the key from public.permissions.
--   * Recreate public.legacy_role_permissions(text) from its 0128 body
--     VERBATIM minus ONE row: ('admin', 'map.view', NULL). The frozen legacy
--     mapping must not grant a key the catalogue no longer has (the
--     comparison screen joins the two). Nothing else of the mapping changes,
--     so every role keeps exactly today's permissions; the key opened nothing.
--     Grants are restated as in 0128.
--   The roles system stays INACTIVE. No flag is read or written here.

DELETE FROM public.role_permissions
WHERE permission_key = 'map.view';

DELETE FROM public.permissions
WHERE key = 'map.view';

CREATE OR REPLACE FUNCTION public.legacy_role_permissions(p_role text)
RETURNS TABLE(permission_key text, scope text)
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT m.permission_key, m.scope
  FROM (VALUES
    ('admin', 'home.admin', NULL),
    ('admin', 'movements.read', 'all'),
    ('admin', 'movements.site.create', 'all'),
    ('admin', 'movements.site.driver_change', 'all'),
    ('admin', 'movements.workshop.create', NULL),
    ('admin', 'movements.workshop.classify', NULL),
    ('admin', 'movements.notify_foreman', NULL),
    ('admin', 'movements.exit_cross_context', NULL),
    ('admin', 'movements.edit_delete', NULL),
    ('admin', 'movements.import', NULL),
    ('admin', 'movements.photos.manage', 'all'),
    ('admin', 'movements.photos.delete_any', NULL),
    ('admin', 'movements.export', NULL),
    ('admin', 'movements.activity', NULL),
    ('admin', 'reports.view', 'all'),
    ('admin', 'inquiry.view', NULL),
    ('admin', 'equipment.read', NULL),
    ('admin', 'equipment.create', NULL),
    ('admin', 'equipment.edit', NULL),
    ('admin', 'equipment.delete', NULL),
    ('admin', 'equipment.quick_create', 'all'),
    ('admin', 'equipment.change_code', NULL),
    ('admin', 'equipment.import', NULL),
    ('admin', 'equipment.tracker_link', NULL),
    ('admin', 'equipment.location.view', NULL),
    ('admin', 'drivers.read', NULL),
    ('admin', 'drivers.create', NULL),
    ('admin', 'drivers.edit', NULL),
    ('admin', 'drivers.delete', NULL),
    ('admin', 'drivers.quick_create', NULL),
    ('admin', 'drivers.import', NULL),
    ('admin', 'companies_projects.read', NULL),
    ('admin', 'companies_projects.edit', NULL),
    ('admin', 'lessors.read', NULL),
    ('admin', 'lessors.edit', NULL),
    ('admin', 'lessors.quick_create', NULL),
    ('admin', 'users.read', 'all'),
    ('admin', 'users.manage', NULL),
    ('admin', 'settings.equipment_types', NULL),
    ('admin', 'settings.integrations', NULL),
    ('admin', 'extracting.view', NULL),
    ('admin', 'settings.roles', NULL),
    ('supervisor', 'home.foreman', 'own'),
    ('supervisor', 'movements.read', 'own'),
    ('supervisor', 'movements.site.create', 'own'),
    ('supervisor', 'movements.site.driver_change', 'own'),
    ('supervisor', 'movements.site.contractor_code', NULL),
    ('supervisor', 'movements.photos.manage', 'own'),
    ('supervisor', 'inquiry.view', NULL),
    ('supervisor', 'equipment.quick_create', 'site'),
    ('supervisor', 'drivers.quick_create', NULL),
    ('supervisor', 'lessors.quick_create', NULL),
    ('workshop', 'home.workshop', 'workshop'),
    ('workshop', 'movements.read', 'all'),
    ('workshop', 'movements.workshop.create', NULL),
    ('workshop', 'movements.notify_foreman', NULL),
    ('workshop', 'movements.photos.manage', 'workshop'),
    ('workshop', 'inquiry.view', NULL),
    ('workshop', 'equipment.quick_create', 'workshop'),
    ('workshop', 'users.read', 'workshop'),
    ('assistant_workshop_manager', 'home.workshop', 'all'),
    ('assistant_workshop_manager', 'movements.read', 'all'),
    ('assistant_workshop_manager', 'movements.workshop.create', NULL),
    ('assistant_workshop_manager', 'movements.workshop.classify', NULL),
    ('assistant_workshop_manager', 'movements.notify_foreman', NULL),
    ('assistant_workshop_manager', 'movements.photos.manage', 'workshop'),
    ('assistant_workshop_manager', 'movements.export', NULL),
    ('assistant_workshop_manager', 'inquiry.view', NULL),
    ('assistant_workshop_manager', 'equipment.quick_create', 'workshop'),
    ('assistant_workshop_manager', 'users.read', 'workshop'),
    ('workshop_manager', 'home.workshop', 'all'),
    ('workshop_manager', 'movements.read', 'all'),
    ('workshop_manager', 'movements.workshop.create', NULL),
    ('workshop_manager', 'movements.workshop.classify', NULL),
    ('workshop_manager', 'movements.notify_foreman', NULL),
    ('workshop_manager', 'movements.photos.manage', 'workshop'),
    ('workshop_manager', 'movements.export', NULL),
    ('workshop_manager', 'inquiry.view', NULL),
    ('workshop_manager', 'equipment.quick_create', 'workshop'),
    ('workshop_manager', 'users.read', 'workshop'),
    ('monitor', 'home.admin', NULL),
    ('monitor', 'movements.read', 'all'),
    ('monitor', 'movements.export', NULL),
    ('monitor', 'inquiry.view', NULL),
    ('monitor', 'users.read', 'all')
  ) AS m(role_key, permission_key, scope)
  WHERE m.role_key = p_role;
$$;

COMMENT ON FUNCTION public.legacy_role_permissions(text) IS
  'FROZEN legacy mapping (0126): the permissions each of the six legacy roles (profiles.role) has today, hard-coded, never read from a table. Used by permission_scope() while app_settings.roles_system is disabled, and by the comparison screen. An unknown or NULL role returns no row. 0128 added extracting.view; 0130 retired map.view (the projects map was cancelled).';

REVOKE ALL ON FUNCTION public.legacy_role_permissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_role_permissions(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
