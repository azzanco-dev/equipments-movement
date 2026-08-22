import * as XLSX from 'xlsx';

export const DRIVER_NATIONALITIES = ['اليمن', 'مصر', 'باكستان', 'الهند', 'نيبال', 'بنجلاديش', 'السودان'] as const;
export const DRIVER_EMPLOYMENT_TYPES = ['العزاني', 'تكوين', 'البناء', 'البدراني', 'امدادات العربة', 'نقدي'] as const;

export type DriverImportRow = {
  rowNumber: number;
  full_name: string;
  id_number: string | null;
  mobile_number: string | null;
  nationality: string | null;
  employment_type: string | null;
  job_title: string | null;
  errors: string[];
  duplicate: boolean;
};

type DriverColumn = 'full_name' | 'id_number' | 'mobile_number' | 'nationality' | 'employment_type' | 'job_title';

export async function parseDriverWorkbook(file: File): Promise<DriverImportRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const seenIds = new Set<string>();
  const seenMobiles = new Set<string>();
  return rows.map((raw, index) => {
    const value = (key: DriverColumn) => String(raw[key] ?? '').trim();
    const full_name = value('full_name');
    const id_number = value('id_number') || null;
    const mobile_number = value('mobile_number') || null;
    const nationality = value('nationality') || null;
    const employment_type = value('employment_type') || null;
    const errors: string[] = [];
    if (!full_name) errors.push('full_name مطلوب');
    if (id_number && !/^\d{5,20}$/.test(id_number)) errors.push('id_number غير صالح');
    if (mobile_number && !/^\+?\d{7,15}$/.test(mobile_number)) errors.push('mobile_number غير صالح');
    if (nationality && !DRIVER_NATIONALITIES.includes(nationality as typeof DRIVER_NATIONALITIES[number])) errors.push('nationality غير معتمدة');
    if (employment_type && !DRIVER_EMPLOYMENT_TYPES.includes(employment_type as typeof DRIVER_EMPLOYMENT_TYPES[number])) errors.push('employment_type غير معتمد');
    const duplicate = Boolean((id_number && seenIds.has(id_number)) || (mobile_number && seenMobiles.has(mobile_number)));
    if (id_number) seenIds.add(id_number);
    if (mobile_number) seenMobiles.add(mobile_number);
    return { rowNumber: index + 2, full_name, id_number, mobile_number, nationality, employment_type, job_title: value('job_title') || null, errors, duplicate };
  });
}

export function downloadDriverTemplate() {
  const sheet = XLSX.utils.json_to_sheet([{
    full_name: 'محمد أحمد', id_number: '1234567890', mobile_number: '0500000000',
    nationality: 'اليمن', employment_type: 'العزاني', job_title: 'سائق',
  }]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Drivers');
  XLSX.writeFile(workbook, 'drivers-import-template.xlsx');
}
