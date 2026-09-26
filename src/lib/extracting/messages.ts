import type { TranslationKey } from '@/i18n/translations'
import type {
  ExtractionFieldKey,
  FieldErrorCode,
  PublishStatus,
  PublishTarget,
} from './form'

/** API error codes (from both extracting routes) → translated message. */
const ERROR_MESSAGES: Record<string, TranslationKey> = {
  unauthorized: 'extractingErrUnauthorized',
  forbidden: 'extractingErrForbidden',
  service_unavailable: 'extractingErrServiceUnavailable',
  network_error: 'extractingErrNetwork',
  invalid_response: 'extractingErrInvalidResponse',
  image_required: 'extractingErrImageRequired',
  unsupported_image_type: 'extractingErrUnsupportedImage',
  image_too_large: 'extractingErrImageTooLarge',
  ocr_not_configured: 'extractingErrOcrNotConfigured',
  ocr_auth_failed: 'extractingErrOcrAuth',
  ocr_rate_limited: 'extractingErrOcrRateLimited',
  ocr_image_rejected: 'extractingErrOcrImageRejected',
  ocr_timeout: 'extractingErrOcrTimeout',
  ocr_provider_unavailable: 'extractingErrOcrProviderUnavailable',
  ocr_connection_failed: 'extractingErrOcrConnection',
  ocr_invalid_response: 'extractingErrOcrInvalidResponse',
  ocr_no_data: 'extractingErrOcrNoData',
  ocr_failed: 'extractingErrOcrFailed',
  invalid_payload: 'extractingErrInvalidPayload',
  publish_failed: 'extractingErrPublishFailed',
  local_lookup_failed: 'extractingErrLocalLookup',
  local_create_failed: 'extractingErrLocalCreate',
  erp_required_fields_missing: 'extractingErrErpRequiredFields',
  erp_not_configured: 'extractingErrErpNotConfigured',
  erp_invalid_field_mapping: 'extractingErrErpFieldMapping',
  erp_employee_lookup_failed: 'extractingErrErpEmployeeLookup',
  erp_user_lookup_failed: 'extractingErrErpUserLookup',
  erp_user_create_failed: 'extractingErrErpUserCreate',
  erp_employee_create_failed: 'extractingErrErpEmployeeCreate',
  erp_employee_user_conflict: 'extractingErrErpUserConflict',
  erp_employee_update_failed: 'extractingErrErpEmployeeUpdate',
  erp_employee_metadata_failed: 'extractingErrErpMetadata',
  erp_reference_lookup_failed: 'extractingErrErpReferenceLookup',
  erp_gender_not_found: 'extractingErrErpGender',
  erp_company_not_found: 'extractingErrErpCompany',
  erp_employment_type_not_found: 'extractingErrErpEmploymentType',
  erp_department_not_found: 'extractingErrErpDepartment',
  erp_designation_not_found: 'extractingErrErpDesignation',
  erp_connection_failed: 'extractingErrErpConnection',
}

export function errorMessageKey(code: string): TranslationKey {
  return ERROR_MESSAGES[code] ?? 'extractingErrUnknown'
}

export const FIELD_ERROR_MESSAGES: Record<FieldErrorCode, TranslationKey> = {
  required: 'extractingInvalidRequired',
  invalid_id_number: 'extractingInvalidIdNumber',
  invalid_email: 'extractingInvalidEmail',
  invalid_mobile: 'extractingInvalidMobile',
  invalid_ctc: 'extractingInvalidCtc',
  invalid_date: 'extractingInvalidDate',
  invalid_language: 'extractingInvalidLanguage',
}

export const FIELD_LABELS: Record<ExtractionFieldKey, TranslationKey> = {
  full_name_ar: 'extractingFieldFullNameAr',
  full_name_en: 'extractingFieldFullNameEn',
  id_number: 'extractingFieldIdNumber',
  date_of_birth: 'extractingFieldDateOfBirth',
  residence_expiry_date: 'extractingFieldResidenceExpiry',
  nationality: 'extractingFieldNationality',
  occupation: 'extractingFieldOccupation',
  email: 'extractingFieldEmail',
  employee_number: 'extractingFieldEmployeeNumber',
  mobile_number: 'extractingFieldMobile',
  gender: 'extractingFieldGender',
  language: 'extractingFieldLanguage',
  company: 'extractingFieldCompany',
  employment_type: 'extractingFieldEmploymentType',
  department: 'extractingFieldDepartment',
  date_of_joining: 'extractingFieldDateOfJoining',
  ctc: 'extractingFieldCtc',
}

export const STATUS_LABELS: Record<PublishStatus, TranslationKey> = {
  created: 'extractingStatusCreated',
  existing: 'extractingStatusExisting',
  partial: 'extractingStatusPartial',
  skipped: 'extractingStatusSkipped',
  failed: 'extractingStatusFailed',
}

export const TARGET_LABELS: Record<PublishTarget, TranslationKey> = {
  currentSystem: 'extractingTargetCurrentSystem',
  erpnext: 'extractingTargetErpnext',
}
