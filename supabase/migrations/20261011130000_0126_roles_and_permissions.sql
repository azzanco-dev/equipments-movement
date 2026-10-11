-- 0126: roles and permissions, INACTIVE (wave 22A, database half).
--
-- Owner decision 2026-10-11. Access is decided today by six fixed role names
-- in `profiles.role` (admin, supervisor, workshop,
-- assistant_workshop_manager, workshop_manager, monitor), tested by name in
-- RLS policies, database functions, API routes and client routing. The owner
-- wants roles he can define himself (for example «رئيس الفورمين», «مسؤول
-- المعدات», «مشتريات») made of named permissions. This migration adds that
-- system; 0127 points the policies and functions at its permission keys.
--
-- ===========================================================================
-- 0. THE NON-NEGOTIABLE RULE: THE SYSTEM SHIPS INACTIVE
-- ===========================================================================
--   While `app_settings.roles_system` is `{"enabled": false}` (the value this
--   migration writes, and the only value it ever writes), EVERY user's
--   effective permissions are EXACTLY today's, computed from `profiles.role`
--   by the FROZEN legacy mapping `public.legacy_role_permissions(role)`. That
--   mapping is HARD-CODED in the function body; it is not read from any
--   table, so nothing an admin creates, edits or assigns in the new tables
--   can change what anybody may do while the system is inactive.
--
--   Activation is a separate, explicit admin action later:
--   `public.set_roles_system_enabled(true)`, which refuses while the new
--   assignments are incomplete (see 6). Nothing activates it by default.
--
-- ===========================================================================
-- 1. Two evaluation paths, one entry point
-- ===========================================================================
--   `public.permission_scope(key)` is the single decision function;
--   `public.has_permission(key)` is `permission_scope(key) IS NOT NULL`, and
--   `public.current_permissions()` lists the same answer for the client.
--
--     flag OFF (legacy):  profiles.role  -> legacy_role_permissions(role)
--     flag ON  (active):  profile_roles  -> roles (must be is_active)
--                                        -> role_permissions
--
--   No session, no profile, no assignment, an inactive role, an unknown key
--   or a NULL key: no permission (fail closed). A granted permission with no
--   scope answers 'all' from permission_scope.
--
--   `public.is_admin()` and `public.current_user_role()` are NOT changed: they
--   stay role-based on `profiles.role`, because the Edge Functions, two API
--   routes and a few policies still use them (0127 lists them). "Admin" means
--   the same users in both worlds: the 'admin' role in `profile_roles` is kept
--   equal to `profiles.role = 'admin'` (the admin parity rule, see 5 and 6).
--
-- ===========================================================================
-- 2. Objects
-- ===========================================================================
--   Tables (RLS on, SELECT only for clients; every write goes through the
--   SECURITY DEFINER functions below or the triggers):
--     permissions        the fixed catalogue of keys (code-owned; no write
--                        path at all, only migrations change it)
--     roles              system roles (the six legacy ones) and custom roles
--     role_permissions   role -> permission (+ scope)
--     profile_roles      the NEW assignment layer, one role per user. Seeded
--                        from profiles.role; `profiles.role` is untouched.
--     app_settings       key/value flags; row `roles_system`
--     role_changes       append-only audit of the four tables above
--   Functions:
--     legacy_role_permissions(text)            the frozen mapping
--     roles_system_enabled()                   the flag
--     permission_scope(text) / has_permission(text) / current_permissions()
--     movement_scope_allows(text, uuid, text, uuid)
--                                              row predicate of a scope
--     admin_upsert_role, admin_set_role_permissions,
--     admin_assign_profile_role, admin_delete_role
--     admin_roles_system_offenders(), admin_roles_system_preview()
--     set_roles_system_enabled(boolean)
--   Triggers:
--     sync_profile_role_assignment  profiles -> profile_roles (new users get
--                                   an assignment; legacy role changes follow
--                                   while the assignment was not customised;
--                                   admin transitions always follow)
--     audit_role_change             the four tables -> role_changes (one
--                                   audit_*_change function per table)
--
-- ===========================================================================
-- 3. Scopes
-- ===========================================================================
--   all        every row
--   site       every project (site) movement, plus the user's own rows
--   workshop   every workshop movement, plus the user's own rows
--   companies  project movements of the user's assigned companies
--              (profile_companies), plus the user's own rows
--   own        the rows the user recorded (`supervisor_id = auth.uid()`)
--   Each scoped permission lists the scopes it accepts in
--   `permissions.scopes`. `site` is added to the four scopes of the brief
--   because «رئيس الفورمين» reads "all project movements, not the workshop".
--   For `users.read` the scope `workshop` means "users whose legacy role is a
--   workshop role", exactly today's select_profiles rule.
--
-- ===========================================================================
-- 4. The legacy mapping (what every role can do TODAY)
-- ===========================================================================
--   Derived gate by gate from the live policies and functions (latest
--   definitions through 0125), the API routes and the client routing. The
--   six system roles are seeded in role_permissions FROM the function, so
--   the seed equals the mapping by construction; tests/wave22Roles.test.cjs
--   checks the mapping against the gate table and the dependency rules.
--
-- ===========================================================================
-- 5. Admin-only management, validated (SECURITY DEFINER functions)
-- ===========================================================================
--   Every function requires `is_admin()` AND `has_permission('settings.roles')`
--   and serialises on one advisory key, hashtextextended('roles_system', 0).
--   * `admin` cannot be deleted, deactivated or lose any permission.
--   * System roles cannot be deleted or deactivated (new users are assigned
--     their legacy role automatically); they can be renamed and their
--     ACTIVE-mode permissions edited. The legacy mapping never changes.
--   * A role with assignments cannot be deleted or deactivated.
--   * An assignment needs an existing, active role. A user's own admin
--     assignment cannot be changed by himself.
--   * Admin parity: the 'admin' role can be assigned only to a user whose
--     legacy role is admin, and a legacy admin can only be assigned 'admin'.
--     A legacy role change to or from admin moves the assignment with it.
--   * Every permission key must exist; scoped keys need an accepted scope,
--     unscoped keys none; `admin_only` keys (users.manage, settings.roles)
--     only on 'admin'; every key's `requires` must be granted too.
--
-- ===========================================================================
-- 6. Enabling (`set_roles_system_enabled(true)`) refuses, and reports the
--    offenders, while any profile has no assignment, an unknown or inactive
--    role, or breaks admin parity. Disabling is always allowed and returns
--    everybody to the legacy mapping at once.
--
-- ===========================================================================
-- 7. Rollout
-- ===========================================================================
--   Safe to apply before any UI: with the flag off nothing changes for
--   anybody. 0127 (policies/functions on keys) depends on this migration and
--   is equally behaviour-neutral with the flag off. The UI that reads
--   `current_permissions()` and manages roles can ship afterwards.

