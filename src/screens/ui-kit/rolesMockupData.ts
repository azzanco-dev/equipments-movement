// Sample data for the roles & permissions page MOCKUP on /ui-kit. The
// permission catalogue below copies the Arabic names, groups, scopes,
// requirements and flags of migration 0126 (without «خريطة المشاريع»); the
// roles, users and change log are invented. Nothing here reaches Supabase.

export type MockScope = 'all' | 'site' | 'workshop' | 'companies' | 'own'

export type MockPermission = {
  key: string
  group: string
  name: string
  description: string
  /** Allowed scopes of a scoped key; an unscoped key has none. */
  scopes?: MockScope[]
  requires: string[]
  adminOnly?: boolean
  /** `interface` keys only decide what the screens show. */
  enforcedIn: 'database' | 'interface' | 'reserved'
}

export type MockPermissionGroup = {
  key: string
  name: string
  /** Opens collapsed (the reserved purchasing keys). */
  collapsed?: boolean
}

export const SCOPE_LABELS: Record<MockScope, string> = {
  all: 'الكل',
  site: 'المشاريع',
  workshop: 'الورشة',
  companies: 'شركاته',
  own: 'حركاته',
}

export const PERMISSION_GROUPS: MockPermissionGroup[] = [
  { key: 'home', name: 'اللوحات' },
  { key: 'movements', name: 'الحركات' },
  { key: 'reports', name: 'التقارير والاستعلام' },
  { key: 'equipment', name: 'المعدات' },
  { key: 'drivers', name: 'السائقون' },
  { key: 'master_data', name: 'البيانات الاساسية' },
  { key: 'users', name: 'المستخدمون' },
  { key: 'settings', name: 'الاعدادات' },
  { key: 'purchasing', name: 'لاحقاً', collapsed: true },
]

