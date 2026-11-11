import type {
  DataListConfig,
  FilterOperator,
  FilterOption,
} from '@/components/data-list/types'
import {
  ACTIVITY_FIELD_FILTER_KEY,
  ACTIVITY_KIND_FILTER_KEY,
  activityFieldFilterOptions,
} from '@/lib/activityFields'
import { EMPTY_FILTER_VALUE } from '@/lib/applyListFilters'
import {
  DRIVER_EMPLOYMENT_TYPES,
  DRIVER_NATIONALITIES,
  EXTERNAL_SUPPLIER_EMPLOYMENT_TYPE,
} from '@/lib/driverExcel'
import { EXIT_PURPOSE_FILTER_FIELD } from '@/lib/exitPurpose'
import { SUPPLIER_FILTER_FIELD } from '@/lib/equipmentSupplier'
import {
  SITE_UNITS_RECENT_DEFAULT_FILTER,
  SITE_UNITS_RECENT_FILTER_KEY,
  SITE_VISITS_SINCE_DAY,
} from '@/lib/siteVisits'
import {
  MOVEMENT_COMPANY_PROJECT_SEARCH_FIELDS,
  MOVEMENT_SEARCH_FIELDS,
} from '@/lib/movementLogSearch'
import {
  CARD_MONTHS_DEFAULT_FILTER,
  CARD_MONTHS_MONTH_FILTER_KEY,
} from '@/lib/cardMonthsList'
import {
  COMPANY_PROJECT_SEARCH_FIELDS,
  COMPANY_SEARCH_FIELDS,
  DRIVER_SEARCH_FIELDS,
  EQUIPMENT_SEARCH_FIELDS,
  LESSOR_SEARCH_FIELDS,
} from '@/lib/search'

/**
 * Every label below is a `ListLabel`: a key of the shared translation table,
 * or an inline `{ ar, en }` pair for wording that belongs to this one list.
 * They used to be plain Arabic strings, so the sort menu and the filter
 * builder stayed Arabic in the English UI. The Arabic text is unchanged.
 */

const textOps: FilterOperator[] = [
  'eq',
  'neq',
  'in',
  'not_in',
  'like',
  'not_like',
  'is_set',
  'is_not_set',
]
const dateOps: FilterOperator[] = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'between',
  'is_set',
  'is_not_set',
]
/** Master-data values that are their own label (nationalities, and so on). */
const select = (values: readonly string[]): FilterOption[] =>
  values.map((value) => ({ value, label: value }))