-- ===========================================================================
-- 1. permissions: the fixed catalogue
-- ===========================================================================
CREATE TABLE public.permissions (
  key text PRIMARY KEY
    CONSTRAINT permissions_key_format CHECK (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  group_key text NOT NULL,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  description_ar text NOT NULL,
  description_en text NOT NULL,
  scoped boolean NOT NULL DEFAULT false,
  scopes text[],
  requires text[] NOT NULL DEFAULT '{}',
  admin_only boolean NOT NULL DEFAULT false,
  enforced_in text NOT NULL,
  sort int NOT NULL,
  CONSTRAINT permissions_scopes_shape CHECK (
    (scoped AND scopes IS NOT NULL AND cardinality(scopes) > 0
      AND scopes <@ ARRAY['all', 'site', 'workshop', 'companies', 'own']::text[])
    OR (NOT scoped AND scopes IS NULL)
  ),
  CONSTRAINT permissions_enforced_in_check
    CHECK (enforced_in IN ('database', 'interface', 'reserved'))
);

COMMENT ON TABLE public.permissions IS
  'Fixed catalogue of permission keys (0126). Keys are owned by code: no client or function writes this table; only migrations change it. enforced_in: database = an RLS policy or database function checks the key; interface = only screen/route visibility (the data underneath is protected by other keys or is open to every signed-in user); reserved = no gate yet.';
COMMENT ON COLUMN public.permissions.scopes IS
  'Accepted scopes of a scoped key (all, site, workshop, companies, own); NULL for an unscoped key.';
COMMENT ON COLUMN public.permissions.requires IS
  'Keys that must also be granted to a role holding this key (validated by admin_set_role_permissions).';
COMMENT ON COLUMN public.permissions.admin_only IS
  'True for keys that only the admin role may hold (users.manage, settings.roles).';

INSERT INTO public.permissions (
  key, group_key, name_ar, name_en, description_ar, description_en,
  scoped, scopes, requires, admin_only, enforced_in, sort
) VALUES
  ('home.admin', 'home', 'لوحة الادمن', 'Admin home',
   'عرض لوحة الادمن: حالة الاسطول والرسوم والمؤشرات، للقراءة فقط.',
   'The admin home: fleet state, charts and indicators, read-only.',
   false, NULL, ARRAY['movements.read'], false, 'database', 10),
  ('home.foreman', 'home', 'لوحة الفورمان', 'Foreman home',
   'لوحة الفورمان وازرار تسجيل حركات المشاريع. النطاق يحدد الحركات المعروضة فيها: حركاته او شركاته او الكل.',
   'The foreman home with the project movement buttons. The scope decides which movements it lists: own, assigned companies or all.',
   true, ARRAY['own', 'companies', 'all'], ARRAY['movements.site.create'], false, 'interface', 20),
  ('home.workshop', 'home', 'لوحة الورشة', 'Workshop home',
   'لوحة الورشة وازرار تسجيل حركات الورشة. «الورشة» تعرض حركات الورشة، و«الكل» تعرض المشاريع والورشة.',
   'The workshop home with the workshop movement buttons. "workshop" lists workshop movements, "all" lists projects and workshop.',
   true, ARRAY['workshop', 'all'], ARRAY['movements.workshop.create'], false, 'interface', 30),

  ('movements.read', 'movements', 'عرض الحركات', 'View movements',
   'قراءة الحركات والزيارات وصورها وتغييرات السائق. الحركات التي سجلها المستخدم تظهر له دائما.',
   'Read movements, visits, their photos and driver changes. A user always sees the movements he recorded.',
   true, ARRAY['own', 'site', 'workshop', 'companies', 'all'], '{}', false, 'database', 100),
  ('movements.site.create', 'movements', 'تسجيل حركات المشاريع', 'Record project movements',
   'تسجيل دخول وخروج المشاريع. «حركاته» يغلق زياراته فقط، و«الكل» يغلق زيارة اي فورمان.',
   'Record project entries and exits. "own" closes only his visits, "all" closes any foreman''s visit.',
   true, ARRAY['own', 'all'], ARRAY['movements.photos.manage'], false, 'database', 110),
  ('movements.site.driver_change', 'movements', 'تغيير السائق خلال الزيارة', 'Change the driver during a visit',
   'تسجيل تغيير سائق زيارة مشروع مفتوحة ضمن النطاق.',
   'Record a driver change on an open project visit within the scope.',
   true, ARRAY['own', 'companies', 'all'], '{}', false, 'database', 120),
  ('movements.site.contractor_code', 'movements', 'تعديل رقم المعدة لدى المقاول', 'Edit the contractor equipment code',
   'تعديل رقم المعدة لدى المقاول في دخول المشروع الذي سجله المستخدم ما دامت الزيارة مفتوحة.',
   'Edit the contractor equipment code of a project entry the user recorded while the visit is open.',
   false, NULL, '{}', false, 'database', 130),
  ('movements.workshop.create', 'movements', 'تسجيل حركات الورشة', 'Record workshop movements',
   'تسجيل دخول وخروج الورشة.',
   'Record workshop entries and exits.',
   false, NULL, ARRAY['movements.photos.manage'], false, 'database', 140),
  ('movements.workshop.classify', 'movements', 'تصنيف دخول الورشة', 'Classify workshop entries',
   'تحديد نوع دخول الورشة: صيانة او وقوف او خارج الخدمة.',
   'Set the workshop entry type: maintenance, parking or out of service.',
   false, NULL, ARRAY['movements.read'], false, 'database', 150),
  ('movements.notify_foreman', 'movements', 'ابلاغ الفورمان', 'Notify the foreman',
   'ارسال ابلاغ واتساب للفورمان عن معدة داخل مشروعه، وعرض ابلاغات وصول الورشة.',
   'Send the WhatsApp notice to the foreman of a unit inside his project, and read the workshop arrival notices.',
   false, NULL, '{}', false, 'database', 160),
  ('movements.exit_cross_context', 'movements', 'خروج يغلق اي زيارة', 'Exit closing any visit',
   'تسجيل خروج يغلق دخول السياق الاخر (مشروع او ورشة) او دخول فورمان اخر.',
   'Record an exit that closes an entry of the other context (project or workshop) or of another foreman.',
   false, NULL, '{}', false, 'database', 170),
  ('movements.edit_delete', 'movements', 'تعديل وحذف الحركات', 'Edit and delete movements',
   'تعديل تفاصيل الحركة وحذف اخر حركة للمعدة، وتسجيل حركة باسم مستخدم اخر.',
   'Edit movement details, delete the latest movement of a unit, and record a movement in another user''s name.',
   false, NULL, ARRAY['movements.read'], false, 'database', 180),
  ('movements.import', 'movements', 'استيراد الحركات', 'Import movements',
   'استيراد الحركات من Excel واضافة الرصيد الافتتاحي للورشة.',
   'Import movements from Excel and add the workshop opening balance.',
   false, NULL, ARRAY['movements.site.create', 'movements.workshop.create', 'movements.exit_cross_context'], false, 'database', 190),
  ('movements.photos.manage', 'movements', 'صور الحركة', 'Movement photos',
   'اضافة صور الحركة وحذف الصور التي رفعها المستخدم، على الحركات ضمن النطاق.',
   'Add movement photos and remove the photos the user uploaded, on movements within the scope.',
   true, ARRAY['own', 'site', 'workshop', 'companies', 'all'], '{}', false, 'database', 200),
  ('movements.photos.delete_any', 'movements', 'حذف صور الاخرين', 'Remove anyone''s photos',
   'حذف او استبدال صورة حركة رفعها مستخدم اخر.',
   'Remove or replace a movement photo another user uploaded.',
   false, NULL, ARRAY['movements.photos.manage'], false, 'database', 210),
  ('movements.export', 'movements', 'تصدير الحركات', 'Export movements',
   'تصدير السجلات الى Excel او PDF ضمن نطاق عرض الحركات.',
   'Export the logs to Excel or PDF within the movement read scope.',
   false, NULL, ARRAY['movements.read'], false, 'interface', 220),
  ('movements.activity', 'movements', 'سجل النشاط', 'Activity log',
   'عرض سجل تعديل وحذف الحركات.',
   'Read the log of movement edits and deletions.',
   false, NULL, '{}', false, 'database', 230),

  ('reports.view', 'reports', 'التقارير', 'Reports',
   'عرض التقارير. «الكل» لكل التقارير، و«المشاريع» لتقارير المشاريع، و«الورشة» لتقارير الورشة. تقرير المعدات يحتاج «الكل».',
   'Open the reports. "all" for every report, "site" for the project reports, "workshop" for the workshop reports. The equipment report needs "all".',
   true, ARRAY['site', 'workshop', 'all'], ARRAY['movements.read'], false, 'database', 300),
  ('inquiry.view', 'reports', 'الاستعلام عن معدة', 'Equipment inquiry',
   'فتح صفحة الاستعلام عن معدة وحالتها وزياراتها.',
   'Open the equipment inquiry page: its state and visits.',
   false, NULL, '{}', false, 'interface', 310),

  ('equipment.read', 'equipment', 'عرض المعدات', 'View equipment',
   'فتح قائمة المعدات وتفاصيلها.',
   'Open the equipment list and details.',
   false, NULL, '{}', false, 'interface', 400),
  ('equipment.create', 'equipment', 'اضافة معدة', 'Add equipment',
   'اضافة معدة من نموذج المعدات.',
   'Add a unit from the equipment form.',
   false, NULL, ARRAY['equipment.read'], false, 'database', 410),
  ('equipment.edit', 'equipment', 'تعديل المعدات', 'Edit equipment',
   'تعديل بيانات المعدات.',
   'Edit equipment master data.',
   false, NULL, ARRAY['equipment.read'], false, 'database', 420),
  ('equipment.delete', 'equipment', 'حذف المعدات', 'Delete equipment',
   'حذف معدة.',
   'Delete a unit.',
   false, NULL, ARRAY['equipment.read'], false, 'database', 430),
  ('equipment.quick_create', 'equipment', 'انشاء معدة سريع', 'Quick-create equipment',
   'انشاء معدة من نموذج الحركة. «المشاريع» لنموذج المشاريع، و«الورشة» لنموذج الورشة، و«الكل» للاثنين.',
   'Create a unit from the movement form. "site" for the project form, "workshop" for the workshop form, "all" for both.',
   true, ARRAY['site', 'workshop', 'all'], '{}', false, 'database', 440),
  ('equipment.change_code', 'equipment', 'تغيير رقم المعدة', 'Change the equipment code',
   'تغيير رقم المعدة مع حفظ الرقم السابق والسبب.',
   'Change a unit''s code, keeping the previous code and the reason.',
   false, NULL, ARRAY['equipment.edit'], false, 'database', 450),
  ('equipment.import', 'equipment', 'استيراد المعدات', 'Import equipment',
   'اضافة وتحديث المعدات من Excel.',
   'Add and update equipment from Excel.',
   false, NULL, ARRAY['equipment.create', 'equipment.edit'], false, 'database', 460),
  ('equipment.tracker_link', 'equipment', 'ربط افاقي', 'Afaqy tracker link',
   'ربط وحدات التتبع في افاقي بالمعدات.',
   'Link Afaqy tracking units to equipment.',
   false, NULL, ARRAY['equipment.edit'], false, 'interface', 470),
  ('equipment.location.view', 'equipment', 'الموقع الحالي للمعدة', 'Current equipment location',
   'عرض موقع المعدة الحالي من افاقي.',
   'Show the unit''s current location from Afaqy.',
   false, NULL, '{}', false, 'interface', 480),

  ('drivers.read', 'drivers', 'عرض السائقين', 'View drivers',
   'فتح قائمة السائقين وتفاصيلهم.',
   'Open the driver list and details.',
   false, NULL, '{}', false, 'interface', 500),
  ('drivers.create', 'drivers', 'اضافة سائق', 'Add drivers',
   'اضافة سائق من نموذج السائقين.',
   'Add a driver from the driver form.',
   false, NULL, ARRAY['drivers.read'], false, 'database', 510),
  ('drivers.edit', 'drivers', 'تعديل السائقين', 'Edit drivers',
   'تعديل بيانات السائقين.',
   'Edit driver master data.',
   false, NULL, ARRAY['drivers.read'], false, 'database', 520),
  ('drivers.delete', 'drivers', 'حذف السائقين', 'Delete drivers',
   'حذف سائق.',
   'Delete a driver.',
   false, NULL, ARRAY['drivers.read'], false, 'database', 530),
  ('drivers.quick_create', 'drivers', 'انشاء سائق سريع', 'Quick-create drivers',
   'انشاء سائق من نموذج دخول المشروع.',
   'Create a driver from the project entry form.',
   false, NULL, '{}', false, 'database', 540),
  ('drivers.import', 'drivers', 'استيراد السائقين', 'Import drivers',
   'اضافة وتحديث السائقين من Excel.',
   'Add and update drivers from Excel.',
   false, NULL, ARRAY['drivers.create', 'drivers.edit'], false, 'interface', 550),

  ('companies_projects.read', 'master_data', 'عرض الشركات والمشاريع', 'View companies and projects',
   'فتح قوائم الشركات والمشاريع.',
   'Open the company and project lists.',
   false, NULL, '{}', false, 'interface', 600),
  ('companies_projects.edit', 'master_data', 'ادارة الشركات والمشاريع', 'Manage companies and projects',
   'اضافة وتعديل وحذف الشركات والمشاريع وربطها.',
   'Add, edit and delete companies and projects and their links.',
   false, NULL, ARRAY['companies_projects.read'], false, 'database', 610),
  ('lessors.read', 'master_data', 'عرض الموردين', 'View suppliers',
   'فتح قائمة الموردين.',
   'Open the supplier list.',
   false, NULL, '{}', false, 'interface', 620),
  ('lessors.edit', 'master_data', 'ادارة الموردين', 'Manage suppliers',
   'اضافة وتعديل وحذف الموردين.',
   'Add, edit and delete suppliers.',
   false, NULL, ARRAY['lessors.read'], false, 'database', 630),
  ('lessors.quick_create', 'master_data', 'انشاء مورد سريع', 'Quick-create suppliers',
   'انشاء مورد من نموذج المعدة السريع.',
   'Create a supplier from the quick equipment form.',
   false, NULL, '{}', false, 'database', 640),

  ('users.read', 'users', 'عرض المستخدمين', 'View users',
   'قراءة بيانات المستخدمين. «الكل» لكل المستخدمين، و«الورشة» لمستخدمي الورشة فقط.',
   'Read user records. "all" for every user, "workshop" for workshop users only.',
   true, ARRAY['workshop', 'all'], '{}', false, 'database', 700),
  ('users.manage', 'users', 'ادارة المستخدمين', 'Manage users',
   'اضافة المستخدمين وتعديلهم وحذفهم وجوالاتهم وشركاتهم. للادمن فقط.',
   'Add, edit and delete users, their mobiles and companies. Admin only.',
   false, NULL, ARRAY['users.read'], true, 'database', 710),

  ('settings.equipment_types', 'settings', 'انواع المعدات', 'Equipment types',
   'اضافة وتعديل وحذف انواع المعدات.',
   'Add, edit and delete equipment types.',
   false, NULL, '{}', false, 'database', 800),
  ('settings.integrations', 'settings', 'الربط والتنبيهات', 'Integrations and notices',
   'ربط افاقي وحالة بوابة الواتساب وسجل كل الابلاغات.',
   'The Afaqy link, the WhatsApp gateway state and every notice.',
   false, NULL, '{}', false, 'database', 810),
  ('settings.roles', 'settings', 'الادوار والصلاحيات', 'Roles and permissions',
   'ادارة الادوار وصلاحياتها وتعيينها للمستخدمين وتفعيل النظام. للادمن فقط.',
   'Manage roles, their permissions and assignments, and activate the system. Admin only.',
   false, NULL, ARRAY['users.manage'], true, 'database', 820),

  ('map.view', 'map', 'خريطة المشاريع', 'Projects map',
   'عرض خريطة المشاريع وعدد المعدات في كل مشروع.',
   'Show the projects map with the unit count per project.',
   false, NULL, '{}', false, 'interface', 900),

  ('purchasing.view', 'purchasing', 'المشتريات: عرض', 'Purchasing: view',
   'محجوزة للمرحلة الثالثة: اوامر الشراء والايجارات. لا تفتح شيئا بعد.',
   'Reserved for phase 3: purchase orders and rentals. Opens nothing yet.',
   false, NULL, '{}', false, 'reserved', 1000),
  ('purchasing.manage', 'purchasing', 'المشتريات: ادارة', 'Purchasing: manage',
   'محجوزة للمرحلة الثالثة: اوامر الشراء والايجارات. لا تفتح شيئا بعد.',
   'Reserved for phase 3: purchase orders and rentals. Opens nothing yet.',
   false, NULL, ARRAY['purchasing.view'], false, 'reserved', 1010);

-- ===========================================================================
-- 2. roles
-- ===========================================================================
CREATE TABLE public.roles (
  key text PRIMARY KEY
    CONSTRAINT roles_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name_ar text NOT NULL
    CONSTRAINT roles_name_ar_check CHECK (btrim(name_ar) <> '' AND char_length(name_ar) <= 60),
  name_en text NOT NULL
    CONSTRAINT roles_name_en_check CHECK (btrim(name_en) <> '' AND char_length(name_en) <= 60),
  description_ar text
    CONSTRAINT roles_description_ar_check CHECK (char_length(description_ar) <= 500),
  description_en text
    CONSTRAINT roles_description_en_check CHECK (char_length(description_en) <= 500),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT roles_system_active CHECK (NOT is_system OR is_active)
);

CREATE UNIQUE INDEX roles_name_ar_unique ON public.roles (lower(btrim(name_ar)));

COMMENT ON TABLE public.roles IS
  'Roles of the permission system (0126). is_system: the six legacy roles, which cannot be deleted or deactivated; they can be renamed and their ACTIVE-mode permissions edited (the legacy mapping never changes). Written only by admin_upsert_role and admin_delete_role.';

INSERT INTO public.roles (key, name_ar, name_en, description_ar, description_en, is_system, is_active)
VALUES
  ('admin', 'ادمن', 'Admin',
   'كل الصلاحيات. لا يحذف ولا يعطل ولا تنزع منه صلاحية.',
   'Every permission. Cannot be deleted, deactivated or lose a permission.', true, true),
  ('supervisor', 'فورمين', 'Foreman',
   'يسجل حركات المشاريع لزياراته ويرى حركاته.',
   'Records project movements for his visits and sees his movements.', true, true),
  ('workshop', 'مسؤول حركة الورشة', 'Workshop Movement Officer',
   'يسجل حركات الورشة.',
   'Records workshop movements.', true, true),
  ('assistant_workshop_manager', 'مساعد مدير الورشة', 'Assistant Workshop Manager',
   'يسجل حركات الورشة ويصنفها ويرى كل الحركات.',
   'Records and classifies workshop movements and sees every movement.', true, true),
  ('workshop_manager', 'مدير الورشة', 'Workshop Manager',
   'يسجل حركات الورشة ويصنفها ويرى كل الحركات.',
   'Records and classifies workshop movements and sees every movement.', true, true),
  ('monitor', 'متابعة', 'Monitoring',
   'قراءة فقط: لوحة الادمن والسجلات والاستعلام.',
   'Read-only: the admin home, the logs and the inquiry.', true, true),
  ('foreman_lead', 'رئيس الفورمين', 'Foreman Lead',
   'مقترح من مصفوفة المالك: يسجل حركات المشاريع لاي شركة ويرى كل حركات المشاريع. لم يعين لاحد.',
   'Suggested by the owner''s matrix: records project movements for any company and sees every project movement. Assigned to nobody.', false, true),
  ('equipment_officer', 'مسؤول المعدات', 'Equipment Officer',
   'مقترح من مصفوفة المالك: يدير المعدات والسائقين والموردين وانواع المعدات ويقرا لوحة الادمن، ولا يسجل حركات. لم يعين لاحد.',
   'Suggested by the owner''s matrix: manages equipment, drivers, suppliers and equipment types and reads the admin home; records no movement. Assigned to nobody.', false, true),
  ('purchasing', 'مشتريات', 'Purchasing',
   'مقترح من مصفوفة المالك: قراءة الحركات والتقارير والبيانات، وادارة الموردين، ومحجوز للمرحلة الثالثة. لم يعين لاحد.',
   'Suggested by the owner''s matrix: reads movements, reports and master data, manages suppliers, reserved for phase 3. Assigned to nobody.', false, true);

-- ===========================================================================
-- 3. role_permissions
-- ===========================================================================
CREATE TABLE public.role_permissions (
  role_key text NOT NULL REFERENCES public.roles(key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  scope text
    CONSTRAINT role_permissions_scope_check
      CHECK (scope IN ('all', 'site', 'workshop', 'companies', 'own')),
  PRIMARY KEY (role_key, permission_key)
);

CREATE INDEX role_permissions_permission_key_idx
  ON public.role_permissions (permission_key);

COMMENT ON TABLE public.role_permissions IS
  'Permissions of each role for the ACTIVE mode (0126). Read by permission_scope() only while app_settings.roles_system is enabled. Written only by admin_set_role_permissions. scope is NULL for an unscoped key.';

-- ===========================================================================
-- 4. profile_roles: the new assignment layer
-- ===========================================================================
CREATE TABLE public.profile_roles (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES public.roles(key),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX profile_roles_role_key_idx ON public.profile_roles (role_key);

COMMENT ON TABLE public.profile_roles IS
  'One role per user for the ACTIVE mode (0126). Seeded from profiles.role; profiles.role stays the legacy role and is not changed by this system. Written by admin_assign_profile_role and by the sync_profile_role_assignment trigger (new users; legacy role changes while the assignment still equals the old legacy role; every change to or from admin).';

-- ===========================================================================
-- 5. app_settings: the flag
-- ===========================================================================
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT app_settings_roles_system_shape CHECK (
    key <> 'roles_system'
    OR (jsonb_typeof(value) = 'object' AND jsonb_typeof(value -> 'enabled') = 'boolean')
  )
);

COMMENT ON TABLE public.app_settings IS
  'Application flags readable by every signed-in user (0126). Holds no secret. Row roles_system = {"enabled": bool} is written only by set_roles_system_enabled.';

INSERT INTO public.app_settings (key, value)
VALUES ('roles_system', '{"enabled": false}'::jsonb);

-- ===========================================================================
-- 6. role_changes: the audit
-- ===========================================================================
CREATE TABLE public.role_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  action text NOT NULL
    CONSTRAINT role_changes_action_check CHECK (action IN (
      'seeded',
      'role_created', 'role_updated', 'role_deleted',
      'permission_granted', 'permission_scope_changed', 'permission_revoked',
      'role_assigned', 'role_reassigned', 'role_unassigned',
      'roles_system_enabled', 'roles_system_disabled', 'setting_changed'
    )),
  role_key text,
  permission_key text,
  profile_id uuid,
  old_value jsonb,
  new_value jsonb
);

CREATE INDEX role_changes_changed_at_idx
  ON public.role_changes (changed_at DESC, id DESC);

COMMENT ON TABLE public.role_changes IS
  'Append-only audit of roles, role_permissions, profile_roles and app_settings (0126), written only by the audit_role_change triggers (audit_*_change functions). No foreign keys, so the history survives deletions. changed_by is NULL for a migration or a service-role change.';

-- ===========================================================================
-- 7. The frozen legacy mapping
-- ===========================================================================
-- Hard-coded on purpose: no table is read, so nothing done in the new tables
-- changes it. One row per (role, key); scope NULL for an unscoped key. Each
-- row is the gate it reproduces (latest definitions through 0125):
--   home.*                       client routing (App.tsx, homeScope.ts)
--   movements.read               select_entry_exit_logs, can_access_movement
--   movements.site.create        sequence trigger site branch, site searches
--   movements.site.driver_change change_active_movement_driver
--   movements.site.contractor_code update_entry_contractor_code (foreman only)
--   movements.workshop.create    sequence trigger workshop branch, search
--   movements.workshop.classify  classify_workshop_entry
--   movements.notify_foreman     request_workshop_arrival_notice, notices
--   movements.exit_cross_context sequence trigger is_admin() exemption
--   movements.edit_delete        admin_update/delete_movement, insert policy
--   movements.import             Excel import + its trigger exemptions,
--                                workshop opening balance
--   movements.photos.*           can_write_movement_photos, photo/Storage
--   movements.export             LogsScreen export (admin, monitor, managers)
--   movements.activity           movement_audit_logs
--   reports.view                 report pages, get_equipment_attention_report
--   inquiry.view                 /inquiry route (every role)
--   equipment.*, drivers.*, companies_projects.*, lessors.*, settings.*,
--   users.*, map.view            master-data policies, quick creates, admin
--                                pages, select_profiles
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

REVOKE ALL ON FUNCTION public.legacy_role_permissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_role_permissions(text) TO authenticated;

COMMENT ON FUNCTION public.legacy_role_permissions(text) IS
  'FROZEN legacy mapping (0126): the permissions each of the six legacy roles (profiles.role) has today, hard-coded, never read from a table. Used by permission_scope() while app_settings.roles_system is disabled, and by the comparison screen. An unknown or NULL role returns no row.';

-- ===========================================================================
-- 8. Seeds: system role permissions (= the mapping), suggestions, assignments
-- ===========================================================================
INSERT INTO public.role_permissions (role_key, permission_key, scope)
SELECT r.key, m.permission_key, m.scope
FROM public.roles r
CROSS JOIN LATERAL public.legacy_role_permissions(r.key) AS m
WHERE r.is_system;

INSERT INTO public.role_permissions (role_key, permission_key, scope)
VALUES
  ('foreman_lead', 'home.foreman', 'all'),
  ('foreman_lead', 'movements.read', 'site'),
  ('foreman_lead', 'movements.site.create', 'all'),
  ('foreman_lead', 'movements.site.driver_change', 'all'),
  ('foreman_lead', 'movements.site.contractor_code', NULL),
  ('foreman_lead', 'movements.photos.manage', 'site'),
  ('foreman_lead', 'movements.export', NULL),
  ('foreman_lead', 'reports.view', 'site'),
  ('foreman_lead', 'inquiry.view', NULL),
  ('foreman_lead', 'equipment.read', NULL),
  ('foreman_lead', 'equipment.create', NULL),
  ('foreman_lead', 'equipment.quick_create', 'site'),
  ('foreman_lead', 'equipment.location.view', NULL),
  ('foreman_lead', 'drivers.quick_create', NULL),
  ('foreman_lead', 'lessors.quick_create', NULL),
  ('foreman_lead', 'companies_projects.read', NULL),
  ('foreman_lead', 'map.view', NULL),
  ('equipment_officer', 'home.admin', NULL),
  ('equipment_officer', 'movements.read', 'all'),
  ('equipment_officer', 'movements.export', NULL),
  ('equipment_officer', 'reports.view', 'all'),
  ('equipment_officer', 'inquiry.view', NULL),
  ('equipment_officer', 'equipment.read', NULL),
  ('equipment_officer', 'equipment.create', NULL),
  ('equipment_officer', 'equipment.edit', NULL),
  ('equipment_officer', 'equipment.change_code', NULL),
  ('equipment_officer', 'equipment.import', NULL),
  ('equipment_officer', 'equipment.tracker_link', NULL),
  ('equipment_officer', 'equipment.location.view', NULL),
  ('equipment_officer', 'drivers.read', NULL),
  ('equipment_officer', 'drivers.create', NULL),
  ('equipment_officer', 'drivers.edit', NULL),
  ('equipment_officer', 'drivers.import', NULL),
  ('equipment_officer', 'companies_projects.read', NULL),
  ('equipment_officer', 'companies_projects.edit', NULL),
  ('equipment_officer', 'lessors.read', NULL),
  ('equipment_officer', 'lessors.edit', NULL),
  ('equipment_officer', 'settings.equipment_types', NULL),
  ('purchasing', 'movements.read', 'all'),
  ('purchasing', 'movements.export', NULL),
  ('purchasing', 'reports.view', 'all'),
  ('purchasing', 'inquiry.view', NULL),
  ('purchasing', 'equipment.read', NULL),
  ('purchasing', 'equipment.location.view', NULL),
  ('purchasing', 'drivers.read', NULL),
  ('purchasing', 'companies_projects.read', NULL),
  ('purchasing', 'lessors.read', NULL),
  ('purchasing', 'lessors.edit', NULL),
  ('purchasing', 'map.view', NULL),
  ('purchasing', 'purchasing.view', NULL),
  ('purchasing', 'purchasing.manage', NULL);

-- Every existing user starts on his legacy role, so the comparison screen
-- starts from reality.
INSERT INTO public.profile_roles (profile_id, role_key)
SELECT p.id, p.role
FROM public.profiles p;

-- ===========================================================================
-- 9. The decision functions
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.roles_system_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_settings s
    WHERE s.key = 'roles_system'
      AND s.value -> 'enabled' = 'true'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.roles_system_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roles_system_enabled() TO authenticated;

COMMENT ON FUNCTION public.roles_system_enabled() IS
  'True only when app_settings.roles_system is {"enabled": true} (0126). A missing row or any other value is false: the legacy mapping applies.';

CREATE OR REPLACE FUNCTION public.permission_scope(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_key IS NULL OR auth.uid() IS NULL THEN NULL
    WHEN public.roles_system_enabled() THEN (
      SELECT COALESCE(rp.scope, 'all')
      FROM public.profile_roles pr
      JOIN public.roles r
        ON r.key = pr.role_key
       AND r.is_active
      JOIN public.role_permissions rp
        ON rp.role_key = pr.role_key
       AND rp.permission_key = p_key
      WHERE pr.profile_id = auth.uid()
      LIMIT 1
    )
    ELSE (
      SELECT COALESCE(m.scope, 'all')
      FROM public.profiles p
      CROSS JOIN LATERAL public.legacy_role_permissions(p.role) AS m
      WHERE p.id = auth.uid()
        AND m.permission_key = p_key
      LIMIT 1
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.permission_scope(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permission_scope(text) TO authenticated;

COMMENT ON FUNCTION public.permission_scope(text) IS
  'The caller''s scope for a permission key (0126): all, site, workshop, companies or own; ''all'' for a granted unscoped key; NULL when not granted. Flag off: profiles.role through legacy_role_permissions. Flag on: profile_roles -> active role -> role_permissions. No session, no profile, no assignment, an inactive role or an unknown key: NULL.';

CREATE OR REPLACE FUNCTION public.has_permission(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.permission_scope(p_key) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.has_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;

COMMENT ON FUNCTION public.has_permission(text) IS
  'True when the caller holds the permission key in the current mode (0126); never NULL. Policies call it as (SELECT public.has_permission(''key'')) so it runs once per statement.';

CREATE OR REPLACE FUNCTION public.current_permissions()
RETURNS TABLE(permission_key text, scope text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.permission_key, COALESCE(m.scope, 'all')
  FROM public.profiles p
  CROSS JOIN LATERAL public.legacy_role_permissions(p.role) AS m
  WHERE p.id = auth.uid()
    AND NOT public.roles_system_enabled()
  UNION ALL
  SELECT rp.permission_key, COALESCE(rp.scope, 'all')
  FROM public.profile_roles pr
  JOIN public.roles r
    ON r.key = pr.role_key
   AND r.is_active
  JOIN public.role_permissions rp ON rp.role_key = pr.role_key
  WHERE pr.profile_id = auth.uid()
    AND public.roles_system_enabled();
$$;

REVOKE ALL ON FUNCTION public.current_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_permissions() TO authenticated;

COMMENT ON FUNCTION public.current_permissions() IS
  'Every permission of the caller in the current mode, with its scope (''all'' for an unscoped key), for the client to load once after sign-in (0126). Same answer as permission_scope() key by key.';

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
  'Whether a movement row (its recorder, context and company) is inside a scope (0126). NULL scope: false. Every scope includes the caller''s own rows. site/workshop: rows of that context. companies: project rows of the caller''s profile_companies. all: every row. Never NULL.';

-- ===========================================================================
-- 10. Admin management functions
-- ===========================================================================
-- Shared: the caller must be a legacy admin AND hold settings.roles in the
-- current mode (both are true exactly for the admins, see admin parity), and
-- every function serialises on hashtextextended('roles_system', 0).

CREATE OR REPLACE FUNCTION public.admin_upsert_role(
  p_key text,
  p_name_ar text,
  p_name_en text,
  p_description_ar text DEFAULT NULL,
  p_description_en text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS public.roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text := lower(btrim(p_key));
  v_name_ar text := btrim(p_name_ar);
  v_name_en text := btrim(p_name_en);
  v_description_ar text := NULLIF(btrim(p_description_ar), '');
  v_description_en text := NULLIF(btrim(p_description_en), '');
  v_existing public.roles;
  v_role public.roles;
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may manage roles.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('roles_system', 0));

  IF v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'invalid_role_key' USING ERRCODE = '22023',
      HINT = 'A role key is 2 to 40 lowercase letters, digits or underscores, starting with a letter.';
  END IF;
  IF v_name_ar IS NULL OR v_name_ar = '' OR char_length(v_name_ar) > 60
     OR v_name_en IS NULL OR v_name_en = '' OR char_length(v_name_en) > 60 THEN
    RAISE EXCEPTION 'invalid_role_name' USING ERRCODE = '22023',
      HINT = 'Both role names are required, 60 characters at most.';
  END IF;
  IF char_length(v_description_ar) > 500 OR char_length(v_description_en) > 500 THEN
    RAISE EXCEPTION 'invalid_role_description' USING ERRCODE = '22023',
      HINT = 'A role description is 500 characters at most.';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.roles r
    WHERE lower(btrim(r.name_ar)) = lower(v_name_ar)
      AND r.key <> v_key
  ) THEN
    RAISE EXCEPTION 'role_name_taken' USING ERRCODE = '23505',
      HINT = 'Another role already has this Arabic name.';
  END IF;

  SELECT * INTO v_existing FROM public.roles WHERE key = v_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.roles (
      key, name_ar, name_en, description_ar, description_en,
      is_system, is_active, created_by, updated_by
    ) VALUES (
      v_key, v_name_ar, v_name_en, v_description_ar, v_description_en,
      false, p_is_active, auth.uid(), auth.uid()
    )
    RETURNING * INTO v_role;
    RETURN v_role;
  END IF;

  IF NOT p_is_active AND v_existing.is_active THEN
    IF v_existing.is_system THEN
      RAISE EXCEPTION 'system_role_locked' USING ERRCODE = '55000',
        HINT = 'A system role cannot be deactivated or deleted.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profile_roles pr WHERE pr.role_key = v_key) THEN
      RAISE EXCEPTION 'role_in_use' USING ERRCODE = '55000',
        HINT = 'Move every user off this role first.';
    END IF;
  END IF;

  UPDATE public.roles
  SET name_ar = v_name_ar,
      name_en = v_name_en,
      description_ar = v_description_ar,
      description_en = v_description_en,
      is_active = p_is_active,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE key = v_key
  RETURNING * INTO v_role;
  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_role(text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_role(text, text, text, text, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_upsert_role(text, text, text, text, text, boolean) IS
  'Admin-only (0126). Creates a custom role (is_system false) when the key is new, otherwise updates its names, descriptions and is_active. The key itself never changes. Codes: admin_required (42501), invalid_role_key, invalid_role_name, invalid_role_description, invalid_payload (22023), role_name_taken (23505), system_role_locked, role_in_use (55000).';

CREATE OR REPLACE FUNCTION public.admin_set_role_permissions(
  p_role_key text,
  p_permissions jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.roles;
  v_item jsonb;
  v_key text;
  v_scope text;
  v_permission public.permissions;
  v_keys text[] := '{}';
  v_scopes text[] := '{}';
  v_required text;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may manage roles.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('roles_system', 0));

  SELECT * INTO v_role FROM public.roles WHERE key = p_role_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_permissions IS NULL
     OR jsonb_typeof(p_permissions) <> 'array'
     OR jsonb_array_length(p_permissions) > 200 THEN
    RAISE EXCEPTION 'invalid_permissions_payload' USING ERRCODE = '22023',
      HINT = 'Send an array of {"key": text, "scope": text or null}.';
  END IF;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_permissions) AS x LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR jsonb_typeof(v_item -> 'key') IS DISTINCT FROM 'string'
       OR (v_item ? 'scope'
           AND jsonb_typeof(v_item -> 'scope') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION 'invalid_permissions_payload' USING ERRCODE = '22023',
        HINT = 'Send an array of {"key": text, "scope": text or null}.';
    END IF;
    v_key := v_item ->> 'key';
    v_scope := v_item ->> 'scope';

    IF v_key = ANY(v_keys) THEN
      RAISE EXCEPTION 'duplicate_permission' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;

    SELECT * INTO v_permission FROM public.permissions WHERE key = v_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown_permission' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;

    IF v_permission.scoped THEN
      IF v_scope IS NULL OR NOT (v_scope = ANY(v_permission.scopes)) THEN
        RAISE EXCEPTION 'invalid_permission_scope' USING ERRCODE = '22023', DETAIL = v_key;
      END IF;
    ELSIF v_scope IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_permission_scope' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;

    IF v_permission.admin_only AND v_role.key <> 'admin' THEN
      RAISE EXCEPTION 'admin_only_permission' USING ERRCODE = '22023', DETAIL = v_key;
    END IF;

    v_keys := v_keys || v_key;
    v_scopes := v_scopes || v_scope;
  END LOOP;

  FOR v_key, v_required IN
    SELECT p.key, r.required
    FROM public.permissions p
    CROSS JOIN LATERAL unnest(p.requires) AS r(required)
    WHERE p.key = ANY(v_keys)
      AND NOT (r.required = ANY(v_keys))
    ORDER BY p.sort, r.required
  LOOP
    RAISE EXCEPTION 'missing_required_permission' USING ERRCODE = '22023',
      DETAIL = v_key || ' requires ' || v_required;
  END LOOP;

  -- admin keeps every permission it has, with the same scope.
  IF v_role.key = 'admin' AND EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role_key = 'admin'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(v_keys, v_scopes) AS n(key, scope)
        WHERE n.key = rp.permission_key
          AND n.scope IS NOT DISTINCT FROM rp.scope
      )
  ) THEN
    RAISE EXCEPTION 'admin_role_locked' USING ERRCODE = '55000',
      HINT = 'No permission of the admin role can be removed or narrowed.';
  END IF;

  -- Apply the difference only, so the audit records real changes.
  DELETE FROM public.role_permissions rp
  WHERE rp.role_key = v_role.key
    AND NOT (rp.permission_key = ANY(v_keys));

  UPDATE public.role_permissions rp
  SET scope = n.scope
  FROM unnest(v_keys, v_scopes) AS n(key, scope)
  WHERE rp.role_key = v_role.key
    AND rp.permission_key = n.key
    AND rp.scope IS DISTINCT FROM n.scope;

  INSERT INTO public.role_permissions (role_key, permission_key, scope)
  SELECT v_role.key, n.key, n.scope
  FROM unnest(v_keys, v_scopes) AS n(key, scope)
  ON CONFLICT (role_key, permission_key) DO NOTHING;

  UPDATE public.roles
  SET updated_at = now(), updated_by = auth.uid()
  WHERE key = v_role.key;

  SELECT count(*)::integer INTO v_count
  FROM public.role_permissions
  WHERE role_key = v_role.key;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_role_permissions(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role_permissions(text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.admin_set_role_permissions(text, jsonb) IS
  'Admin-only (0126). Replaces the ACTIVE-mode permission set of a role with p_permissions = [{"key": text, "scope": text|null}, ...] (at most 200) and returns the number of permissions the role now has. Validates: role exists; every key exists, once; scoped keys carry an accepted scope, unscoped keys none; admin_only keys only on admin; every requires is granted; admin loses nothing. Never touches the legacy mapping. Codes: admin_required (42501), role_not_found (P0002), invalid_permissions_payload, duplicate_permission, unknown_permission, invalid_permission_scope, admin_only_permission, missing_required_permission (22023; DETAIL names the key), admin_role_locked (55000).';

CREATE OR REPLACE FUNCTION public.admin_assign_profile_role(
  p_profile_id uuid,
  p_role_key text
)
RETURNS public.profile_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_legacy_role text;
  v_role public.roles;
  v_assignment public.profile_roles;
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may assign roles.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('roles_system', 0));

  SELECT p.role INTO v_legacy_role
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_role FROM public.roles WHERE key = p_role_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_role.is_active THEN
    RAISE EXCEPTION 'role_inactive' USING ERRCODE = '55000',
      HINT = 'Activate the role before assigning it.';
  END IF;

  IF p_profile_id = auth.uid() AND v_role.key <> 'admin' THEN
    RAISE EXCEPTION 'cannot_change_own_admin' USING ERRCODE = '55000',
      HINT = 'You cannot take the admin role away from your own account.';
  END IF;

  -- Admin parity: the admin role follows the legacy admin role exactly.
  IF (v_legacy_role = 'admin') IS DISTINCT FROM (v_role.key = 'admin') THEN
    RAISE EXCEPTION 'admin_role_mismatch' USING ERRCODE = '55000',
      HINT = 'The admin role is assigned only to users whose account role is admin, and an admin account keeps the admin role. Change the account role in the user form first.';
  END IF;

  INSERT INTO public.profile_roles AS pr (profile_id, role_key, assigned_at, assigned_by)
  VALUES (p_profile_id, v_role.key, now(), auth.uid())
  ON CONFLICT (profile_id) DO UPDATE
    SET role_key = EXCLUDED.role_key,
        assigned_at = EXCLUDED.assigned_at,
        assigned_by = EXCLUDED.assigned_by
    WHERE pr.role_key IS DISTINCT FROM EXCLUDED.role_key;

  SELECT * INTO v_assignment FROM public.profile_roles WHERE profile_id = p_profile_id;
  RETURN v_assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_profile_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_profile_role(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_assign_profile_role(uuid, text) IS
  'Admin-only (0126). Sets the user''s role in profile_roles (the ACTIVE-mode assignment; profiles.role is not changed) and returns the row; assigning the current role again changes nothing. Codes: admin_required (42501), user_not_found, role_not_found (P0002), role_inactive, cannot_change_own_admin, admin_role_mismatch (55000: admin is assigned exactly to the users whose profiles.role is admin).';

CREATE OR REPLACE FUNCTION public.admin_delete_role(p_role_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.roles;
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may manage roles.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('roles_system', 0));

  SELECT * INTO v_role FROM public.roles WHERE key = p_role_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role.is_system THEN
    RAISE EXCEPTION 'system_role_locked' USING ERRCODE = '55000',
      HINT = 'A system role cannot be deactivated or deleted.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profile_roles pr WHERE pr.role_key = v_role.key) THEN
    RAISE EXCEPTION 'role_in_use' USING ERRCODE = '55000',
      HINT = 'Move every user off this role first.';
  END IF;

  DELETE FROM public.roles WHERE key = v_role.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_role(text) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_role(text) IS
  'Admin-only (0126). Deletes a custom role with no assignment, with its permissions. Codes: admin_required (42501), role_not_found (P0002), system_role_locked, role_in_use (55000).';

CREATE OR REPLACE FUNCTION public.admin_roles_system_offenders()
RETURNS TABLE(
  profile_id uuid,
  full_name text,
  legacy_role text,
  role_key text,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may manage roles.';
  END IF;

  RETURN QUERY
  SELECT x.id, x.full_name, x.role, x.role_key, x.reason
  FROM (
    SELECT
      p.id,
      p.full_name,
      p.role,
      pr.role_key,
      CASE
        WHEN pr.profile_id IS NULL THEN 'no_role'
        WHEN r.key IS NULL THEN 'unknown_role'
        WHEN NOT r.is_active THEN 'inactive_role'
        WHEN (p.role = 'admin') IS DISTINCT FROM (pr.role_key = 'admin') THEN 'admin_mismatch'
      END AS reason
    FROM public.profiles p
    LEFT JOIN public.profile_roles pr ON pr.profile_id = p.id
    LEFT JOIN public.roles r ON r.key = pr.role_key
  ) x
  WHERE x.reason IS NOT NULL
  ORDER BY x.full_name, x.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_roles_system_offenders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_roles_system_offenders() TO authenticated;

COMMENT ON FUNCTION public.admin_roles_system_offenders() IS
  'Admin-only (0126). The users that block activation, with the reason: no_role (no profile_roles row), unknown_role, inactive_role, admin_mismatch (profiles.role admin vs assigned admin differ). Empty means set_roles_system_enabled(true) will succeed. Code: admin_required (42501).';

CREATE OR REPLACE FUNCTION public.admin_roles_system_preview()
RETURNS TABLE(
  profile_id uuid,
  full_name text,
  legacy_role text,
  role_key text,
  permission_key text,
  legacy_scope text,
  active_scope text,
  change text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may manage roles.';
  END IF;

  RETURN QUERY
  WITH legacy AS (
    SELECT p.id AS profile_id, m.permission_key, COALESCE(m.scope, 'all') AS scope
    FROM public.profiles p
    CROSS JOIN LATERAL public.legacy_role_permissions(p.role) AS m
  ),
  active AS (
    SELECT pr.profile_id, rp.permission_key, COALESCE(rp.scope, 'all') AS scope
    FROM public.profile_roles pr
    JOIN public.roles r ON r.key = pr.role_key AND r.is_active
    JOIN public.role_permissions rp ON rp.role_key = pr.role_key
  ),
  diff AS (
    SELECT
      COALESCE(l.profile_id, a.profile_id) AS profile_id,
      COALESCE(l.permission_key, a.permission_key) AS permission_key,
      l.scope AS legacy_scope,
      a.scope AS active_scope
    FROM legacy l
    FULL JOIN active a
      ON a.profile_id = l.profile_id
     AND a.permission_key = l.permission_key
    WHERE l.scope IS DISTINCT FROM a.scope
  )
  SELECT
    d.profile_id,
    p.full_name,
    p.role,
    pr.role_key,
    d.permission_key,
    d.legacy_scope,
    d.active_scope,
    CASE
      WHEN d.legacy_scope IS NULL THEN 'gained'
      WHEN d.active_scope IS NULL THEN 'lost'
      ELSE 'scope_changed'
    END
  FROM diff d
  JOIN public.profiles p ON p.id = d.profile_id
  LEFT JOIN public.profile_roles pr ON pr.profile_id = d.profile_id
  ORDER BY p.full_name, d.profile_id, d.permission_key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_roles_system_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_roles_system_preview() TO authenticated;

COMMENT ON FUNCTION public.admin_roles_system_preview() IS
  'Admin-only (0126). For every user, each permission whose effect would change on activation: gained (not in the legacy mapping), lost (legacy only) or scope_changed, with both scopes (''all'' for an unscoped key). Empty means activation changes nobody''s permissions. Code: admin_required (42501).';

CREATE OR REPLACE FUNCTION public.set_roles_system_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offenders jsonb;
  v_changed boolean;
BEGIN
  IF auth.uid() IS NULL
     OR public.is_admin() IS NOT TRUE
     OR public.has_permission('settings.roles') IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501',
            HINT = 'Only an administrator may activate the roles system.';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('roles_system', 0));

  IF p_enabled THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'profile_id', o.profile_id,
          'full_name', o.full_name,
          'legacy_role', o.legacy_role,
          'role_key', o.role_key,
          'reason', o.reason
        )
        ORDER BY o.full_name, o.profile_id
      ),
      '[]'::jsonb
    )
    INTO v_offenders
    FROM public.admin_roles_system_offenders() AS o;

    IF jsonb_array_length(v_offenders) > 0 THEN
      RETURN jsonb_build_object(
        'enabled', public.roles_system_enabled(),
        'changed', false,
        'offenders', v_offenders
      );
    END IF;
  END IF;

  UPDATE public.app_settings
  SET value = jsonb_build_object('enabled', p_enabled),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE key = 'roles_system'
    AND value -> 'enabled' IS DISTINCT FROM to_jsonb(p_enabled);
  v_changed := FOUND;

  RETURN jsonb_build_object(
    'enabled', public.roles_system_enabled(),
    'changed', v_changed,
    'offenders', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_roles_system_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_roles_system_enabled(boolean) TO authenticated;

COMMENT ON FUNCTION public.set_roles_system_enabled(boolean) IS
  'Admin-only (0126). The ONLY writer of app_settings.roles_system. Returns {"enabled": bool, "changed": bool, "offenders": [...]}. Enabling is refused (changed false, nothing written) while admin_roles_system_offenders() returns anybody; the offenders are returned instead. Disabling is always allowed. Codes: admin_required (42501), invalid_payload (22023).';

-- ===========================================================================
-- 11. Triggers: assignment sync and audit
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.sync_profile_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.profile_roles (profile_id, role_key, assigned_by)
    VALUES (NEW.id, NEW.role, auth.uid())
    ON CONFLICT (profile_id) DO NOTHING;
    RETURN NULL;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Follow the legacy role when the assignment was never customised (it
    -- still equals the old legacy role), and ALWAYS for a change to or from
    -- admin, which keeps the admin parity rule.
    UPDATE public.profile_roles pr
    SET role_key = NEW.role,
        assigned_at = now(),
        assigned_by = auth.uid()
    WHERE pr.profile_id = NEW.id
      AND (pr.role_key = OLD.role OR NEW.role = 'admin' OR OLD.role = 'admin')
      AND pr.role_key IS DISTINCT FROM NEW.role;
    IF NOT FOUND THEN
      INSERT INTO public.profile_roles (profile_id, role_key, assigned_by)
      VALUES (NEW.id, NEW.role, auth.uid())
      ON CONFLICT (profile_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_role_assignment() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_profile_role_assignment() IS
  'Trigger on profiles (0126). A new profile gets its legacy role as assignment. A legacy role change moves the assignment when it still equals the old legacy role, and always when admin is involved (admin parity). Not executable by client roles.';

CREATE TRIGGER sync_profile_role_assignment
AFTER INSERT OR UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_assignment();

-- One audit function per table (each body only names its own columns).
CREATE OR REPLACE FUNCTION public.audit_roles_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN RETURN NULL; END IF;
  INSERT INTO public.role_changes (changed_by, action, role_key, old_value, new_value)
  VALUES (
    auth.uid(),
    CASE TG_OP WHEN 'INSERT' THEN 'role_created' WHEN 'UPDATE' THEN 'role_updated' ELSE 'role_deleted' END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.key ELSE NEW.key END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_role_permissions_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.scope IS NOT DISTINCT FROM NEW.scope THEN RETURN NULL; END IF;
  INSERT INTO public.role_changes (changed_by, action, role_key, permission_key, old_value, new_value)
  VALUES (
    auth.uid(),
    CASE TG_OP WHEN 'INSERT' THEN 'permission_granted' WHEN 'UPDATE' THEN 'permission_scope_changed' ELSE 'permission_revoked' END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.role_key ELSE NEW.role_key END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.permission_key ELSE NEW.permission_key END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('scope', OLD.scope) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('scope', NEW.scope) END
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_profile_roles_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role_key IS NOT DISTINCT FROM NEW.role_key THEN RETURN NULL; END IF;
  INSERT INTO public.role_changes (changed_by, action, role_key, profile_id, old_value, new_value)
  VALUES (
    auth.uid(),
    CASE TG_OP WHEN 'INSERT' THEN 'role_assigned' WHEN 'UPDATE' THEN 'role_reassigned' ELSE 'role_unassigned' END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.role_key ELSE NEW.role_key END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.profile_id ELSE NEW.profile_id END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('role_key', OLD.role_key) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('role_key', NEW.role_key) END
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_app_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text := 'setting_changed';
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN RETURN NULL; END IF;
  IF TG_OP <> 'DELETE' AND NEW.key = 'roles_system' THEN
    v_action := CASE
      WHEN NEW.value -> 'enabled' = 'true'::jsonb THEN 'roles_system_enabled'
      ELSE 'roles_system_disabled'
    END;
  END IF;
  INSERT INTO public.role_changes (changed_by, action, old_value, new_value)
  VALUES (
    auth.uid(),
    v_action,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('key', OLD.key, 'value', OLD.value) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('key', NEW.key, 'value', NEW.value) END
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_roles_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_role_permissions_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_profile_roles_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_app_settings_change() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.audit_roles_change() IS
  'Trigger on roles (0126): one role_changes row per real change (role_created, role_updated, role_deleted). Not executable by client roles.';
COMMENT ON FUNCTION public.audit_role_permissions_change() IS
  'Trigger on role_permissions (0126): one role_changes row per real change (permission_granted, permission_scope_changed, permission_revoked). Not executable by client roles.';
COMMENT ON FUNCTION public.audit_profile_roles_change() IS
  'Trigger on profile_roles (0126): one role_changes row per real change (role_assigned, role_reassigned, role_unassigned). Not executable by client roles.';
COMMENT ON FUNCTION public.audit_app_settings_change() IS
  'Trigger on app_settings (0126): one role_changes row per real change (roles_system_enabled, roles_system_disabled, setting_changed). Not executable by client roles.';

CREATE TRIGGER audit_role_change
AFTER INSERT OR UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.audit_roles_change();

CREATE TRIGGER audit_role_change
AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION public.audit_role_permissions_change();

CREATE TRIGGER audit_role_change
AFTER INSERT OR UPDATE OR DELETE ON public.profile_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_profile_roles_change();

CREATE TRIGGER audit_role_change
AFTER INSERT OR UPDATE OR DELETE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_app_settings_change();

-- The seeds above ran before the audit triggers existed: one row records them.
INSERT INTO public.role_changes (action, new_value)
VALUES (
  'seeded',
  jsonb_build_object(
    'migration', '0126',
    'roles', (SELECT count(*) FROM public.roles),
    'role_permissions', (SELECT count(*) FROM public.role_permissions),
    'profile_roles', (SELECT count(*) FROM public.profile_roles),
    'roles_system', (SELECT value FROM public.app_settings WHERE key = 'roles_system')
  )
);

-- ===========================================================================
-- 12. RLS and grants: clients SELECT only
-- ===========================================================================
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.role_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.profile_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.app_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.role_changes FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.permissions TO authenticated;
GRANT SELECT ON public.roles TO authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT SELECT ON public.profile_roles TO authenticated;
GRANT SELECT ON public.app_settings TO authenticated;
GRANT SELECT ON public.role_changes TO authenticated;

CREATE POLICY select_permissions ON public.permissions
FOR SELECT TO authenticated
USING (true);

CREATE POLICY select_roles ON public.roles
FOR SELECT TO authenticated
USING (true);

CREATE POLICY select_role_permissions ON public.role_permissions
FOR SELECT TO authenticated
USING (true);

CREATE POLICY select_profile_roles ON public.profile_roles
FOR SELECT TO authenticated
USING (
  profile_id = auth.uid()
  OR (SELECT public.has_permission('users.manage'))
);

CREATE POLICY select_app_settings ON public.app_settings
FOR SELECT TO authenticated
USING (true);

CREATE POLICY select_role_changes ON public.role_changes
FOR SELECT TO authenticated
USING ((SELECT public.has_permission('settings.roles')));

COMMENT ON POLICY select_profile_roles ON public.profile_roles IS
  'A user reads his own assignment; users.manage (admin only) reads all (0126).';
COMMENT ON POLICY select_role_changes ON public.role_changes IS
  'Only settings.roles (admin only) reads the audit (0126).';

NOTIFY pgrst, 'reload schema';