export const PERMISSIONS: MockPermission[] = [
  {
    key: 'home.admin',
    group: 'home',
    name: 'لوحة الادمن',
    description:
      'عرض لوحة الادمن: حالة الاسطول والرسوم والمؤشرات، للقراءة فقط.',
    requires: ['movements.read'],
    enforcedIn: 'database',
  },
  {
    key: 'home.foreman',
    group: 'home',
    name: 'لوحة الفورمان',
    description:
      'لوحة الفورمان وازرار تسجيل حركات المشاريع. النطاق يحدد الحركات المعروضة فيها: حركاته او شركاته او الكل.',
    scopes: ['own', 'companies', 'all'],
    requires: ['movements.site.create'],
    enforcedIn: 'interface',
  },
  {
    key: 'home.workshop',
    group: 'home',
    name: 'لوحة الورشة',
    description:
      'لوحة الورشة وازرار تسجيل حركات الورشة. «الورشة» تعرض حركات الورشة، و«الكل» تعرض المشاريع والورشة.',
    scopes: ['workshop', 'all'],
    requires: ['movements.workshop.create'],
    enforcedIn: 'interface',
  },
  {
    key: 'movements.read',
    group: 'movements',
    name: 'عرض الحركات',
    description:
      'قراءة الحركات والزيارات وصورها وتغييرات السائق. الحركات التي سجلها المستخدم تظهر له دائما.',
    scopes: ['own', 'site', 'workshop', 'companies', 'all'],
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'movements.site.create',
    group: 'movements',
    name: 'تسجيل حركات المشاريع',
    description:
      'تسجيل دخول وخروج المشاريع. «حركاته» يغلق زياراته فقط، و«الكل» يغلق زيارة اي فورمان.',
    scopes: ['own', 'all'],
    requires: ['movements.photos.manage'],
    enforcedIn: 'database',
  },
  {
    key: 'movements.site.driver_change',
    group: 'movements',
    name: 'تغيير السائق خلال الزيارة',
    description: 'تسجيل تغيير سائق زيارة مشروع مفتوحة ضمن النطاق.',
    scopes: ['own', 'companies', 'all'],
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'movements.site.contractor_code',
    group: 'movements',
    name: 'تعديل رقم المعدة لدى المقاول',
    description:
      'تعديل رقم المعدة لدى المقاول في دخول المشروع الذي سجله المستخدم ما دامت الزيارة مفتوحة.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'movements.workshop.create',
    group: 'movements',
    name: 'تسجيل حركات الورشة',
    description: 'تسجيل دخول وخروج الورشة.',
    requires: ['movements.photos.manage'],
    enforcedIn: 'database',
  },
  {
    key: 'movements.workshop.classify',
    group: 'movements',
    name: 'تصنيف دخول الورشة',
    description: 'تحديد نوع دخول الورشة: صيانة او وقوف او خارج الخدمة.',
    requires: ['movements.read'],
    enforcedIn: 'database',
  },
  {
    key: 'movements.notify_foreman',
    group: 'movements',
    name: 'ابلاغ الفورمان',
    description:
      'ارسال ابلاغ واتساب للفورمان عن معدة داخل مشروعه، وعرض ابلاغات وصول الورشة.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'movements.exit_cross_context',
    group: 'movements',
    name: 'خروج يغلق اي زيارة',
    description:
      'تسجيل خروج يغلق دخول السياق الاخر (مشروع او ورشة) او دخول فورمان اخر.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'movements.edit_delete',
    group: 'movements',
    name: 'تعديل وحذف الحركات',
    description:
      'تعديل تفاصيل الحركة وحذف اخر حركة للمعدة، وتسجيل حركة باسم مستخدم اخر.',
    requires: ['movements.read'],
    enforcedIn: 'database',
  },
  {
    key: 'movements.import',
    group: 'movements',
    name: 'استيراد الحركات',
    description: 'استيراد الحركات من Excel واضافة الرصيد الافتتاحي للورشة.',
    requires: [
      'movements.site.create',
      'movements.workshop.create',
      'movements.exit_cross_context',
    ],
    enforcedIn: 'database',
  },
  {
    key: 'movements.photos.manage',
    group: 'movements',
    name: 'صور الحركة',
    description:
      'اضافة صور الحركة وحذف الصور التي رفعها المستخدم، على الحركات ضمن النطاق.',
    scopes: ['own', 'site', 'workshop', 'companies', 'all'],
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'movements.photos.delete_any',
    group: 'movements',
    name: 'حذف صور الاخرين',
    description: 'حذف او استبدال صورة حركة رفعها مستخدم اخر.',
    requires: ['movements.photos.manage'],
    enforcedIn: 'database',
  },
  {
    key: 'movements.export',
    group: 'movements',
    name: 'تصدير الحركات',
    description: 'تصدير السجلات الى Excel او PDF ضمن نطاق عرض الحركات.',
    requires: ['movements.read'],
    enforcedIn: 'interface',
  },
  {
    key: 'movements.activity',
    group: 'movements',
    name: 'سجل النشاط',
    description: 'عرض سجل تعديل وحذف الحركات.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'reports.view',
    group: 'reports',
    name: 'التقارير',
    description:
      'عرض التقارير. «الكل» لكل التقارير، و«المشاريع» لتقارير المشاريع، و«الورشة» لتقارير الورشة. تقرير المعدات يحتاج «الكل».',
    scopes: ['site', 'workshop', 'all'],
    requires: ['movements.read'],
    enforcedIn: 'database',
  },
  {
    key: 'inquiry.view',
    group: 'reports',
    name: 'الاستعلام عن معدة',
    description: 'فتح صفحة الاستعلام عن معدة وحالتها وزياراتها.',
    requires: [],
    enforcedIn: 'interface',
  },
  {
    key: 'equipment.read',
    group: 'equipment',
    name: 'عرض المعدات',
    description: 'فتح قائمة المعدات وتفاصيلها.',
    requires: [],
    enforcedIn: 'interface',
  },
  {
    key: 'equipment.create',
    group: 'equipment',
    name: 'اضافة معدة',
    description: 'اضافة معدة من نموذج المعدات.',
    requires: ['equipment.read'],
    enforcedIn: 'database',
  },
  {
    key: 'equipment.edit',
    group: 'equipment',
    name: 'تعديل المعدات',
    description: 'تعديل بيانات المعدات.',
    requires: ['equipment.read'],
    enforcedIn: 'database',
  },
  {
    key: 'equipment.delete',
    group: 'equipment',
    name: 'حذف المعدات',
    description: 'حذف معدة.',
    requires: ['equipment.read'],
    enforcedIn: 'database',
  },
  {
    key: 'equipment.quick_create',
    group: 'equipment',
    name: 'انشاء معدة سريع',
    description:
      'انشاء معدة من نموذج الحركة. «المشاريع» لنموذج المشاريع، و«الورشة» لنموذج الورشة، و«الكل» للاثنين.',
    scopes: ['site', 'workshop', 'all'],
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'equipment.change_code',
    group: 'equipment',
    name: 'تغيير رقم المعدة',
    description: 'تغيير رقم المعدة مع حفظ الرقم السابق والسبب.',
    requires: ['equipment.edit'],
    enforcedIn: 'database',
  },
  {
    key: 'equipment.import',
    group: 'equipment',
    name: 'استيراد المعدات',
    description: 'اضافة وتحديث المعدات من Excel.',
    requires: ['equipment.create', 'equipment.edit'],
    enforcedIn: 'database',
  },
  {
    key: 'equipment.tracker_link',
    group: 'equipment',
    name: 'ربط افاقي',
    description: 'ربط وحدات التتبع في افاقي بالمعدات.',
    requires: ['equipment.edit'],
    enforcedIn: 'interface',
  },
  {
    key: 'equipment.location.view',
    group: 'equipment',
    name: 'الموقع الحالي للمعدة',
    description: 'عرض موقع المعدة الحالي من افاقي.',
    requires: [],
    enforcedIn: 'interface',
  },
  {
    key: 'drivers.read',
    group: 'drivers',
    name: 'عرض السائقين',
    description: 'فتح قائمة السائقين وتفاصيلهم.',
    requires: [],
    enforcedIn: 'interface',
  },
  {
    key: 'drivers.create',
    group: 'drivers',
    name: 'اضافة سائق',
    description: 'اضافة سائق من نموذج السائقين.',
    requires: ['drivers.read'],
    enforcedIn: 'database',
  },
  {
    key: 'drivers.edit',
    group: 'drivers',
    name: 'تعديل السائقين',
    description: 'تعديل بيانات السائقين.',
    requires: ['drivers.read'],
    enforcedIn: 'database',
  },
  {
    key: 'drivers.delete',
    group: 'drivers',
    name: 'حذف السائقين',
    description: 'حذف سائق.',
    requires: ['drivers.read'],
    enforcedIn: 'database',
  },
  {
    key: 'drivers.quick_create',
    group: 'drivers',
    name: 'انشاء سائق سريع',
    description: 'انشاء سائق من نموذج دخول المشروع.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'drivers.import',
    group: 'drivers',
    name: 'استيراد السائقين',
    description: 'اضافة وتحديث السائقين من Excel.',
    requires: ['drivers.create', 'drivers.edit'],
    enforcedIn: 'interface',
  },
  {
    key: 'companies_projects.read',
    group: 'master_data',
    name: 'عرض الشركات والمشاريع',
    description: 'فتح قوائم الشركات والمشاريع.',
    requires: [],
    enforcedIn: 'interface',
  },
  {
    key: 'companies_projects.edit',
    group: 'master_data',
    name: 'ادارة الشركات والمشاريع',
    description: 'اضافة وتعديل وحذف الشركات والمشاريع وربطها.',
    requires: ['companies_projects.read'],
    enforcedIn: 'database',
  },
  {
    key: 'lessors.read',
    group: 'master_data',
    name: 'عرض الموردين',
    description: 'فتح قائمة الموردين.',
    requires: [],
    enforcedIn: 'interface',
  },
  {
    key: 'lessors.edit',
    group: 'master_data',
    name: 'ادارة الموردين',
    description: 'اضافة وتعديل وحذف الموردين.',
    requires: ['lessors.read'],
    enforcedIn: 'database',
  },
  {
    key: 'lessors.quick_create',
    group: 'master_data',
    name: 'انشاء مورد سريع',
    description: 'انشاء مورد من نموذج المعدة السريع.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'users.read',
    group: 'users',
    name: 'عرض المستخدمين',
    description:
      'قراءة بيانات المستخدمين. «الكل» لكل المستخدمين، و«الورشة» لمستخدمي الورشة فقط.',
    scopes: ['workshop', 'all'],
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'users.manage',
    group: 'users',
    name: 'ادارة المستخدمين',
    description:
      'اضافة المستخدمين وتعديلهم وحذفهم وجوالاتهم وشركاتهم. للادمن فقط.',
    requires: ['users.read'],
    adminOnly: true,
    enforcedIn: 'database',
  },
  {
    key: 'settings.equipment_types',
    group: 'settings',
    name: 'انواع المعدات',
    description: 'اضافة وتعديل وحذف انواع المعدات.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'settings.integrations',
    group: 'settings',
    name: 'الربط والتنبيهات',
    description: 'ربط افاقي وحالة بوابة الواتساب وسجل كل الابلاغات.',
    requires: [],
    enforcedIn: 'database',
  },
  {
    key: 'settings.roles',
    group: 'settings',
    name: 'الادوار والصلاحيات',
    description:
      'ادارة الادوار وصلاحياتها وتعيينها للمستخدمين وتفعيل النظام. للادمن فقط.',
    requires: ['users.manage'],
    adminOnly: true,
    enforcedIn: 'database',
  },
  {
    key: 'purchasing.view',
    group: 'purchasing',
    name: 'المشتريات: عرض',
    description:
      'محجوزة للمرحلة الثالثة: اوامر الشراء والايجارات. لا تفتح شيئا بعد.',
    requires: [],
    enforcedIn: 'reserved',
  },
  {
    key: 'purchasing.manage',
    group: 'purchasing',
    name: 'المشتريات: ادارة',
    description:
      'محجوزة للمرحلة الثالثة: اوامر الشراء والايجارات. لا تفتح شيئا بعد.',
    requires: ['purchasing.view'],
    enforcedIn: 'reserved',
  },
]

