import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import type { Equipment } from '@/lib/types'
import {
  downloadEquipmentUpdateWorkbook,
  parseEquipmentUpdateExcel,
  type EquipmentUpdateRow,
} from '@/lib/equipmentUpdateExcel'

const COMPARE_FIELDS = [
  'code',
  'type',
  'plate_number',
  'operational_status',
  'ownership_status',
  'project_id',
  'lessor_id',
  'brand',
  'model',
  'manufacture_year',
  'chassis_number',
  'registration_type',
  'last_maintenance_date',
  'registration_expiry',
  'insurance_expiry',
] as const

type CurrentEquipment = Equipment & {
  project?: { id: string; name_ar: string; name_en: string } | null
  lessor?: { id: string; name: string } | null
}

function comparable(value: unknown) {
  return value === '' || value === undefined ? null : value
}

export function EquipmentExcelUpdate({
  open,
  onClose,
  onUpdated,
}: {
  open: boolean
  onClose: () => void
  onUpdated: () => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<EquipmentUpdateRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    success: number
    fail: number
  } | null>(null)

  function reset() {
    setRows([])
    setSelected(new Set())
    setError('')
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function exportWorkbook() {
    setBusy(true)
    setError('')
    try {
      const all: CurrentEquipment[] = []
      for (let from = 0; ; from += 500) {
        const { data, error: fetchError } = await supabase
          .from('equipment')
          .select(
            'id,code,type,plate_number,operational_status,ownership_status,project_id,lessor_id,brand,model,manufacture_year,chassis_number,registration_type,qr_value,last_maintenance_date,registration_expiry,insurance_expiry,is_active,master_data_complete,numbering_status,created_at,updated_at,project:projects(id,name_ar,name_en),lessor:lessors(id,name)',
          )
          .order('code')
          .range(from, from + 499)
        if (fetchError) throw fetchError
        const batch = (data ?? []) as unknown as CurrentEquipment[]
        all.push(...batch)
        if (batch.length < 500) break
      }
      downloadEquipmentUpdateWorkbook(all, t)
    } catch {
      setError(t('exportFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function chooseFile(file?: File) {
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const parsed = parseEquipmentUpdateExcel(await file.arrayBuffer(), t)
      const ids = [
        ...new Set(parsed.map((row) => row.record_id).filter(Boolean)),
      ]
      const currentRows: CurrentEquipment[] = []
      for (let index = 0; index < ids.length; index += 100) {
        const { data, error: fetchError } = await supabase
          .from('equipment')
          .select(
            'id,code,type,plate_number,operational_status,ownership_status,project_id,lessor_id,brand,model,manufacture_year,chassis_number,registration_type,qr_value,last_maintenance_date,registration_expiry,insurance_expiry,is_active,master_data_complete,numbering_status,created_at,updated_at',
          )
          .in('id', ids.slice(index, index + 100))
        if (fetchError) throw fetchError
        currentRows.push(...((data ?? []) as CurrentEquipment[]))
      }
      const currentMap = new Map(currentRows.map((item) => [item.id, item]))
      const projectNames = [
        ...new Set(
          parsed.flatMap((row) => (row.project_name ? [row.project_name] : [])),
        ),
      ]
      const lessorNames = [
        ...new Set(
          parsed.flatMap((row) => (row.lessor_name ? [row.lessor_name] : [])),
        ),
      ]
      const [projectsAr, projectsEn, lessors] = await Promise.all([
        projectNames.length
          ? supabase
              .from('projects')
              .select('id,name_ar,name_en')
              .in('name_ar', projectNames)
          : Promise.resolve({ data: [] }),
        projectNames.length
          ? supabase
              .from('projects')
              .select('id,name_ar,name_en')
              .in('name_en', projectNames)
          : Promise.resolve({ data: [] }),
        lessorNames.length
          ? supabase.from('lessors').select('id,name').in('name', lessorNames)
          : Promise.resolve({ data: [] }),
      ])
      const projectMap = new Map(
        [...(projectsAr.data ?? []), ...(projectsEn.data ?? [])].flatMap(
          (item) => [
            [item.name_ar.toLowerCase(), item.id],
            [item.name_en.toLowerCase(), item.id],
          ],
        ),
      )
      const lessorMap = new Map(
        (lessors.data ?? []).map((item) => [item.name.toLowerCase(), item.id]),
      )
      const seen = new Set<string>()
      const reviewed = parsed.map((row) => {
        const next = { ...row, _errors: [...row._errors] }
        if (seen.has(row.record_id)) next._errors.push(t('duplicateCode'))
        seen.add(row.record_id)
        const current = currentMap.get(row.record_id)
        if (!current) {
          next._errors.push(t('recordNotFound'))
          next._status = 'error'
          return next
        }
        if (Date.parse(current.updated_at) !== Date.parse(row.record_version)) {
          next._errors.push(t('recordChangedSinceExport'))
          next._status = 'conflict'
          return next
        }
        next.project_id = row.project_name
          ? (projectMap.get(row.project_name.toLowerCase()) ?? null)
          : null
        next.lessor_id = row.lessor_name
          ? (lessorMap.get(row.lessor_name.toLowerCase()) ?? null)
          : null
        if (row.project_name && !next.project_id)
          next._errors.push(t('projectNotFound'))
        if (row.lessor_name && !next.lessor_id)
          next._errors.push(t('lessorNotFound'))
        const changed = COMPARE_FIELDS.filter(
          (field) => comparable(next[field]) !== comparable(current[field]),
        )
        next._changedFields = [...changed]
        next._status = next._errors.length
          ? 'error'
          : changed.length
            ? 'ready'
            : 'unchanged'
        return next
      })
      setRows(reviewed)
      setSelected(
        new Set(
          reviewed
            .filter((row) => row._status === 'ready')
            .map((row) => row._rowNumber),
        ),
      )
    } catch {
      setError(t('invalidFile'))
    } finally {
      setBusy(false)
    }
  }

  async function applyUpdates() {
    const ready = rows.filter(
      (row) => row._status === 'ready' && selected.has(row._rowNumber),
    )
    if (!ready.length) return
    setBusy(true)
    setError('')
    let success = 0
    let fail = 0
    try {
      for (let index = 0; index < ready.length; index += 100) {
        const payload = ready.slice(index, index + 100).map((row) => ({
          record_id: row.record_id,
          record_version: row.record_version,
          code: row.code,
          type: row.type,
          plate_number: row.plate_number ?? '',
          operational_status: row.operational_status,
          ownership_status: row.ownership_status,
          project_id: row.project_id ?? '',
          lessor_id: row.lessor_id ?? '',
          brand: row.brand ?? '',
          model: row.model ?? '',
          manufacture_year: row.manufacture_year?.toString() ?? '',
          chassis_number: row.chassis_number ?? '',
          registration_type: row.registration_type ?? '',
          last_maintenance_date: row.last_maintenance_date ?? '',
          registration_expiry: row.registration_expiry ?? '',
          insurance_expiry: row.insurance_expiry ?? '',
        }))
        const { data, error: rpcError } = await supabase.rpc(
          'update_equipment_from_excel',
          { p_rows: payload },
        )
        if (rpcError) throw rpcError
        for (const item of (data ?? []) as Array<{ status: string }>) {
          if (item.status === 'updated') success += 1
          else fail += 1
        }
      }
      setResult({ success, fail })
      if (success) onUpdated()
    } catch {
      setError(t('importError'))
    } finally {
      setBusy(false)
    }
  }

  const readyCount = rows.filter((row) => row._status === 'ready').length
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('updateEquipmentExcel')}
      size="xl"
    >
      <div className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        {result && (
          <Alert type={result.fail ? 'warning' : 'success'}>
            {(result.fail
              ? t('equipmentUpdatePartial')
              : t('equipmentUpdateSuccess')
            )
              .replace('{success}', String(result.success))
              .replace('{fail}', String(result.fail))
              .replace('{count}', String(result.success))}
          </Alert>
        )}
        {!rows.length && !result ? (
          <>
            <Alert type="info">{t('equipmentUpdateInstructionPreview')}</Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className="btn-outline"
                disabled={busy}
                onClick={exportWorkbook}
              >
                <Download size={16} /> {t('exportEquipmentForUpdate')}
              </button>
              <label className="btn-primary cursor-pointer">
                <Upload size={16} /> {t('uploadEquipmentUpdate')}
                <input
                  ref={inputRef}
                  className="hidden"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
              </label>
            </div>
          </>
        ) : rows.length ? (
          <>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="card py-3">
                <b>{readyCount}</b>
                <br />
                {t('readyToUpdate')}
              </div>
              <div className="card py-3">
                <b>
                  {rows.filter((row) => row._status === 'unchanged').length}
                </b>
                <br />
                {t('unchangedRows')}
              </div>
              <div className="card py-3">
                <b>{rows.filter((row) => row._status === 'conflict').length}</b>
                <br />
                {t('conflictRows')}
              </div>
              <div className="card py-3">
                <b>{rows.filter((row) => row._status === 'error').length}</b>
                <br />
                {t('errorRows')}
              </div>
            </div>
            <div
              className="max-h-96 overflow-auto rounded-lg border"
              style={{ borderColor: 'var(--border)' }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="table-header p-2"></th>
                    <th className="table-header p-2">{t('row')}</th>
                    <th className="table-header p-2">{t('equipmentCode')}</th>
                    <th className="table-header p-2">{t('plateNumber')}</th>
                    <th className="table-header p-2">{t('changedFields')}</th>
                    <th className="table-header p-2">{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row._rowNumber}
                      className="border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          disabled={row._status !== 'ready'}
                          checked={selected.has(row._rowNumber)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current)
                              if (next.has(row._rowNumber))
                                next.delete(row._rowNumber)
                              else next.add(row._rowNumber)
                              return next
                            })
                          }
                        />
                      </td>
                      <td className="p-2">{row._rowNumber}</td>
                      <td className="p-2 font-medium">{row.code}</td>
                      <td className="p-2" dir="ltr">
                        {row.plate_number || '—'}
                      </td>
                      <td className="p-2">
                        {row._changedFields.join(', ') || '—'}
                      </td>
                      <td className="p-2">
                        {row._errors.join('، ') ||
                          (row._status === 'ready'
                            ? t('readyToUpdate')
                            : t('unchangedRows'))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-3">
              <button className="btn-outline flex-1" onClick={reset}>
                {t('cancel')}
              </button>
              <button
                className="btn-primary flex-1"
                disabled={busy || !selected.size}
                onClick={applyUpdates}
              >
                {t('applyEquipmentUpdates')} ({selected.size})
              </button>
            </div>
          </>
        ) : (
          <button
            className="btn-primary w-full"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            {t('close')}
          </button>
        )}
        {!rows.length && (
          <div className="flex justify-center text-muted">
            <FileSpreadsheet size={32} />
          </div>
        )}
      </div>
    </Modal>
  )
}
