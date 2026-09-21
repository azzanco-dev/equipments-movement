import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  ErrorState,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  downloadEquipmentTemplate,
  parseEquipmentExcel,
  type EquipmentImportRow,
} from '@/lib/excel'
import { usesExternalSupplier } from '@/lib/equipmentOwnership'
import { genQrValue } from '@/lib/equipmentForm'

export interface EquipmentImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after at least one row was inserted, so the list refetches. */
  onImported: () => void
}

export function EquipmentImportDialog({
  open,
  onOpenChange,
  onImported,
}: EquipmentImportDialogProps) {
  const { t } = useI18n()
  const [rows, setRows] = useState<EquipmentImportRow[]>([])
  const [projectMap, setProjectMap] = useState<Map<string, string>>(new Map())
  const [lessorMap, setLessorMap] = useState<Map<string, string>>(new Map())
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{
    success: number
    fail: number
  } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validRows = rows.filter((row) => row._errors.length === 0)

  const reset = () => {
    setRows([])
    setSelectedRows(new Set())
    setError(null)
    setResult(null)
    setProjectMap(new Map())
    setLessorMap(new Map())
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelect = async (file: File) => {
    setError(null)
    setResult(null)
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError(t('invalidFile'))
      return
    }
    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseEquipmentExcel(buffer, t)

      const { data: knownTypeRows, error: knownTypesError } = await supabase
        .from('equipment_types')
        .select('name')
      if (knownTypesError) throw knownTypesError
      const knownTypes = new Set(
        (knownTypeRows ?? []).map((row) => row.name.toLowerCase()),
      )
      for (const row of parsed) {
        if (row.type && !knownTypes.has(row.type.toLowerCase()))
          row._errors.push(t('equipmentTypeNotFound'))
      }

      const importedCodes = [
        ...new Set(parsed.map((row) => row.code).filter(Boolean)),
      ]
      const codeChunks = Array.from(
        { length: Math.ceil(importedCodes.length / 100) },
        (_, index) => importedCodes.slice(index * 100, index * 100 + 100),
      )
      const existingCodeResults = await Promise.all(
        codeChunks.map((codes) =>
          supabase.from('equipment').select('code').in('code', codes),
        ),
      )
      const existingCodeError = existingCodeResults.find(
        (item) => item.error,
      )?.error
      if (existingCodeError) throw existingCodeError
      const existingCodes = new Set(
        existingCodeResults
          .flatMap((item) => item.data ?? [])
          .map((row) => row.code.toLowerCase()),
      )
      const seenCodes = new Set<string>()
      for (const row of parsed) {
        const lowerCode = row.code.toLowerCase()
        if (existingCodes.has(lowerCode) || seenCodes.has(lowerCode))
          row._errors.push(t('duplicateCode'))
        seenCodes.add(lowerCode)
      }

      const projectNames = [
        ...new Set(parsed.map((row) => row.project_name).filter(Boolean)),
      ]
      const lessorNames = [
        ...new Set(parsed.map((row) => row.lessor_name).filter(Boolean)),
      ]
      const [projectsAr, projectsEn, lessorRows] = await Promise.all([
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
      const matchedProjects = [
        ...(projectsAr.data ?? []),
        ...(projectsEn.data ?? []),
      ]
      const nextProjectMap = new Map(
        matchedProjects.flatMap((project) => [
          [project.name_ar.toLowerCase(), project.id],
          [project.name_en.toLowerCase(), project.id],
        ]),
      )
      const nextLessorMap = new Map(
        (lessorRows.data ?? []).map((lessor) => [
          lessor.name.toLowerCase(),
          lessor.id,
        ]),
      )
      setProjectMap(nextProjectMap)
      setLessorMap(nextLessorMap)
      for (const row of parsed) {
        if (
          row.project_name &&
          !nextProjectMap.has(row.project_name.toLowerCase())
        )
          row._errors.push(t('projectNotFound'))
        if (
          usesExternalSupplier(row.ownership_status) &&
          row.lessor_name &&
          !nextLessorMap.has(row.lessor_name.toLowerCase())
        )
          row._errors.push(t('lessorNotFound'))
      }

      setRows(parsed)
      setSelectedRows(
        new Set(
          parsed
            .filter((row) => row._errors.length === 0)
            .map((row) => row._rowNumber),
        ),
      )
    } catch {
      setError(t('invalidFile'))
    }
  }

  const toggleRow = (rowNumber: number) =>
    setSelectedRows((current) => {
      const next = new Set(current)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })

  const toggleAllValid = () => {
    const allSelected = validRows.every((row) =>
      selectedRows.has(row._rowNumber),
    )
    setSelectedRows(
      allSelected ? new Set() : new Set(validRows.map((row) => row._rowNumber)),
    )
  }

  const handleImport = async () => {
    setImporting(true)
    setError(null)

    const rowsToImport = rows.filter(
      (row) => selectedRows.has(row._rowNumber) && row._errors.length === 0,
    )
    const payload = rowsToImport.map((row) => ({
      code: row.code,
      type: row.type,
      plate_number: row.plate_number,
      operational_status: row.operational_status,
      ownership_status: row.ownership_status,
      project_id: row.project_name
        ? (projectMap.get(row.project_name.toLowerCase()) ?? null)
        : null,
      lessor_id:
        usesExternalSupplier(row.ownership_status) && row.lessor_name
          ? (lessorMap.get(row.lessor_name.toLowerCase()) ?? null)
          : null,
      brand: row.brand,
      model: row.model,
      manufacture_year: row.manufacture_year,
      chassis_number: row.chassis_number,
      registration_type: row.registration_type,
      qr_value: genQrValue(),
      last_maintenance_date: row.last_maintenance_date,
      registration_expiry: row.registration_expiry,
      insurance_expiry: row.insurance_expiry,
    }))

    try {
      let successCount = 0
      let failCount = 0
      const batchSize = 50

      const insertBatch = async (batch: typeof payload): Promise<void> => {
        if (!batch.length) return
        const { error: insertError } = await supabase
          .from('equipment')
          .insert(batch)
        if (!insertError) {
          successCount += batch.length
          return
        }
        if (batch.length === 1) {
          failCount += 1
          return
        }
        const middle = Math.ceil(batch.length / 2)
        await insertBatch(batch.slice(0, middle))
        await insertBatch(batch.slice(middle))
      }

      for (let index = 0; index < payload.length; index += batchSize) {
        await insertBatch(payload.slice(index, index + batchSize))
      }
      setResult({ success: successCount, fail: failCount })
      if (successCount > 0) onImported()
    } catch {
      setError(t('importError'))
    } finally {
      setImporting(false)
    }
  }

  const columns: DataTableColumn<EquipmentImportRow>[] = [
    {
      key: 'select',
      header: '',
      width: '2.5rem',
      align: 'center',
      cell: (row) => (
        <Checkbox
          disabled={row._errors.length > 0}
          checked={selectedRows.has(row._rowNumber)}
          onCheckedChange={() => toggleRow(row._rowNumber)}
          aria-label={`${t('row')} ${row._rowNumber}`}
        />
      ),
    },
    {
      key: '_rowNumber',
      header: t('row'),
      className: 'text-muted',
      cell: (row) => row._rowNumber,
    },
    {
      key: 'code',
      header: t('equipmentCode'),
      className: 'font-semibold',
      cell: (row) => row.code || '—',
    },
    {
      key: 'type',
      header: t('equipmentType'),
      className: 'text-muted',
      cell: (row) => row.type || '—',
    },
    {
      key: 'plate_number',
      header: t('plateNumber'),
      className: 'text-muted',
      cell: (row) => <span dir="ltr">{row.plate_number ?? '—'}</span>,
    },
    {
      key: 'operational_status',
      header: t('operationalStatus'),
      className: 'text-muted',
      cell: (row) => row.operational_status,
    },
    {
      key: 'ownership_status',
      header: t('ownershipStatus'),
      className: 'text-muted',
      cell: (row) => row.ownership_status,
    },
    {
      key: '_errors',
      header: t('rowErrors'),
      className: '!whitespace-normal',
      cell: (row) =>
        row._errors.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {row._errors.map((message, index) => (
              <Badge
                key={index}
                tone="danger"
                size="sm"
                icon={<XCircle size={11} />}
              >
                {message}
              </Badge>
            ))}
          </span>
        ) : (
          <CheckCircle2 size={16} aria-hidden="true" className="text-success" />
        ),
    },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      title={t('importEquipment')}
      description={t('dialogDescEquipmentImport')}
      size="lg"
    >
      {error && <ErrorState title={error} className="mb-4 p-4" />}
      {result && (
        <div className="mb-4">
          <Badge tone={result.fail > 0 ? 'warning' : 'success'}>
            {result.fail > 0
              ? t('importPartialSuccess')
                  .replace('{success}', String(result.success))
                  .replace('{fail}', String(result.fail))
              : t('importSuccess').replace('{count}', String(result.success))}
          </Badge>
        </div>
      )}

      {rows.length === 0 && !result ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={15} aria-hidden="true" />}
              onClick={() => downloadEquipmentTemplate(t)}
            >
              {t('downloadTemplate')}
            </Button>
          </div>
          <div
            role="button"
            tabIndex={0}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
              dragOver ? 'border-primary bg-surface-hover' : 'border-border'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              const file = event.dataTransfer.files[0]
              if (file) void handleFileSelect(file)
            }}
          >
            <FileSpreadsheet
              size={48}
              aria-hidden="true"
              className="mx-auto mb-4 text-muted"
            />
            <p className="text-muted">{t('dragDropFile')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFileSelect(file)
              }}
            />
          </div>
        </div>
      ) : rows.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Badge
                tone="success"
                icon={<CheckCircle2 size={12} aria-hidden="true" />}
              >
                {t('validRows')}: {validRows.length}
              </Badge>
              <Badge
                tone="danger"
                icon={<AlertTriangle size={12} aria-hidden="true" />}
              >
                {t('errorRows')}: {rows.length - validRows.length}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={toggleAllValid}>
                {selectedRows.size === validRows.length
                  ? t('deselectAll')
                  : t('selectAll')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Download size={15} aria-hidden="true" />}
                onClick={() => downloadEquipmentTemplate(t)}
              >
                {t('downloadTemplate')}
              </Button>
            </div>
          </div>

          <DataTable
            size="sm"
            columns={columns}
            rows={rows}
            rowKey={(row) => row._rowNumber}
            maxHeight="400px"
            caption={t('importEquipment')}
          />

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={reset}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={importing}
              disabled={selectedRows.size === 0}
              onClick={handleImport}
            >
              {importing
                ? t('importing')
                : `${t('importSelected')} (${selectedRows.size})`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-8">
          <Button
            variant="primary"
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            {t('close')}
          </Button>
        </div>
      )}
    </Dialog>
  )
}