export const PERMISSION_BY_KEY: ReadonlyMap<string, MockPermission> = new Map(
  PERMISSIONS.map((permission) => [permission.key, permission]),
)

/** Granted permission → its chosen scope (`null` for an unscoped key). */
export type MockGrant = Record<string, MockScope | null>

export type MockLegacyRole =
  | 'admin'
  | 'supervisor'
  | 'workshop'
  | 'assistant_workshop_manager'
  | 'workshop_manager'
  | 'monitor'

export const LEGACY_ROLE_LABELS: Record<MockLegacyRole, string> = {
  admin: 'ادمن',
  supervisor: 'فورمين',
  workshop: 'الورشة',
  assistant_workshop_manager: 'مساعد مدير الورشة',
  workshop_manager: 'مدير الورشة',
  monitor: 'متابعة',
}

export type MockRole = {
  key: string
  name: string
  nameEn: string
  description: string
  isSystem: boolean
  isActive: boolean
  grants: MockGrant
}

const grant = (entries: Array<string | [string, MockScope]>): MockGrant =>
  Object.fromEntries(
    entries.map((entry) =>
      typeof entry === 'string' ? [entry, null] : [entry[0], entry[1]],
    ),
  )

/** The admin holds every key at its widest scope. */
export const ADMIN_GRANTS: MockGrant = Object.fromEntries(
  PERMISSIONS.map((permission) => [
    permission.key,
    permission.scopes ? 'all' : null,
  ]),
)

