import type {
  DataListConfig,
  FilterOperator,
  FilterOption,
} from '@/components/data-list/types'
import {
  DRIVER_EMPLOYMENT_TYPES,
  DRIVER_NATIONALITIES,
} from '@/lib/driverExcel'

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
    ar: 'البحث بالاسم او الهوية او الجوال',
    en: 'Search by name, ID or mobile',
  },
  searchFields: ['full_name', 'name_en', 'id_number', 'mobile_number'],
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
      options: select(DRIVER_EMPLOYMENT_TYPES),
    },
    {
      key: 'job_title',
      label: 'jobTitle',
      type: 'text',
      operators: textOps,
    },
  ],
  sortableFields: [
    { key: 'full_name', label: { ar: 'الاسم', en: 'Name' } },
    { key: 'name_en', label: 'driverNameEn' },
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
  searchFields: [
    'code',
    'plate_number',
    'plate_digits',
    'chassis_number',
    'type',
  ],
  defaultSort: 'updated_at',
  defaultDirection: 'desc',
  filterFields: [
    {
      key: 'operational_status',
      label: 'operationalStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [
        {
          value: 'operational',
          label: 'operational',
          labelI18n: 'operational',
        },
        {
          value: 'maintenance',
          label: 'maintenance',
          labelI18n: 'maintenance',
        },
        { value: 'stopped', label: 'stopped', labelI18n: 'stopped' },
      ],
    },
    {
      key: 'ownership_status',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
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
    // Replaces the `is_active` boolean filter: the lifecycle status is the
    // field admins now read and set, and the allowlist is the same closed set
    // as the database CHECK constraint from migration 0102.
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
        {
          value: 'scrapped',
          label: 'مشطوبة',
          labelI18n: 'equipmentStatusScrapped',
        },
        {
          value: 'rented_out',
          label: 'مؤجرة للغير',
          labelI18n: 'equipmentStatusRentedOut',
        },
      ],
    },
  ],
  sortableFields: [
    { key: 'code', label: 'equipmentCode' },
    { key: 'type', label: 'equipmentType' },
    { key: 'plate_number', label: 'plateNumber' },
    { key: 'operational_status', label: 'operationalStatus' },
    { key: 'status', label: 'equipmentStatus' },
    { key: 'ownership_status', label: 'ownershipStatus' },
    { key: 'created_at', label: 'createdAt' },
    { key: 'updated_at', label: { ar: 'تاريخ التعديل', en: 'Last updated' } },
  ],
}
export const companiesListConfig: DataListConfig = {
  id: 'companies',
  searchPlaceholder: {
    ar: 'البحث باسم الشركة',
    en: 'Search by company name',
  },
  searchFields: ['name_ar', 'name_en'],
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
}
export const lessorsListConfig: DataListConfig = {
  id: 'lessors',
  searchPlaceholder: {
    ar: 'البحث بالاسم أو جهة الاتصال أو الجوال',
    en: 'Search by name, contact person or mobile',
  },
  searchFields: ['name', 'contact_person', 'contact_number'],
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
const movementSearchPlaceholder = {
  ar: 'البحث بالمعدة (كود او لوحة او شاصي) او السائق او كود المقاول',
  en: 'Search by equipment (code, plate or chassis), driver or contractor code',
}
export const movementsListConfig: DataListConfig = {
  id: 'movements',
  searchPlaceholder: movementSearchPlaceholder,
  searchFields: ['equipment', 'driver_name', 'contractor_equipment_code'],
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
  sortableFields: [
    { key: 'full_name', label: { ar: 'الاسم', en: 'Name' } },
    { key: 'role', label: 'role' },
    { key: 'created_at', label: 'createdAt' },
  ],
}
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
 * Search is the shared movement search (`buildMovementSearchFilter`), so the
 * search box covers the equipment, the driver snapshot and the contractor
 * code. The foreman is deliberately a filter and not a search field: searching
 * it made an equipment code that happens to appear in a name match rows the
 * user did not ask for.
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
  searchFields: ['equipment', 'driver_name', 'contractor_equipment_code'],
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
      ],
    },
  ],
  sortableFields: [
    { key: 'recorded_at', label: { ar: 'وقت الحركة', en: 'Movement time' } },
    { key: 'created_at', label: { ar: 'وقت الانشاء', en: 'Created' } },
    { key: 'movement_type', label: 'movementType' },
    { key: 'equipment_code', label: 'equipmentCode' },
  ],
}