export const driversListConfig: DataListConfig = {
  id: 'drivers',
  searchPlaceholder: {
    ar: 'البحث بالاسم او الهوية او الجوال او الرقم الوظيفي',
    en: 'Search by name, ID, mobile or employee number',
  },
  // EM-237: the list also searches «الرقم الوظيفي» (`drivers.employee_number`,
  // migration 0131, trigram-indexed); the driver selectors keep the shared set.
  searchFields: [...DRIVER_SEARCH_FIELDS, 'employee_number'],
  defaultSort: 'updated_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'nationality',
      label: 'nationality',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in', 'is_set', 'is_not_set'],
      options: select(DRIVER_NATIONALITIES),
    },
    {
      key: 'employment_type',
      label: 'employmentType',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in', 'is_set', 'is_not_set'],
      // wave-13-drivers: a multi-select (owner decision 2026-10-05) whose
      // last option stands for the drivers with no employment type yet, so
      // the default below can tick everything except the external supplier.
      multiple: true,
      options: [
        ...select(DRIVER_EMPLOYMENT_TYPES),
        {
          value: EMPTY_FILTER_VALUE,
          label: 'بدون نوع توظيف',
          labelI18n: { ar: 'بدون نوع توظيف', en: 'No employment type' },
        },
      ],
    },
    {
      key: 'job_title',
      label: 'jobTitle',
      type: 'text',
      operators: textOps,
    },
    {
      key: 'employee_number',
      label: 'driverEmployeeNumber',
      type: 'text',
      operators: textOps,
    },
  ],
  // wave-13-drivers (owner decision 2026-10-05): the drivers of external
  // supplier equipment are hidden on a fresh visit. It is an ordinary filter:
  // counted on the Filters button, shown and removable in the filter dialog.
  defaultFilters: [
    {
      id: 'default-employment-type',
      field: 'employment_type',
      operator: 'in',
      value: [
        ...DRIVER_EMPLOYMENT_TYPES.filter(
          (type) => type !== EXTERNAL_SUPPLIER_EMPLOYMENT_TYPE,
        ),
        EMPTY_FILTER_VALUE,
      ].join(','),
    },
  ],
  sortableFields: [
    { key: 'full_name', label: { ar: 'الاسم', en: 'Name' } },
    { key: 'name_en', label: 'driverNameEn' },
    { key: 'employee_number', label: 'driverEmployeeNumber' },
    { key: 'created_at', label: 'createdAt' },
    {
      key: 'updated_at',
      label: { ar: 'تاريخ التعديل', en: 'Last updated' },
    },
  ],
}
export const equipmentListConfig: DataListConfig = {
  id: 'equipment',
  searchPlaceholder: {
    ar: 'البحث بالكود او اللوحة او الشاصي او النوع',
    en: 'Search by code, plate, chassis or type',
  },
  searchFields: [...EQUIPMENT_SEARCH_FIELDS],
  defaultSort: 'updated_at',
  defaultDirection: 'desc',
  filterFields: [
    // wave 20 (migration 0125): the one equipment state, derived from the
    // latest movement and served by the `equipment_state` computed field, so
    // PostgREST filters it server-side like a column. It replaces the retired
    // manual operational status.
    {
      key: 'equipment_state',
      label: 'equipmentState',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [
        {
          value: 'working',
          label: 'تعمل',
          labelI18n: 'equipmentStateWorking',
        },
        {
          value: 'available',
          label: 'متاحة',
          labelI18n: 'equipmentStateAvailable',
        },
        {
          value: 'maintenance',
          label: 'صيانة',
          labelI18n: 'equipmentStateMaintenance',
        },
        {
          value: 'parking',
          label: 'وقوف',
          labelI18n: 'equipmentStateParking',
        },
        {
          value: 'out_of_service',
          label: 'خارج الخدمة',
          labelI18n: 'equipmentStateOutOfService',
        },
        {
          value: 'unclassified',
          label: 'غير مصنفة',
          labelI18n: 'equipmentStateUnclassified',
        },
      ],
    },
    // EM-236 (migration 0129): «جديدة» = the row was created within the last
    // 7 days, served by the `equipment_is_new` computed field, which PostgREST
    // filters server-side like a boolean column (`equipment_is_new=eq.true`).
    // A yes / no select over `eq`; "All" removes the filter.
    {
      key: 'equipment_is_new',
      label: 'equipmentStateNew',
      type: 'boolean',
      operators: ['eq'],
      options: [
        { value: 'true', label: 'نعم', labelI18n: 'yes' },
        { value: 'false', label: 'لا', labelI18n: 'no' },
      ],
    },
    // EM-235 (owner decision 2026-10-14): a multi-select, like the drivers'
    // employment type: the dialog renders `MultiSelect`, emits `in` with the
    // ticked owners joined by commas, persists in the URL and has no default.
    {
      key: 'ownership_status',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      multiple: true,
      options: [
        {
          value: 'alazani',
          label: 'شركة عبدالله العزاني للمقاولات',
          labelI18n: 'ownershipAlazani',
        },
        {
          value: 'takween',
          label: 'شركة تكوين المعدات للمقاولات',
          labelI18n: 'ownershipTakween',
        },
        {
          value: 'third_party_f',
          label: 'مملوكة للغير F',
          labelI18n: 'ownershipThirdPartyF',
        },
        {
          value: 'third_party_partnership_b',
          label: 'مملوكة للغير شراكة B',
          labelI18n: 'ownershipThirdPartyPartnershipB',
        },
        {
          value: 'external_supplier',
          label: 'مالك آخر',
          labelI18n: 'ownershipExternalSupplier',
        },
      ],
    },
    // Replaces the `is_active` boolean filter: the asset status is the field
    // admins now read and set, and the allowlist is the same closed set as the
    // database CHECK constraint (active / sold since migration 0125).
    {
      key: 'status',
      label: 'equipmentStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [
        {
          value: 'active',
          label: 'نشطة',
          labelI18n: 'equipmentStatusActive',
        },
        {
          value: 'sold',
          label: 'مباعة',
          labelI18n: 'equipmentStatusSold',
        },
        // 0163: a supplier unit whose rental ended.
        {
          value: 'rental_ended',
          label: 'منتهية',
          labelI18n: 'equipmentStatusRentalEnded',
        },
      ],
    },
  ],
  sortableFields: [
    { key: 'code', label: 'equipmentCode' },
    { key: 'type', label: 'equipmentType' },
    { key: 'plate_number', label: 'plateNumber' },
    { key: 'equipment_state', label: 'equipmentState' },
    { key: 'status', label: 'equipmentStatus' },
    { key: 'ownership_status', label: 'ownershipStatus' },
    { key: 'created_at', label: 'createdAt' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}
export const companiesListConfig: DataListConfig = {
  id: 'companies',
  // EM-260 (migration 0175): the tax number and the CR are searched too; the
  // tables stay narrow (owner), so neither is a column.
  searchPlaceholder: {
    ar: 'البحث باسم الشركة او الرقم الضريبي او الرقم الوطني الموحد',
    en: 'Search by company name, tax number or unified national number',
  },
  searchFields: [...COMPANY_SEARCH_FIELDS],
  defaultSort: 'updated_at',
  defaultDirection: 'desc',
  // No filter fields (owner review, 2026-09-29): the search box already
  // matches both names, so the toolbar hides its "Filters" button here.
  filterFields: [],
  sortableFields: [
    { key: 'name_ar', label: { ar: 'الاسم العربي', en: 'Arabic name' } },
    { key: 'name_en', label: { ar: 'الاسم الإنجليزي', en: 'English name' } },
    { key: 'created_at', label: 'createdAt' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}
export const projectsListConfig: DataListConfig = {
  ...companiesListConfig,
  id: 'projects',
  searchPlaceholder: {
    ar: 'البحث باسم المشروع',
    en: 'Search by project name',
  },
  // `projects` has no 0175 columns: the two names only.
  searchFields: [...COMPANY_PROJECT_SEARCH_FIELDS],
}
export const lessorsListConfig: DataListConfig = {
  id: 'lessors',
  // EM-260 (migration 0175): the tax number and the CR are searched too, as
  // on the companies list; no new column.
  searchPlaceholder: {
    ar: 'البحث بالاسم او جهة الاتصال او الجوال او الرقم الضريبي او الرقم الوطني الموحد',
    en: 'Search by name, contact person, mobile, tax number or unified national number',
  },
  searchFields: [...LESSOR_SEARCH_FIELDS],
  defaultSort: 'updated_at',
  defaultDirection: 'desc',
  // No filter fields (owner review, 2026-09-29): the search box already
  // matches the name, contact person and number.
  filterFields: [],
  sortableFields: [
    { key: 'name', label: { ar: 'الاسم', en: 'Name' } },
    { key: 'created_at', label: 'createdAt' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}
/**
 * The movement search of `/logs` and the foreman home log
 * (`buildMovementSearchFilter(…, { includeCompanyProject: true })`): the
 * equipment, the driver, the company number (`contractor_equipment_code`) and
 * the company and project names. The placeholder names every one of them
 * (EM-116); `tests/search-normalisation.test.cjs` keeps the two in step.
 */
const movementSearchPlaceholder = {
  ar: 'البحث بالمعدة (كود او نوع او لوحة او شاصي) او السائق او ترقيم الشركة او الشركة او المشروع',
  en: 'Search by equipment (code, type, plate or chassis), driver, company number, company or project',
}
const movementSearchFields = [
  ...MOVEMENT_SEARCH_FIELDS,
  ...MOVEMENT_COMPANY_PROJECT_SEARCH_FIELDS,
]
export const movementsListConfig: DataListConfig = {
  id: 'movements',
  searchPlaceholder: movementSearchPlaceholder,
  searchFields: movementSearchFields,
  defaultSort: 'created_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'movement_type',
      label: 'movementType',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [
        { value: 'entry', label: 'دخول', labelI18n: 'entry' },
        { value: 'exit', label: 'خروج', labelI18n: 'exit' },
      ],
    },
    {
      key: 'supervisor_id',
      label: 'supervisorName',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [],
    },
    {
      key: 'driver_name',
      label: { ar: 'السائق', en: 'Driver' },
      type: 'text',
      operators: textOps,
    },
    {
      key: 'recorded_at',
      label: { ar: 'وقت الحركة', en: 'Movement time' },
      type: 'date',
      operators: dateOps,
    },
  ],
  sortableFields: [
    { key: 'created_at', label: { ar: 'وقت الإنشاء', en: 'Created' } },
    { key: 'recorded_at', label: { ar: 'وقت الحركة', en: 'Movement time' } },
    { key: 'movement_type', label: 'movementType' },
  ],
}

/**
 * The foreman home's log tab (owner request 2026-09-30). Search, sort and
 * paging are the movements list's; the filter dialog holds company and project
 * only, as multi-selects by id (`in` over the view's `company_id` /
 * `project_id`), the same pattern as `/logs`. The home scopes their options to
 * the foreman's own movements. Movement type and date stay the two inline
 * controls they already were and are not part of this allowlist.
 */
export const homeMovementsListConfig: DataListConfig = {
  ...movementsListConfig,
  id: 'homeMovements',
  filterFields: [
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
  ],
}
export const usersListConfig: DataListConfig = {
  id: 'users',
  searchPlaceholder: {
    ar: 'البحث باسم المستخدم',
    en: 'Search by user name',
  },
  searchFields: ['full_name'],
  defaultSort: 'created_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'role',
      label: 'role',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [
        { value: 'admin', label: 'أدمن', labelI18n: 'admin' },
        { value: 'supervisor', label: 'فورمين', labelI18n: 'supervisor' },
        {
          value: 'workshop',
          label: 'مسؤول حركة الورشة',
          labelI18n: 'workshopOfficer',
        },
        {
          value: 'assistant_workshop_manager',
          label: 'مساعد مدير الورشة',
          labelI18n: 'assistantWorkshopManager',
        },
        {
          value: 'workshop_manager',
          label: 'مدير الورشة',
          labelI18n: 'workshopManager',
        },
        { value: 'monitor', label: 'متابعة', labelI18n: 'monitoring' },
      ],
    },
  ],
  // No `role` sort: the role is the `profile_roles` assignment, an embed the
  // users cannot be ordered by (roles stage 4c-2 dropped profiles.role).
  sortableFields: [
    { key: 'full_name', label: { ar: 'الاسم', en: 'Name' } },
    { key: 'created_at', label: 'createdAt' },
  ],
}
/**
 * Not wired to any screen: the visits tables use `visitsListConfig` and its
 * `VISIT_SEARCH_FIELDS` from `@/lib/visitsList` (migration 0096 columns).
 * Kept as it is; its keys predate `movement_visits` and are not a search.
 */
export const visitsListConfig: DataListConfig = {
  id: 'visits',
  searchPlaceholder: movementSearchPlaceholder,
  searchFields: [
    'equipment_code',
    'equipment_type',
    'driver_name',
    'contractor_equipment_code',
  ],
  defaultSort: 'entry_recorded_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'driver_name',
      label: { ar: 'السائق', en: 'Driver' },
      type: 'text',
      operators: textOps,
    },
    {
      key: 'entry_recorded_at',
      label: { ar: 'وقت الدخول', en: 'Entry time' },
      type: 'date',
      operators: dateOps,
    },
    {
      key: 'exit_recorded_at',
      label: { ar: 'وقت الخروج', en: 'Exit time' },
      type: 'date',
      operators: dateOps,
    },
  ],
  sortableFields: [
    {
      key: 'entry_recorded_at',
      label: { ar: 'وقت الدخول', en: 'Entry time' },
    },
    { key: 'exit_recorded_at', label: { ar: 'وقت الخروج', en: 'Exit time' } },
    { key: 'equipment_code', label: 'equipmentCode' },
  ],
}