export const ROLES: MockRole[] = [
  {
    key: 'admin',
    name: 'ادمن',
    nameEn: 'Admin',
    description: 'كل الصلاحيات. لا يحذف ولا يعطل ولا تنزع منه صلاحية.',
    isSystem: true,
    isActive: true,
    grants: ADMIN_GRANTS,
  },
  {
    key: 'supervisor',
    name: 'فورمين',
    nameEn: 'Foreman',
    description: 'يسجل حركات المشاريع لزياراته ويرى حركاته.',
    isSystem: true,
    isActive: true,
    grants: grant([
      ['home.foreman', 'own'],
      ['movements.read', 'own'],
      ['movements.site.create', 'own'],
      ['movements.site.driver_change', 'own'],
      'movements.site.contractor_code',
      ['movements.photos.manage', 'own'],
      ['equipment.quick_create', 'site'],
      'drivers.quick_create',
      'lessors.quick_create',
    ]),
  },
  {
    key: 'workshop',
    name: 'مسؤول حركة الورشة',
    nameEn: 'Workshop Movement Officer',
    description: 'يسجل حركات الورشة.',
    isSystem: true,
    isActive: true,
    grants: grant([
      ['home.workshop', 'workshop'],
      ['movements.read', 'all'],
      'movements.workshop.create',
      'movements.notify_foreman',
      ['movements.photos.manage', 'workshop'],
      ['equipment.quick_create', 'workshop'],
      'lessors.quick_create',
    ]),
  },
  {
    key: 'assistant_workshop_manager',
    name: 'مساعد مدير الورشة',
    nameEn: 'Assistant Workshop Manager',
    description: 'يسجل حركات الورشة ويصنفها ويرى كل الحركات.',
    isSystem: true,
    isActive: true,
    grants: grant([
      ['home.workshop', 'all'],
      ['movements.read', 'all'],
      'movements.workshop.create',
      'movements.workshop.classify',
      'movements.notify_foreman',
      ['movements.photos.manage', 'workshop'],
      'movements.export',
      ['equipment.quick_create', 'workshop'],
      'lessors.quick_create',
      ['users.read', 'workshop'],
    ]),
  },
  {
    key: 'workshop_manager',
    name: 'مدير الورشة',
    nameEn: 'Workshop Manager',
    description: 'يسجل حركات الورشة ويصنفها ويرى كل الحركات.',
    isSystem: true,
    isActive: true,
    grants: grant([
      ['home.workshop', 'all'],
      ['movements.read', 'all'],
      'movements.workshop.create',
      'movements.workshop.classify',
      'movements.notify_foreman',
      ['movements.photos.manage', 'workshop'],
      'movements.export',
      ['equipment.quick_create', 'workshop'],
      'lessors.quick_create',
      ['users.read', 'workshop'],
    ]),
  },
  {
    key: 'monitor',
    name: 'متابعة',
    nameEn: 'Monitoring',
    description: 'قراءة فقط: لوحة الادمن والسجلات والاستعلام.',
    isSystem: true,
    isActive: true,
    grants: grant([
      'home.admin',
      ['movements.read', 'all'],
      'movements.export',
      'inquiry.view',
    ]),
  },
  {
    key: 'foreman_lead',
    name: 'رئيس الفورمين',
    nameEn: 'Foreman Lead',
    description:
      'يسجل حركات المشاريع لاي شركة ويرى كل حركات المشاريع. لم يعين لاحد.',
    isSystem: false,
    isActive: true,
    grants: grant([
      ['home.foreman', 'all'],
      ['movements.read', 'site'],
      ['movements.site.create', 'all'],
      ['movements.site.driver_change', 'all'],
      'movements.site.contractor_code',
      'movements.exit_cross_context',
      ['movements.photos.manage', 'site'],
      'movements.export',
      ['equipment.quick_create', 'site'],
      'drivers.quick_create',
      'lessors.quick_create',
    ]),
  },
  {
    key: 'equipment_officer',
    name: 'مسؤول المعدات',
    nameEn: 'Equipment Officer',
    description:
      'يدير المعدات والسائقين والموردين وانواع المعدات ويقرا لوحة الادمن، ولا يسجل حركات.',
    isSystem: false,
    isActive: true,
    grants: grant([
      'home.admin',
      ['movements.read', 'all'],
      'inquiry.view',
      'equipment.read',
      'equipment.create',
      'equipment.edit',
      'equipment.change_code',
      'equipment.import',
      'equipment.tracker_link',
      'equipment.location.view',
      'drivers.read',
      'drivers.create',
      'drivers.edit',
      'drivers.import',
      'lessors.read',
      'lessors.edit',
      'settings.equipment_types',
    ]),
  },
  {
    key: 'purchasing',
    name: 'مشتريات',
    nameEn: 'Purchasing',
    description:
      'قراءة الحركات والتقارير والبيانات، وادارة الموردين. محجوز للمرحلة الثالثة.',
    isSystem: false,
    isActive: false,
    grants: grant([
      ['movements.read', 'all'],
      ['reports.view', 'all'],
      'equipment.read',
      'lessors.read',
      'lessors.edit',
      'purchasing.view',
    ]),
  },
]

