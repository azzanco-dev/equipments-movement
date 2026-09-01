export type UserRole =
  | 'admin'
  | 'supervisor'
  | 'workshop'
  | 'assistant_workshop_manager'
  | 'workshop_manager'
  | 'monitor'

export type OperationalStatus = 'operational' | 'maintenance' | 'stopped'
export type OwnershipStatus =
  | 'alazani'
  | 'takween'
  | 'third_party_f'
  | 'third_party_partnership_b'
  | 'external_supplier'
export type RegistrationType =
  'private_transport' | 'public_transport' | 'heavy_equipment'
export type MovementType = 'entry' | 'exit'
export type RegistrationMethod = 'qr' | 'manual'

export interface Driver {
  id: string
  full_name: string
  id_number: string | null
  mobile_number: string | null
  nationality: string | null
  employment_type: string | null
  job_title: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  full_name: string
  email?: string
  role: UserRole
  project_id: string | null
  assigned_projects?: Array<{ id: string; name_ar: string; name_en: string }>
  assigned_companies?: Array<{ id: string; name_ar: string; name_en: string }>
  must_change_password: boolean
  created_at: string
}

export interface Company {
  id: string
  name_ar: string
  name_en: string
  created_at: string
}

export interface Project {
  id: string
  name_ar: string
  name_en: string
  created_at: string
}

export interface Lessor {
  id: string
  name: string
  contact_person: string | null
  contact_number: string | null
  created_at: string
}

export interface Equipment {
  id: string
  code: string
  type: string
  plate_number: string | null
  plate_digits?: string | null
  plate_letters_en?: string | null
  operational_status: OperationalStatus
  ownership_status: OwnershipStatus
  project_id: string | null
  lessor_id: string | null
  brand: string | null
  model: string | null
  manufacture_year: number | null
  chassis_number: string | null
  registration_type: RegistrationType | null
  qr_value: string
  last_maintenance_date: string | null
  registration_expiry: string | null
  insurance_expiry: string | null
  is_active: boolean
  master_data_complete?: boolean
  numbering_status?: 'numbered' | 'unnumbered'
  created_at: string
  updated_at: string
  project?: Project | null
  lessor?: Lessor | null
}

export interface EntryExitLog {
  id: string
  equipment_id: string
  supervisor_id: string
  movement_type: MovementType
  movement_context?: 'site' | 'workshop'
  workshop_purpose?: 'maintenance' | 'parking' | null
  current_driver_name?: string | null
  registration_method: RegistrationMethod
  driver_name: string | null
  driver_id: string | null
  odometer_reading: number | null
  notes: string | null
  photo_url: string | null
  company_id: string | null
  project_id: string | null
  contractor_equipment_code: string | null
  recorded_at: string
  created_at: string
  equipment?: Equipment
  supervisor?: Profile
  company?: Company | null
  project?: Project | null
  driver?: Driver | null
}

export interface EquipmentVisit {
  equipment_id: string
  equipment_code: string
  equipment_type: string
  contractor_equipment_code: string | null
  plate_number: string | null
  project_id: string | null
  project_name_ar: string | null
  project_name_en: string | null
  company_name_ar: string | null
  company_name_en: string | null
  entry_log_id: string
  entry_recorded_at: string
  entry_supervisor_id: string
  entry_supervisor_name: string | null
  driver_name: string | null
  odometer_reading: number | null
  notes: string | null
  photo_url: string | null
  registration_method: RegistrationMethod
  exit_log_id: string | null
  exit_recorded_at: string | null
  exit_supervisor_id: string | null
  exit_supervisor_name: string | null
  exit_odometer: number | null
  exit_notes: string | null
  exit_photo_url: string | null
  exit_registration_method: RegistrationMethod | null
  exit_driver_name?: string | null
  movement_context?: 'site' | 'workshop'
  last_driver_name?: string | null
}

export interface CompanyProject {
  id: string
  company_id: string
  project_id: string
  created_at: string
}

export interface EntryExitPhoto {
  id: string
  entry_exit_log_id: string
  file_path: string
  uploaded_by: string
  sort_order: number
  created_at: string
}

export interface LastMovement {
  movement_type: MovementType
  movement_context: 'site' | 'workshop'
  workshop_purpose: 'maintenance' | 'parking' | null
  recorded_at: string
  supervisor_id: string
  company_id: string | null
  project_id: string | null
  contractor_equipment_code: string | null
  driver_id: string | null
  driver_name: string | null
}

export interface MovementDriverChange {
  id: string
  entry_log_id: string
  previous_driver_id: string | null
  previous_driver_name: string | null
  new_driver_id: string
  new_driver_name: string
  changed_by: string
  changed_at: string
  note: string | null
  changer?: Profile | null
}