/**
 * Full movement log (`/logs`), served by the `movement_log_search` view.
 *
 * Search is the shared movement search (`buildMovementSearchFilter` with the
 * company and project names), so the search box covers the equipment, the
 * driver snapshot, the contractor code and the company and project names;
 * `searchFields` is that exact column list. The foreman is deliberately a
 * filter and not a search field: searching it made an equipment code that
 * happens to appear in a name match rows the user did not ask for.
 *
 * Every filter key below is a real column of the view and is allowlisted
 * against this list before it reaches PostgREST, so no arbitrary column can be
 * filtered. `supervisor_id`, `company_id` and `project_id` have no static
 * options: `/logs` renders them in the toolbar's filter dialog as relational
 * searches (`asyncFields`, first 20 matches, server-side search), so no list
 * is preloaded. `recorded_at` is one range control (`DateRangeFilter`) that
 * emits `between` / `gte` / `lte` over Saudi-day boundaries.
 */
export const logsListConfig: DataListConfig = {
  id: 'logs',
  searchPlaceholder: movementSearchPlaceholder,
  searchFields: movementSearchFields,
  defaultSort: 'recorded_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'movement_type',
      label: 'movementType',
      type: 'select',
      operators: ['eq', 'neq'],
      options: [
        { value: 'entry', label: 'دخول', labelI18n: 'entry' },
        { value: 'exit', label: 'خروج', labelI18n: 'exit' },
      ],
    },
    {
      key: 'recorded_at',
      label: { ar: 'وقت الحركة', en: 'Movement time' },
      type: 'date',
      operators: dateOps,
    },
    {
      key: 'equipment_ownership_status',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [
        {
          value: 'alazani',
          label: 'العزاني',
          labelI18n: 'adminHomeOwnerAlazani',
        },
        {
          value: 'takween',
          label: 'تكوين',
          labelI18n: 'adminHomeOwnerTakween',
        },
        {
          value: 'third_party_f',
          label: 'طرف ثالث F',
          labelI18n: 'adminHomeOwnerThirdPartyF',
        },
        {
          value: 'third_party_partnership_b',
          label: 'طرف ثالث B',
          labelI18n: 'adminHomeOwnerThirdPartyB',
        },
        {
          value: 'external_supplier',
          label: 'مالك اخر',
          labelI18n: 'adminHomeOwnerExternal',
        },
      ],
    },
    // Owner request 2026-10-15: the supplier, offered only while the owner
    // filter selects «مالك اخر» (migration 0132).
    SUPPLIER_FILTER_FIELD,
    // Multi-select by id (owner review, 2026-09-29) instead of a name text
    // box. The options come from `useCompanyProjectFilters()` passed as
    // `asyncFields` (server-side search over `companies` / `projects`, 20
    // results), and the filter is `in` over the view's id columns.
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'supervisor_id',
      label: 'logsColForeman',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [],
    },
    {
      key: 'workshop_purpose',
      label: { ar: 'غرض الورشة', en: 'Workshop purpose' },
      type: 'select',
      operators: ['eq', 'neq', 'is_set', 'is_not_set'],
      options: [
        {
          value: 'maintenance',
          label: 'صيانة',
          labelI18n: 'maintenancePurpose',
        },
        { value: 'parking', label: 'وقوف', labelI18n: 'parkingPurpose' },
        {
          value: 'out_of_service',
          label: 'خارج الخدمة',
          labelI18n: 'workshopPurposeOutOfService',
        },
      ],
    },
    // The site exit purpose (`exit_purpose`, migration 0118): only site exits
    // recorded since 0111 carry it.
    EXIT_PURPOSE_FILTER_FIELD,
  ],
  sortableFields: [
    { key: 'recorded_at', label: { ar: 'وقت الحركة', en: 'Movement time' } },
    { key: 'created_at', label: { ar: 'وقت الانشاء', en: 'Created' } },
    { key: 'movement_type', label: 'movementType' },
    { key: 'equipment_code', label: 'equipmentCode' },
  ],
}

