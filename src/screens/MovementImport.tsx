import { useCallback, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import { Select, type SelectOption } from '@/components/Select'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  useConfirm,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  downloadMovementImportTemplate,
  parseMovementWorkbook,
  type MovementImportMode,
  type ParsedMovementImportRow,
} from '@/lib/movementExcel'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'
import { plateDigitsSearchTerm, toLatinDigits } from '@/lib/plate'
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

export function MovementImport() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<MovementImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    type: 'error' | 'success' | 'warning'
    text: string
  } | null>(null)
  const { confirm, confirmDialog } = useConfirm()

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

  const updateRow = (rowNumber: number, patch: Partial<MovementImportRow>) => {
    setRows((current) =>
      current.map((row) =>
        row.row_number === rowNumber
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
      const term = toLatinDigits(sanitizeSearchTerm(search))
      if (term) {
        const orParts = [
          `code.ilike.%${term}%`,
          `type.ilike.%${term}%`,
          `plate_number.ilike.%${term}%`,
        ]
        const plateDigits = plateDigitsSearchTerm(term)
        if (plateDigits) orParts.push(`plate_digits.ilike.%${plateDigits}%`)
        query = query.or(orParts.join(','))
      }
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

  const loadProjects = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
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
    [lang],
  )

  const loadDrivers = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
        .from('drivers')
        .select('id,full_name,name_en,mobile_number')
        .order('full_name')
        .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term)
        query = query.or(
          `full_name.ilike.%${term}%,name_en.ilike.%${term}%,mobile_number.ilike.%${term}%`,
        )
      const { data } = await query
      return (data ?? []).map((item) => ({
        value: item.id,
        label: `${item.full_name}${item.name_en ? ` · ${item.name_en}` : ''}${item.mobile_number ? ` · ${item.mobile_number}` : ''}`,
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
    if (
      !validRows.length ||
      !(await confirm({
        title: t('confirmMovementImport'),
        description: t('dialogDescMovementImportConfirm'),
      }))
    )
      return
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

  const columns: DataTableColumn<MovementImportRow>[] = [
    {
      key: 'row_number',
      header: t('row'),
      align: 'center',
      width: '3.5rem',
      cell: (row) => row.row_number,
    },
    {
      key: 'mode',
      header: t('importMode'),
      width: '10rem',
      cell: (row) => (
        <Select
          value={row.mode}
          onChange={(value) =>
            updateRow(row.row_number, { mode: value as MovementImportMode })
          }
          options={modeOptions}
        />
      ),
    },
    {
      key: 'equipment',
      header: t('equipment'),
      width: '16rem',
      cell: (row) => (
        <AsyncSearchSelect
          value={row.equipment_id ?? ''}
          selectedOption={
            row.equipment_id
              ? {
                  value: row.equipment_id,
                  label: row.equipment_label ?? row.equipment_code,
                }
              : null
          }
          onChange={(value, option) =>
            updateRow(row.row_number, {
              equipment_id: value || null,
              equipment_label: option?.label ?? null,
            })
          }
          loadOptions={loadEquipment}
          placeholder={
            row.equipment_code || row.plate_number || t('selectEquipment')
          }
        />
      ),
    },
    {
      key: 'company',
      header: t('company'),
      width: '14rem',
      cell: (row) => (
        <AsyncSearchSelect
          value={row.company_id ?? ''}
          selectedOption={
            row.company_id
              ? {
                  value: row.company_id,
                  label: row.company_label ?? row.company_name,
                }
              : null
          }
          onChange={(value, option) =>
            updateRow(row.row_number, {
              company_id: value || null,
              company_label: option?.label ?? null,
            })
          }
          loadOptions={loadCompanies}
          disabled={row.mode === 'exit'}
          placeholder={row.company_name || t('selectCompany')}
        />
      ),
    },
    {
      key: 'project',
      header: t('project'),
      width: '14rem',
      cell: (row) => (
        <AsyncSearchSelect
          value={row.project_id ?? ''}
          selectedOption={
            row.project_id
              ? {
                  value: row.project_id,
                  label: row.project_label ?? row.project_name,
                }
              : null
          }
          onChange={(value, option) =>
            updateRow(row.row_number, {
              project_id: value || null,
              project_label: option?.label ?? null,
            })
          }
          loadOptions={loadProjects}
          disabled={row.mode === 'exit'}
          placeholder={row.project_name || t('selectProject')}
        />
      ),
    },
    {
      key: 'driver',
      header: t('driverName'),
      width: '14rem',
      cell: (row) => (
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
            updateRow(row.row_number, {
              driver_id: value || null,
              driver_label: option?.label ?? null,
            })
          }
          loadOptions={loadDrivers}
          disabled={row.mode === 'exit'}
          placeholder={row.driver_name || t('selectDriver')}
        />
      ),
    },
    {
      key: 'supervisor',
      header: t('supervisor'),
      width: '13rem',
      cell: (row) => (
        <AsyncSearchSelect
          value={row.supervisor_id ?? ''}
          selectedOption={
            row.supervisor_id
              ? {
                  value: row.supervisor_id,
                  label: row.supervisor_label ?? row.supervisor_name,
                }
              : null
          }
          onChange={(value, option) =>
            updateRow(row.row_number, {
              supervisor_id: value || null,
              supervisor_label: option?.label ?? null,
              supervisor_name: option?.label ?? '',
            })
          }
          loadOptions={loadSupervisors}
        />
      ),
    },
    {
      key: 'contractor_equipment_code',
      header: t('companyNumber'),
      width: '10rem',
      cell: (row) => (
        <input
          className="input"
          value={row.contractor_equipment_code}
          onChange={(event) =>
            updateRow(row.row_number, {
              contractor_equipment_code: event.target.value,
            })
          }
        />
      ),
    },
    {
      key: 'entry_date',
      header: t('entryDate'),
      width: '10rem',
      cell: (row) => (
        <input
          type="date"
          className="input"
          value={row.entry_date}
          disabled={row.mode === 'exit'}
          onChange={(event) =>
            updateRow(row.row_number, { entry_date: event.target.value })
          }
        />
      ),
    },
    {
      key: 'exit_date',
      header: t('exitDate'),
      width: '10rem',
      cell: (row) => (
        <input
          type="date"
          className="input"
          value={row.exit_date}
          disabled={row.mode === 'entry'}
          onChange={(event) =>
            updateRow(row.row_number, { exit_date: event.target.value })
          }
        />
      ),
    },
    {
      key: 'notes',
      header: t('notes'),
      width: '15rem',
      cell: (row) => (
        <input
          className="input"
          value={row.notes}
          onChange={(event) =>
            updateRow(row.row_number, { notes: event.target.value })
          }
        />
      ),
    },
    {
      key: 'status',
      header: t('status'),
      width: '14rem',
      cell: (row) => {
        const errors = rowErrors(row)
        // `DataTable` cells default to `whitespace-nowrap`; an element's own
        // explicit value always wins over an inherited one, so this override
        // lets the error list wrap inside the fixed column width.
        return (
          <span className="block whitespace-normal break-words">
            {errors.length ? (
              <span className="block space-y-1 text-danger">
                {errors.map((error) => (
                  <span key={error} className="block">
                    {errorLabel(error)}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-success">{t('valid')}</span>
            )}
          </span>
        )
      },
    },
  ]

  // A failed read/RPC with no rows loaded is a failed load, not "nothing
  // uploaded yet" — never collapse the two into the same empty placeholder.
  const readFailed = message?.type === 'error' && rows.length === 0

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('movementImport')}
        description={t('movementImportDesc')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              icon={<Download size={16} />}
              onClick={downloadMovementImportTemplate}
            >
              {t('downloadTemplate')}
            </Button>
            <Button asChild variant="primary">
              <label className="cursor-pointer">
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
            </Button>
          </div>
        }
      />

      {message && !readFailed && (
        <Alert type={message.type}>{message.text}</Alert>
      )}

      {!rows.length ? (
        readFailed ? (
          <ErrorState description={message!.text} />
        ) : busy ? (
          <div className="rounded-xl border border-dashed py-16 text-center">
            <Skeleton variant="circle" className="mx-auto mb-3 h-8 w-8" />
            <Skeleton variant="text" className="mx-auto w-48" />
          </div>
        ) : (
          <EmptyState
            icon={<FileSpreadsheet size={32} />}
            title={t('movementImportEmpty')}
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex gap-2">
              <Badge tone="success">
                {t('valid')}: {validRows.length}
              </Badge>
              <Badge tone="danger">
                {t('invalid')}: {rows.length - validRows.length}
              </Badge>
            </div>
            <Button
              variant="primary"
              loading={busy}
              disabled={!validRows.length}
              onClick={importRows}
            >
              {t('importValidRows').replace(
                '{count}',
                String(validRows.length),
              )}
            </Button>
          </div>

          <DataTable
            size="sm"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.row_number}
            loading={busy}
            rowClassName={() => 'align-top'}
            maxHeight="65vh"
          />
        </>
      )}
      {confirmDialog}
    </div>
  )
}
