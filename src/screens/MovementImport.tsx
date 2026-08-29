import { useCallback, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import { PageHeader } from '@/components/PageHeader'
import { Select, type SelectOption } from '@/components/Select'
import { useI18n } from '@/i18n/I18nContext'
import {
  downloadMovementImportTemplate,
  parseMovementWorkbook,
  type MovementImportMode,
  type ParsedMovementImportRow,
} from '@/lib/movementExcel'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'

interface MovementImportRow extends ParsedMovementImportRow {
  equipment_id: string | null
  equipment_label: string | null
  company_id: string | null
  company_label: string | null
  project_id: string | null
  project_label: string | null
  driver_id: string | null
  driver_label: string | null
  supervisor_id: string | null
  supervisor_label: string | null
  errors: string[]
  import_error?: string
}

interface ImportResult {
  row_number: string
  success: boolean
  error?: string
}

function ImportProjectSelect({
  companyId,
  value,
  label,
  placeholder,
  disabled,
  lang,
  onChange,
}: {
  companyId: string | null
  value: string | null
  label: string
  placeholder: string
  disabled: boolean
  lang: 'ar' | 'en'
  onChange: (value: string, option: SelectOption | null) => void
}) {
  const loadOptions = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = companyId
        ? supabase
            .from('projects')
            .select('id,name_ar,name_en,company_projects!inner(company_id)')
            .eq('company_projects.company_id', companyId)
            .order(lang === 'ar' ? 'name_ar' : 'name_en')
            .limit(20)
        : supabase
            .from('projects')
            .select('id,name_ar,name_en')
            .order(lang === 'ar' ? 'name_ar' : 'name_en')
            .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term)
        query = query.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await query
      return (data ?? []).map((item) => ({
        value: item.id,
        label: localizedName(lang, item.name_ar, item.name_en),
      }))
    },
    [companyId, lang],
  )

  return (
    <AsyncSearchSelect
      value={value ?? ''}
      selectedOption={value ? { value, label } : null}
      onChange={onChange}
      loadOptions={loadOptions}
      disabled={disabled}
      placeholder={placeholder}
    />
  )
}