/**
 * «سجل النشاط» (/activity, owner 2026-11-02, approved on /ui-kit «نموذج صفحة
 * النشاط الجديدة»): one list over the movement log and the equipment change
 * log through the view `activity_log` (migration 0170). Searched by the unit
 * code and the actor's name; the kind («الحركات» / «المعدات», the segmented
 * switch of the toolbar) is a filter like the others, the movement context
 * is offered only for movements and the «الحقل» filter (`changed_fields`
 * overlaps the ticked keys, applied by the screen) only for equipment
 * changes; the date filter carries the month presets; newest first.
 */
export const activityListConfig: DataListConfig = {
  id: 'activity',
  searchPlaceholder: 'searchActivity',
  searchFields: ['equipment_code', 'actor_name'],
  defaultSort: 'created_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: ACTIVITY_KIND_FILTER_KEY,
      label: 'activityKindFilter',
      type: 'select',
      operators: ['eq'],
      options: [
        {
          value: 'movement',
          label: 'الحركات',
          labelI18n: 'activityKindMovements',
        },
        {
          value: 'equipment',
          label: 'المعدات',
          labelI18n: 'activityKindEquipments',
        },
      ],
    },
    {
      key: 'action',
      label: 'action',
      type: 'select',
      operators: ['eq', 'neq'],
      options: [
        { value: 'create', label: 'اضافة', labelI18n: 'activityCreated' },
        { value: 'update', label: 'تعديل', labelI18n: 'activityUpdated' },
        { value: 'delete', label: 'حذف', labelI18n: 'activityDeleted' },
      ],
    },
    // The options come from `activityActorFilterOptions` passed as
    // `asyncFields` (server-side search over `profile_names`, 20 results,
    // plus «النظام» for rows with no actor).
    {
      key: 'actor_id',
      label: 'user',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'movement_context',
      label: 'location',
      type: 'select',
      operators: ['eq'],
      options: [
        { value: 'site', label: 'المشاريع', labelI18n: 'logsSites' },
        { value: 'workshop', label: 'الورشة', labelI18n: 'workshopLocation' },
      ],
      visibleWhen: { field: ACTIVITY_KIND_FILTER_KEY, includes: 'movement' },
    },
    {
      key: ACTIVITY_FIELD_FILTER_KEY,
      label: 'activityFieldFilter',
      type: 'select',
      operators: ['in'],
      options: activityFieldFilterOptions(),
      multiple: true,
      visibleWhen: { field: ACTIVITY_KIND_FILTER_KEY, includes: 'equipment' },
    },
    {
      key: 'created_at',
      label: 'activityColTime',
      type: 'date',
      operators: dateOps,
    },
  ],
  sortableFields: [
    { key: 'created_at', label: 'activityColTime' },
    { key: 'equipment_code', label: 'equipmentCode' },
  ],
}