export type MockUser = {
  id: string
  name: string
  legacyRole: MockLegacyRole
  /** Assigned roles-system role, or `null` when nothing is assigned yet. */
  roleKey: string | null
  /** dd/mm/yyyy of the assignment. */
  since: string
}

export const USERS: MockUser[] = [
  {
    id: 'u1',
    name: 'خالد العتيبي',
    legacyRole: 'admin',
    roleKey: 'admin',
    since: '11/10/2026',
  },
  {
    id: 'u2',
    name: 'مبارك بكرمان',
    legacyRole: 'admin',
    roleKey: 'admin',
    since: '11/10/2026',
  },
  {
    id: 'u3',
    name: 'سعد العمري',
    legacyRole: 'supervisor',
    roleKey: 'supervisor',
    since: '11/10/2026',
  },
  {
    id: 'u4',
    name: 'فهد القحطاني',
    legacyRole: 'supervisor',
    roleKey: 'supervisor',
    since: '11/10/2026',
  },
  {
    id: 'u5',
    name: 'ناصر الشهري',
    legacyRole: 'supervisor',
    roleKey: 'supervisor',
    since: '12/10/2026',
  },
  {
    id: 'u6',
    name: 'ماجد الدوسري',
    legacyRole: 'supervisor',
    roleKey: 'supervisor',
    since: '12/10/2026',
  },
  {
    id: 'u7',
    name: 'راشد علي',
    legacyRole: 'workshop',
    roleKey: 'workshop',
    since: '11/10/2026',
  },
  {
    id: 'u8',
    name: 'يوسف الحربي',
    legacyRole: 'workshop',
    roleKey: 'workshop',
    since: '13/10/2026',
  },
  {
    id: 'u9',
    name: 'عبدالله الزهراني',
    legacyRole: 'assistant_workshop_manager',
    roleKey: 'assistant_workshop_manager',
    since: '11/10/2026',
  },
  {
    id: 'u10',
    name: 'سلطان المطيري',
    legacyRole: 'workshop_manager',
    roleKey: 'workshop_manager',
    since: '11/10/2026',
  },
  {
    id: 'u11',
    name: 'احمد الغامدي',
    legacyRole: 'monitor',
    roleKey: 'monitor',
    since: '11/10/2026',
  },
  {
    id: 'u12',
    name: 'عمر السبيعي',
    legacyRole: 'monitor',
    roleKey: null,
    since: '',
  },
  {
    id: 'u13',
    name: 'بندر العنزي',
    legacyRole: 'supervisor',
    roleKey: null,
    since: '',
  },
]