export function MovementImport() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<MovementImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    type: 'error' | 'success' | 'warning'
    text: string
  } | null>(null)

  const modeOptions = [
    { value: 'entry', label: t('entryOnly') },
    { value: 'exit', label: t('exitOnly') },
    { value: 'both', label: t('entryAndExit') },
  ]

  const rowErrors = useCallback((row: MovementImportRow) => {
    const errors: string[] = []
    if (!row.equipment_id) errors.push('equipment_not_found')
    if (row.mode === 'entry' || row.mode === 'both') {
      if (!row.company_id) errors.push('company_not_found')
      if (!row.project_id) errors.push('project_not_found')
      if (!row.driver_id) errors.push('driver_not_found')
      if (!row.entry_date) errors.push('entry_date_required')
    }
    if ((row.mode === 'exit' || row.mode === 'both') && !row.exit_date)
      errors.push('exit_date_required')
    if (
      row.mode === 'both' &&
      row.entry_date &&
      row.exit_date &&
      row.exit_date < row.entry_date
    )
      errors.push('exit_before_entry')
    if (row.import_error) errors.push(row.import_error)
    return errors
  }, [])

  const validRows = useMemo(
    () => rows.filter((row) => rowErrors(row).length === 0),
    [rowErrors, rows],
  )

  const updateRow = (index: number, patch: Partial<MovementImportRow>) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, ...patch, import_error: undefined }
          : row,
      ),
    )
  }

  const loadEquipment = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
        .from('equipment')
        .select('id,code,type,plate_number')
        .order('code')
        .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term)
        query = query.or(
          `code.ilike.%${term}%,type.ilike.%${term}%,plate_number.ilike.%${term}%`,
        )
      const { data } = await query
      return (data ?? []).map((item) => ({
        value: item.id,
        label: `${item.code} — ${item.type}${item.plate_number ? ` · ${item.plate_number}` : ''}`,
      }))
    },
    [],
  )

  const loadCompanies = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
        .from('companies')
        .select('id,name_ar,name_en')
        .order(lang === 'ar' ? 'name_ar' : 'name_en')
        .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term)
        query = query.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await query
      return (data ?? []).map((item) => ({
        value: item.id,
        label: localizedName(lang, item.name_ar, item.name_en),
      }))
    },
    [lang],
  )

  const loadDrivers = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
        .from('drivers')
        .select('id,full_name,mobile_number')
        .order('full_name')
        .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term)
        query = query.or(
          `full_name.ilike.%${term}%,mobile_number.ilike.%${term}%`,
        )
      const { data } = await query
      return (data ?? []).map((item) => ({
        value: item.id,
        label: `${item.full_name}${item.mobile_number ? ` · ${item.mobile_number}` : ''}`,
      }))
    },
    [],
  )

  const loadSupervisors = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
        .from('profiles')
        .select('id,full_name')
        .order('full_name')
        .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term) query = query.ilike('full_name', `%${term}%`)
      const { data } = await query
      return (data ?? []).map((item) => ({
        value: item.id,
        label: item.full_name,
      }))
    },
    [],
  )

  async function chooseFile(file?: File) {
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      setMessage({ type: 'error', text: t('invalidFile') })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const parsed = await parseMovementWorkbook(file)
      if (!parsed.length) throw new Error('empty_file')
      const { data, error } = await supabase.rpc('prepare_movement_import', {
        p_rows: parsed,
      })
      if (error) throw error
      setRows((data as MovementImportRow[]) ?? [])
    } catch {
      setRows([])
      setMessage({ type: 'error', text: t('movementImportReadFailed') })
    } finally {
      setBusy(false)
    }
  }

  async function importRows() {
    if (!validRows.length || !confirm(t('confirmMovementImport'))) return
    setBusy(true)
    setMessage(null)
    const payload = validRows.map((row) => ({
      row_number: row.row_number,
      mode: row.mode,
      equipment_id: row.equipment_id,
      company_id: row.company_id,
      project_id: row.project_id,
      driver_id: row.driver_id,
      driver_label: row.driver_label,
      supervisor_id: row.supervisor_id,
      contractor_equipment_code: row.contractor_equipment_code,
      entry_date: row.entry_date,
      exit_date: row.exit_date,
      notes: row.notes,
    }))
    const { data, error } = await supabase.rpc('import_movement_rows', {
      p_rows: payload,
    })
    setBusy(false)
    if (error) {
      setMessage({ type: 'error', text: t('movementImportFailed') })
      return
    }
    const results = (data as ImportResult[]) ?? []
    const succeeded = new Set(
      results
        .filter((result) => result.success)
        .map((result) => Number(result.row_number)),
    )
    const failed = new Map(
      results
        .filter((result) => !result.success)
        .map((result) => [
          Number(result.row_number),
          result.error ?? 'import_failed',
        ]),
    )
    setRows((current) =>
      current
        .filter((row) => !succeeded.has(row.row_number))
        .map((row) => ({
          ...row,
          import_error: failed.get(row.row_number),
        })),
    )
    const successCount = succeeded.size
    const failCount = failed.size
    setMessage({
      type: failCount ? 'warning' : 'success',
      text: t('movementImportResult')
        .replace('{success}', String(successCount))
        .replace('{fail}', String(failCount)),
    })
  }

  const errorLabel = (code: string) => {
    const key = `movementImportError_${code}`
    return t(key as Parameters<typeof t>[0])
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('movementImport')}
        description={t('movementImportDesc')}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-outline"
              onClick={downloadMovementImportTemplate}
            >
              <Download size={16} />
              {t('downloadTemplate')}
            </button>
            <label className="btn-primary cursor-pointer">
              <Upload size={16} />
              {t('uploadExcel')}
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  chooseFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
          </div>
        }
      />

      {message && <Alert type={message.type}>{message.text}</Alert>}

      {!rows.length ? (
        <div className="card border-dashed py-16 text-center text-muted">
          <FileSpreadsheet className="mx-auto mb-3" size={32} />
          <p>{t('movementImportEmpty')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex gap-2">
              <span className="badge status-entry border">
                {t('valid')}: {validRows.length}
              </span>
              <span className="badge status-exit border">
                {t('invalid')}: {rows.length - validRows.length}
              </span>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !validRows.length}
              onClick={importRows}
            >
              {busy
                ? t('processing')
                : t('importValidRows').replace(
                    '{count}',
                    String(validRows.length),
                  )}
            </button>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="max-h-[65vh] overflow-auto">
              <table className="min-w-[1750px] text-xs">
                <thead
                  className="sticky top-0 z-10"
                  style={{ background: 'var(--surface)' }}
                >
                  <tr>
                    <th className="table-header p-2">{t('row')}</th>
                    <th className="table-header w-40 p-2">{t('importMode')}</th>
                    <th className="table-header w-64 p-2">{t('equipment')}</th>
                    <th className="table-header w-56 p-2">{t('company')}</th>
                    <th className="table-header w-56 p-2">{t('project')}</th>
                    <th className="table-header w-56 p-2">{t('driverName')}</th>
                    <th className="table-header w-52 p-2">{t('supervisor')}</th>
                    <th className="table-header w-40 p-2">
                      {t('companyNumber')}
                    </th>
                    <th className="table-header w-40 p-2">{t('entryDate')}</th>
                    <th className="table-header w-40 p-2">{t('exitDate')}</th>
                    <th className="table-header w-60 p-2">{t('notes')}</th>
                    <th className="table-header w-56 p-2">{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const errors = rowErrors(row)
                    return (
                      <tr
                        key={row.row_number}
                        className="border-t align-top"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <td className="p-2 text-center">{row.row_number}</td>
                        <td className="p-2">
                          <Select
                            value={row.mode}
                            onChange={(value) =>
                              updateRow(index, {
                                mode: value as MovementImportMode,
                              })
                            }
                            options={modeOptions}
                          />
                        </td>
                        <td className="p-2">
                          <AsyncSearchSelect
                            value={row.equipment_id ?? ''}
                            selectedOption={
                              row.equipment_id
                                ? {
                                    value: row.equipment_id,
                                    label:
                                      row.equipment_label ?? row.equipment_code,
                                  }
                                : null
                            }
                            onChange={(value, option) =>
                              updateRow(index, {
                                equipment_id: value || null,
                                equipment_label: option?.label ?? null,
                              })
                            }
                            loadOptions={loadEquipment}
                            placeholder={
                              row.equipment_code ||
                              row.plate_number ||
                              t('selectEquipment')
                            }
                          />
                        </td>
                        <td className="p-2">
                          <AsyncSearchSelect
                            value={row.company_id ?? ''}
                            selectedOption={
                              row.company_id
                                ? {
                                    value: row.company_id,
                                    label:
                                      row.company_label ?? row.company_name,
                                  }
                                : null
                            }
                            onChange={(value, option) =>
                              updateRow(index, {
                                company_id: value || null,
                                company_label: option?.label ?? null,
                                project_id: null,
                                project_label: null,
                              })
                            }
                            loadOptions={loadCompanies}
                            disabled={row.mode === 'exit'}
                            placeholder={row.company_name || t('selectCompany')}
                          />
                        </td>
                        <td className="p-2">
                          <ImportProjectSelect
                            companyId={row.company_id}
                            value={row.project_id}
                            label={row.project_label ?? row.project_name}
                            onChange={(value, option) =>
                              updateRow(index, {
                                project_id: value || null,
                                project_label: option?.label ?? null,
                              })
                            }
                            lang={lang}
                            disabled={row.mode === 'exit'}
                            placeholder={row.project_name || t('selectProject')}
                          />
                        </td>
                        <td className="p-2">
                          <AsyncSearchSelect
                            value={row.driver_id ?? ''}
                            selectedOption={
                              row.driver_id
                                ? {
                                    value: row.driver_id,
                                    label: row.driver_label ?? row.driver_name,
                                  }
                                : null
                            }
                            onChange={(value, option) =>
                              updateRow(index, {
                                driver_id: value || null,
                                driver_label: option?.label ?? null,
                              })
                            }
                            loadOptions={loadDrivers}
                            disabled={row.mode === 'exit'}
                            placeholder={row.driver_name || t('selectDriver')}
                          />
                        </td>
                        <td className="p-2">
                          <AsyncSearchSelect
                            value={row.supervisor_id ?? ''}
                            selectedOption={
                              row.supervisor_id
                                ? {
                                    value: row.supervisor_id,
                                    label:
                                      row.supervisor_label ??
                                      row.supervisor_name,
                                  }
                                : null
                            }
                            onChange={(value, option) =>
                              updateRow(index, {
                                supervisor_id: value || null,
                                supervisor_label: option?.label ?? null,
                                supervisor_name: option?.label ?? '',
                              })
                            }
                            loadOptions={loadSupervisors}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className="input"
                            value={row.contractor_equipment_code}
                            onChange={(event) =>
                              updateRow(index, {
                                contractor_equipment_code: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="date"
                            className="input"
                            value={row.entry_date}
                            disabled={row.mode === 'exit'}
                            onChange={(event) =>
                              updateRow(index, {
                                entry_date: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="date"
                            className="input"
                            value={row.exit_date}
                            disabled={row.mode === 'entry'}
                            onChange={(event) =>
                              updateRow(index, {
                                exit_date: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className="input"
                            value={row.notes}
                            onChange={(event) =>
                              updateRow(index, { notes: event.target.value })
                            }
                          />
                        </td>
                        <td className="p-2">
                          {errors.length ? (
                            <div className="space-y-1 text-red-600 dark:text-red-400">
                              {errors.map((error) => (
                                <p key={error}>{errorLabel(error)}</p>
                              ))}
                            </div>
                          ) : (
                            <span className="text-green-700 dark:text-green-400">
                              {t('valid')}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