/**
 * «حسب المعدات» of the PO list (owner 2026-10-31, migration 0167): one row
 * per unit on a supplier PO, over `purchasing_po_units`, with its PO number.
 * Server-side search, filters, sort and paging like every list. Until
 * migration 0189 it opened on the OPEN POs (a default filter); a supplier PO
 * has no open / closed state any more (owner 2026-11-11). Placed before the
 * orders config: the purchasing tests slice the configs that follow it.
 */
export const poUnitsListConfig: DataListConfig = {
  id: 'poUnits',
  searchPlaceholder: {
    ar: 'البحث برقم المعدة او النوع او اللوحة او الشاصي او رقم PO',
    en: 'Search by unit, type, plate, chassis or PO number',
  },
  searchFields: [
    'equipment_code',
    'equipment_type_search',
    'equipment_plate_number',
    'equipment_chassis_number',
    'equipment_plate_digits',
    'po_number',
  ],
  // Owner 2026-11-11 («خلي السورت الافتراضي لاوامر الشراء اخر تعديل»): the
  // latest change first (`updated_at`, moved by the PO row and its lines).
  defaultSort: 'updated_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'approval_status',
      label: 'supplierPoApproval',
      type: 'select',
      operators: ['eq', 'neq'],
      options: [
        {
          value: 'draft',
          label: 'مسودة',
          labelI18n: 'supplierPoApprovalDraft',
        },
        {
          value: 'approved',
          label: 'معتمد',
          labelI18n: 'supplierPoApprovalApproved',
        },
      ],
    },
    // The PO's party as an owner class (the view inlines 0140's
    // party_class), then the supplier while it selects «مالك اخر»; the two
    // are OR-ed like the orders list (supplierPoPartyOrFilter).
    {
      key: 'party_class',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      multiple: true,
      options: [
        {
          value: 'alazani',
          label: 'العزاني',
          labelI18n: 'adminHomeOwnerAlazani',
        },
        {
          value: 'takween',
          label: 'تكوين',
          labelI18n: 'adminHomeOwnerTakween',
        },
        {
          value: 'third_party_f',
          label: 'طرف ثالث F',
          labelI18n: 'adminHomeOwnerThirdPartyF',
        },
        {
          value: 'third_party_partnership_b',
          label: 'طرف ثالث B',
          labelI18n: 'adminHomeOwnerThirdPartyB',
        },
        {
          value: 'external_supplier',
          label: 'مالك اخر',
          labelI18n: 'adminHomeOwnerExternal',
        },
      ],
    },
    {
      key: 'lessor_id',
      label: 'supplierPoSupplier',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
      visibleWhen: { field: 'party_class', includes: 'external_supplier' },
    },
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'is_priced',
      label: 'poUnitsPricedFilter',
      type: 'select',
      operators: ['eq'],
      options: [
        { value: 'true', label: 'مسعرة', labelI18n: 'poUnitsPriced' },
        { value: 'false', label: 'بدون سعر', labelI18n: 'poUnitsUnpriced' },
      ],
    },
  ],
  sortableFields: [
    { key: 'equipment_code', label: 'equipmentCode' },
    { key: 'po_number', label: 'siteUnitsPoNumber' },
    { key: 'start_date', label: 'supplierPoStartDate' },
    { key: 'price', label: 'supplierPoPrice' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}

/**
 * purchasing-screens (migration 0136): the supplier purchase orders list
 * («قائمة اوامر الشراء»), over `supplier_pos`. Search is the PO number only;
 * the allowlisted filters are the approval, the supplier (`lessor_id`, an
 * `in` multi-select searched server-side through `asyncFields`), and the
 * company and project (the same pattern as `/logs`). Rendered as a MOCKUP on
 * /ui-kit first (owner decision 2026-10-19); the real `/purchasing` list
 * will reuse this config as it is.
 */
export const supplierPosListConfig: DataListConfig = {
  id: 'supplierPos',
  searchPlaceholder: 'supplierPoSearchPlaceholder',
  searchFields: ['po_number'],
  // Owner 2026-11-11 («خلي السورت الافتراضي لاوامر الشراء اخر تعديل»): the
  // latest change first (`updated_at`, moved by the PO row and its lines).
  defaultSort: 'updated_at',
  defaultDirection: 'desc',
  filterFields: [
    // 0160 (owner 2026-10-28, EM-107): draft or approved. 0189: the open /
    // closed filter that came first is gone with the state itself.
    {
      key: 'approval_status',
      label: 'supplierPoApproval',
      type: 'select',
      operators: ['eq', 'neq'],
      options: [
        {
          value: 'draft',
          label: 'مسودة',
          labelI18n: 'supplierPoApprovalDraft',
        },
        {
          value: 'approved',
          label: 'معتمد',
          labelI18n: 'supplierPoApprovalApproved',
        },
      ],
    },
    // Owner 2026-10-20: «المالك ثم المورد», like the movement log. The owner
    // is the computed column party_class(supplier_pos) (migration 0140: the
    // PO's owner class, or external_supplier for a lessor party)...
    {
      key: 'party_class',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      // Multi-select like the equipment list's owner filter (owner 2026-10-21).
      multiple: true,
      options: [
        {
          value: 'alazani',
          label: 'العزاني',
          labelI18n: 'adminHomeOwnerAlazani',
        },
        {
          value: 'takween',
          label: 'تكوين',
          labelI18n: 'adminHomeOwnerTakween',
        },
        {
          value: 'third_party_f',
          label: 'طرف ثالث F',
          labelI18n: 'adminHomeOwnerThirdPartyF',
        },
        {
          value: 'third_party_partnership_b',
          label: 'طرف ثالث B',
          labelI18n: 'adminHomeOwnerThirdPartyB',
        },
        {
          value: 'external_supplier',
          label: 'مالك اخر',
          labelI18n: 'adminHomeOwnerExternal',
        },
      ],
    },
    // ...and the supplier, offered only while the owner filter selects
    // «مالك اخر» (the same rule as SUPPLIER_FILTER_FIELD of the log).
    {
      key: 'lessor_id',
      label: 'supplierPoSupplier',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
      visibleWhen: { field: 'party_class', includes: 'external_supplier' },
    },
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    // 0138: the computed column unpriced_count(supplier_pos); «تحتاج اسعار»
    // = at least one line without a price.
    // Owner 2026-10-21: a yes / no choice.
    {
      key: 'unpriced_count',
      label: 'supplierPoNeedsPrices',
      type: 'select',
      operators: ['gt', 'eq'],
      options: [],
      choices: [
        { key: 'needs_prices', operator: 'gt', value: '0', label: 'yes' },
        { key: 'all_priced', operator: 'eq', value: '0', label: 'no' },
      ],
    },
  ],
  sortableFields: [
    { key: 'created_at', label: 'supplierPoCreatedAt' },
    { key: 'po_number', label: 'supplierPoNumber' },
    { key: 'start_date', label: 'supplierPoStartDate' },
    { key: 'approval_status', label: 'supplierPoApproval' },
    // 0146: supplier_pos.updated_at, moved by the PO row and its lines.
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}

/**
 * «المعدات في المشاريع» (owner 2026-10-24, migration 0147): every unit
 * inside a project now, over `purchasing_site_units`. Server-side search,
 * filters and sort like every list; units without a PO first by default.
 * Since 0188 (owner 2026-11-09) the page reads the VISITS, open and closed
 * (`purchasing_site_visits`): «الحالة» (`visit_state`) filters them, and
 * the visible, removable default `recent_exit` keeps the visits inside now
 * or exited within the last 60 Saudi days — not a column: the screen turns
 * it into one PostgREST `or` (`siteUnitsRecentOrFilter`) outside
 * `applyListFilters` (`siteUnitsColumnFilterKeys`).
 */
export const siteUnitsListConfig: DataListConfig = {
  id: 'siteUnits',
  searchPlaceholder: {
    ar: 'البحث برقم المعدة او النوع او اللوحة او الشاصي او ترقيم الشركة',
    en: 'Search by unit, type, plate, chassis or company number',
  },
  // Owner 2026-10-25: the supplier and the foreman are filters, not search.
  searchFields: [
    'equipment_code',
    'equipment_type_search',
    'equipment_plate_number',
    'equipment_chassis_number',
    'contractor_equipment_code',
  ],
  defaultSort: 'has_po',
  defaultDirection: 'asc',
  filterFields: [
    {
      key: 'has_po',
      label: 'siteUnitsPoFilter',
      type: 'select',
      operators: ['eq'],
      options: [
        { value: 'false', label: 'بدون PO', labelI18n: 'siteUnitsNoPo' },
        { value: 'true', label: 'عليها PO', labelI18n: 'siteUnitsHasPo' },
      ],
    },
    {
      key: 'equipment_ownership_status',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['in'],
      multiple: true,
      options: [
        {
          value: 'alazani',
          label: 'العزاني',
          labelI18n: 'adminHomeOwnerAlazani',
        },
        {
          value: 'takween',
          label: 'تكوين',
          labelI18n: 'adminHomeOwnerTakween',
        },
        {
          value: 'third_party_f',
          label: 'طرف ثالث F',
          labelI18n: 'adminHomeOwnerThirdPartyF',
        },
        {
          value: 'third_party_partnership_b',
          label: 'طرف ثالث B',
          labelI18n: 'adminHomeOwnerThirdPartyB',
        },
        {
          value: 'external_supplier',
          label: 'مالك اخر',
          labelI18n: 'adminHomeOwnerExternal',
        },
      ],
    },
    // The supplier, only while the owner filter selects «مالك اخر».
    SUPPLIER_FILTER_FIELD,
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'entry_supervisor_id',
      label: 'logsColForeman',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    // 0188: inside a project now, or exited.
    {
      key: 'visit_state',
      label: 'siteUnitsStateFilter',
      type: 'select',
      operators: ['eq'],
      options: [
        { value: 'inside', label: 'داخل الان', labelI18n: 'siteUnitsInside' },
        { value: 'exited', label: 'خرجت', labelI18n: 'siteUnitsExited' },
      ],
    },
    // 0188: the default window (owner «خليها الي خرجت من 1-8 وبعد»), see above.
    {
      key: SITE_UNITS_RECENT_FILTER_KEY,
      label: 'siteUnitsRecentFilter',
      type: 'select',
      operators: ['eq'],
      options: [
        {
          value: SITE_VISITS_SINCE_DAY,
          label: 'خرجت منذ 1 اغسطس 2026 او داخل الان',
          labelI18n: 'siteUnitsRecentSince',
        },
      ],
    },
  ],
  defaultFilters: [SITE_UNITS_RECENT_DEFAULT_FILTER],
  sortableFields: [
    { key: 'has_po', label: 'siteUnitsSortNoPoFirst' },
    { key: 'entry_at', label: 'siteUnitsSortEntry' },
    // Owner 2026-11-11 («الي سويناه بخصوص تاريخ انشاء الدخولية ابغاه يكون في
    // المعدات في المشاريع», «انشاء الدخول فقط»): when the entry was registered
    // (`entry_created_at`, migration 0192), as in the visits of /logs.
    { key: 'entry_created_at', label: { ar: 'تاريخ الانشاء', en: 'Created' } },
    { key: 'equipment_code', label: 'equipmentCode' },
    { key: 'equipment_lessor_name', label: 'supplierPoSupplier' },
  ],
}

/**
 * sales-screens (migration 0169), «حسب المعدات» of «PO العملاء»: one row per
 * unit on a client PO, over `sales_po_units`, with its PO number. The same
 * shape as `poUnitsListConfig`; the open POs by default (a visible,
 * removable default filter).
 */
export const clientPoUnitsListConfig: DataListConfig = {
  id: 'clientPoUnits',
  searchPlaceholder: {
    ar: 'البحث برقم المعدة او النوع او اللوحة او الشاصي او رقم PO العميل',
    en: 'Search by unit, type, plate, chassis or client PO number',
  },
  searchFields: [
    'equipment_code',
    'equipment_type_search',
    'equipment_plate_number',
    'equipment_chassis_number',
    'equipment_plate_digits',
    'po_number',
  ],
  defaultSort: 'equipment_code',
  defaultDirection: 'asc',
  filterFields: [
    {
      key: 'po_status',
      label: 'status',
      type: 'select',
      operators: ['eq', 'neq'],
      options: [
        { value: 'open', label: 'مفتوح', labelI18n: 'supplierPoStatusOpen' },
        {
          value: 'closed',
          label: 'مغلق',
          labelI18n: 'supplierPoStatusClosed',
        },
      ],
    },
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'is_priced',
      label: 'poUnitsPricedFilter',
      type: 'select',
      operators: ['eq'],
      options: [
        { value: 'true', label: 'مسعرة', labelI18n: 'poUnitsPriced' },
        { value: 'false', label: 'بدون سعر', labelI18n: 'poUnitsUnpriced' },
      ],
    },
  ],
  defaultFilters: [
    {
      id: 'default-po-status',
      field: 'po_status',
      operator: 'eq',
      value: 'open',
    },
  ],
  sortableFields: [
    { key: 'equipment_code', label: 'equipmentCode' },
    { key: 'po_number', label: 'clientPoNumber' },
    { key: 'issue_date', label: 'clientPoIssueDate' },
    { key: 'price', label: 'salePrice' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}

/**
 * sales-screens (migration 0169), «حسب الاوامر» of «PO العملاء»: the client
 * purchase orders, over `client_pos`. Search is the client's PO number; the
 * allowlisted filters are the status, the company and project (searched
 * server-side through `asyncFields`) and priced / unpriced.
 */
export const clientPosListConfig: DataListConfig = {
  id: 'clientPos',
  searchPlaceholder: 'clientPoSearchPlaceholder',
  searchFields: ['po_number'],
  defaultSort: 'issue_date',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'status',
      label: 'status',
      type: 'select',
      operators: ['eq', 'neq'],
      options: [
        { value: 'open', label: 'مفتوح', labelI18n: 'supplierPoStatusOpen' },
        {
          value: 'closed',
          label: 'مغلق',
          labelI18n: 'supplierPoStatusClosed',
        },
      ],
    },
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    // The computed column unpriced_count(client_pos): «تحتاج تسعير» = at
    // least one line without a price (a yes / no choice).
    {
      key: 'unpriced_count',
      label: 'supplierPoNeedsPrices',
      type: 'select',
      operators: ['gt', 'eq'],
      options: [],
      choices: [
        { key: 'needs_prices', operator: 'gt', value: '0', label: 'yes' },
        { key: 'all_priced', operator: 'eq', value: '0', label: 'no' },
      ],
    },
  ],
  defaultFilters: [
    {
      id: 'default-status',
      field: 'status',
      operator: 'eq',
      value: 'open',
    },
  ],
  sortableFields: [
    { key: 'issue_date', label: 'clientPoIssueDate' },
    { key: 'po_number', label: 'clientPoNumber' },
    { key: 'expiry_date', label: 'clientPoExpiryDate' },
    { key: 'status', label: 'status' },
    { key: 'created_at', label: 'supplierPoCreatedAt' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}

/**
 * sales-screens (migration 0169), «كروت المعدات»: every «كرت المعدة» with
 * both sides, over `sales_equipment_cards`. Server-side search, filters and
 * sort like every list; the open cards first by default.
 */
export const equipmentCardsListConfig: DataListConfig = {
  id: 'equipmentCards',
  searchPlaceholder: {
    ar: 'البحث برقم المعدة او النوع او اللوحة او الشاصي او رقم PO',
    en: 'Search by unit, type, plate, chassis or PO number',
  },
  searchFields: [
    'equipment_code',
    'equipment_type_search',
    'equipment_plate_number',
    'equipment_chassis_number',
    'equipment_plate_digits',
    'client_po_number',
    'supplier_po_number',
  ],
  // 0189: a card is its visit — the newest entry first (it was the open
  // cards first; a card is neither open nor ended any more).
  defaultSort: 'entry_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'has_client_po',
      label: 'clientPo',
      type: 'select',
      operators: ['eq'],
      options: [
        {
          value: 'false',
          label: 'بدون PO عميل',
          labelI18n: 'equipmentCardNoClientPo',
        },
        {
          value: 'true',
          label: 'عليها PO عميل',
          labelI18n: 'equipmentCardHasClientPo',
        },
      ],
    },
    {
      key: 'has_supplier_po',
      label: 'supplierPo',
      type: 'select',
      operators: ['eq'],
      options: [
        {
          value: 'false',
          label: 'بدون PO مورد',
          labelI18n: 'equipmentCardNoSupplierPo',
        },
        {
          value: 'true',
          label: 'عليها PO مورد',
          labelI18n: 'equipmentCardHasSupplierPo',
        },
      ],
    },
  ],
  sortableFields: [
    { key: 'entry_at', label: 'supplierPoEntryDate' },
    { key: 'equipment_code', label: 'equipmentCode' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}

/**
 * sales phase 2 (migration 0172), «الشهور»: every month of every card over
 * `sales_card_month_slots` — recorded or awaited. The month filter's options
 * (the presets and the older months back to the earliest card) are filled by
 * the screen; search, filters, sort and paging are server-side; the awaited
 * months first by default, the previous Saudi month by default (a visible,
 * removable filter from `src/lib/cardMonthsList.ts`).
 */
export const cardMonthsListConfig: DataListConfig = {
  id: 'cardMonths',
  searchPlaceholder: {
    ar: 'البحث برقم المعدة او اللوحة او الشاصي',
    en: 'Search by unit, plate or chassis',
  },
  searchFields: [
    'equipment_code',
    'equipment_plate_digits',
    'equipment_chassis_number',
  ],
  defaultSort: 'recorded',
  defaultDirection: 'asc',
  filterFields: [
    {
      key: CARD_MONTHS_MONTH_FILTER_KEY,
      label: 'cardMonthsMonth',
      type: 'select',
      operators: ['eq'],
      // Filled at runtime by the screen (the month presets, then older
      // months back to the earliest card month).
      options: [],
    },
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'recorded',
      label: 'status',
      type: 'select',
      operators: ['eq'],
      options: [
        { value: 'true', label: 'مسجل', labelI18n: 'cardMonthStateRecorded' },
        {
          value: 'false',
          label: 'بانتظار',
          labelI18n: 'cardMonthStatePending',
        },
      ],
    },
  ],
  defaultFilters: [CARD_MONTHS_DEFAULT_FILTER],
  sortableFields: [
    { key: 'recorded', label: 'cardMonthsSortPendingFirst' },
    { key: 'equipment_code', label: 'equipmentCode' },
    { key: 'month', label: 'cardMonthsMonth' },
    { key: 'hours', label: 'cardMonthHours' },
    { key: 'client_due', label: 'cardMonthClientDue' },
    { key: 'margin', label: 'equipmentCardMargin' },
  ],
}

/**
 * Card pricing (migration 0174), «اسعار المعدات»: every card on a supplier
 * PO line over `sales_equipment_cards` (the screen always adds
 * `supplier_line_id IS NOT NULL`, `src/lib/cardPricesList.ts`) with its
 * client price, the supplier price, the margin and the pricing approval;
 * search, filters, sort and paging server-side; the open cards by default (a
 * visible, removable filter); the owner filter as the purchasing lists, the
 * supplier only while it selects «مالك اخر».
 */
export const cardPricesListConfig: DataListConfig = {
  id: 'cardPrices',
  searchPlaceholder: {
    ar: 'البحث برقم المعدة او اللوحة او الشاصي او رقم PO المورد',
    en: 'Search by unit, plate, chassis or supplier PO number',
  },
  searchFields: [
    'equipment_code',
    'equipment_plate_digits',
    'equipment_chassis_number',
    'supplier_po_number',
  ],
  // Owner 2026-11-07 (0184): the latest change of the card, its client PO or
  // its supplier PO first.
  defaultSort: 'last_modified_at',
  defaultDirection: 'desc',
  // 0189: no open / ended filter (and no «open cards» default): a card has
  // no such state any more.
  filterFields: [
    {
      key: 'pricing_status',
      label: 'cardPricingStatus',
      type: 'select',
      operators: ['eq', 'neq'],
      options: [
        { value: 'draft', label: 'مسودة', labelI18n: 'cardPricingDraft' },
        { value: 'approved', label: 'معتمد', labelI18n: 'cardPricingApproved' },
      ],
    },
    {
      key: 'equipment_ownership_status',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['in'],
      multiple: true,
      options: [
        {
          value: 'alazani',
          label: 'العزاني',
          labelI18n: 'adminHomeOwnerAlazani',
        },
        {
          value: 'takween',
          label: 'تكوين',
          labelI18n: 'adminHomeOwnerTakween',
        },
        {
          value: 'third_party_f',
          label: 'طرف ثالث F',
          labelI18n: 'adminHomeOwnerThirdPartyF',
        },
        {
          value: 'third_party_partnership_b',
          label: 'طرف ثالث B',
          labelI18n: 'adminHomeOwnerThirdPartyB',
        },
        {
          value: 'external_supplier',
          label: 'مالك اخر',
          labelI18n: 'adminHomeOwnerExternal',
        },
      ],
    },
    // The supplier, only while the owner filter selects «مالك اخر».
    SUPPLIER_FILTER_FIELD,
    {
      key: 'company_id',
      label: 'company',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
    {
      key: 'project_id',
      label: 'project',
      type: 'select',
      operators: ['in'],
      options: [],
      multiple: true,
    },
  ],
  sortableFields: [
    { key: 'equipment_code', label: 'equipmentCode' },
    { key: 'company_name_ar', label: 'company' },
    { key: 'supplier_price', label: 'cardPriceSupplier' },
    { key: 'card_client_price', label: 'cardPriceClient' },
    { key: 'card_margin_pct', label: 'cardPriceMarginPct' },
    { key: 'pricing_status', label: 'cardPricingStatus' },
    { key: 'last_modified_at', label: 'updatedAt' },
  ],
}