export type MockChange = {
  id: string
  roleKey: string
  who: string
  when: string
  what: string
}

export const CHANGES: MockChange[] = [
  {
    id: 'c1',
    roleKey: 'supervisor',
    who: 'خالد العتيبي',
    when: '14/10/2026 09:12',
    what: 'اضاف «تغيير السائق خلال الزيارة» بنطاق حركاته',
  },
  {
    id: 'c2',
    roleKey: 'supervisor',
    who: 'خالد العتيبي',
    when: '13/10/2026 16:40',
    what: 'غير نطاق «عرض الحركات» من شركاته الى حركاته',
  },
  {
    id: 'c3',
    roleKey: 'supervisor',
    who: 'مبارك بكرمان',
    when: '12/10/2026 11:05',
    what: 'اسند الدور الى ناصر الشهري',
  },
  {
    id: 'c4',
    roleKey: 'supervisor',
    who: 'مبارك بكرمان',
    when: '12/10/2026 11:03',
    what: 'اسند الدور الى ماجد الدوسري',
  },
  {
    id: 'c5',
    roleKey: 'supervisor',
    who: 'خالد العتيبي',
    when: '11/10/2026 14:20',
    what: 'انشا الدور من ترحيل الادوار القديمة',
  },
  {
    id: 'c6',
    roleKey: 'workshop',
    who: 'خالد العتيبي',
    when: '13/10/2026 10:30',
    what: 'اسند الدور الى يوسف الحربي',
  },
  {
    id: 'c7',
    roleKey: 'workshop',
    who: 'خالد العتيبي',
    when: '11/10/2026 14:20',
    what: 'انشا الدور من ترحيل الادوار القديمة',
  },
  {
    id: 'c8',
    roleKey: 'workshop_manager',
    who: 'خالد العتيبي',
    when: '12/10/2026 09:00',
    what: 'اضاف «تصدير الحركات»',
  },
  {
    id: 'c9',
    roleKey: 'workshop_manager',
    who: 'خالد العتيبي',
    when: '11/10/2026 14:20',
    what: 'انشا الدور من ترحيل الادوار القديمة',
  },
  {
    id: 'c10',
    roleKey: 'assistant_workshop_manager',
    who: 'خالد العتيبي',
    when: '12/10/2026 09:01',
    what: 'اضاف «تصدير الحركات»',
  },
  {
    id: 'c11',
    roleKey: 'assistant_workshop_manager',
    who: 'خالد العتيبي',
    when: '11/10/2026 14:20',
    what: 'انشا الدور من ترحيل الادوار القديمة',
  },
  {
    id: 'c12',
    roleKey: 'monitor',
    who: 'خالد العتيبي',
    when: '11/10/2026 14:20',
    what: 'انشا الدور من ترحيل الادوار القديمة',
  },
  {
    id: 'c13',
    roleKey: 'admin',
    who: 'خالد العتيبي',
    when: '11/10/2026 14:20',
    what: 'انشا الدور من ترحيل الادوار القديمة',
  },
  {
    id: 'c14',
    roleKey: 'foreman_lead',
    who: 'مبارك بكرمان',
    when: '13/10/2026 15:10',
    what: 'اضاف «خروج يغلق اي زيارة»',
  },
  {
    id: 'c15',
    roleKey: 'foreman_lead',
    who: 'مبارك بكرمان',
    when: '13/10/2026 15:02',
    what: 'انشا الدور بنسخ صلاحيات «فورمين»',
  },
  {
    id: 'c16',
    roleKey: 'equipment_officer',
    who: 'مبارك بكرمان',
    when: '13/10/2026 15:30',
    what: 'انشا الدور',
  },
  {
    id: 'c17',
    roleKey: 'purchasing',
    who: 'خالد العتيبي',
    when: '14/10/2026 08:00',
    what: 'عطل الدور حتى المرحلة الثالثة',
  },
  {
    id: 'c18',
    roleKey: 'purchasing',
    who: 'مبارك بكرمان',
    when: '13/10/2026 15:45',
    what: 'انشا الدور',
  },
]
