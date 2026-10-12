-- 0128: permission key for the text-extraction page («استخراج النصوص»)
--
-- Owner request 2026-10-12. The extraction / ERPNext page (app/extracting,
-- src/screens/Extracting.tsx) is gated by `profile.role === 'admin'` in the
-- client only. It gets its own key in the permission catalogue so the roles
-- page can grant it to a custom role once the roles system is active.
--
-- What this migration does
--   * INSERT one row into public.permissions: `extracting.view`
--     (group settings, enforced in the interface, unscoped, no prerequisite).
--   * Recreate public.legacy_role_permissions(text) from its 0126 body
--     VERBATIM plus ONE row: ('admin', 'extracting.view', NULL) - the frozen
--     legacy mapping must keep matching today's gate (admin only).
--   * INSERT the same row into public.role_permissions for the system role
--     `admin` (the seed mirrors the mapping; the audit trigger records it).
--   Nothing else changes. The roles system stays INACTIVE; with the flag
--   off has_permission('extracting.view') is true for admins exactly as the
--   client gate is today. The page keeps its client check until routing
--   moves to permissions.

INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES
  ('extracting.view', 'settings', 'صفحة استخراج النصوص', 'Text extraction page',
   'فتح صفحة استخراج بيانات الهويات وارسالها الى ERPNext.',
   'Open the identity text-extraction page and its ERPNext publishing.',
   false, NULL, '{}', false, 'interface', 830)
ON CONFLICT (key) DO NOTHING;

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
    ('admin', 'map.view', NULL),
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
  'FROZEN legacy mapping (0126): the permissions each of the six legacy roles (profiles.role) has today, hard-coded, never read from a table. Used by permission_scope() while app_settings.roles_system is disabled, and by the comparison screen. An unknown or NULL role returns no row.';

REVOKE ALL ON FUNCTION public.legacy_role_permissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_role_permissions(text) TO authenticated;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES ('admin', 'extracting.view', NULL)
ON CONFLICT (role_key, permission_key) DO NOTHING;
