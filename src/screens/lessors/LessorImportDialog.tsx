import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  XCircle,
} from 'lucide-react'
import { Button, Checkbox, Dialog } from '@/components/ui'
import { Alert } from '@/components/Alert'
import { useI18n } from '@/i18n/I18nContext'
import { refusedByPolicy } from '@/lib/actionPermissions'
import {
  downloadLessorTemplate,
  parseLessorsExcel,
  type LessorImportRow,
} from '@/lib/excel'
import { fetchBankNames, matchImportBanks } from '@/lib/banks'
import { fetchTakenPartyNumbers } from '@/lib/partyData'
import {
  LESSOR_IMPORT_PARTY_FIELDS,
  markPartyDuplicates,
  partyImportPayload,
  partyNumbersOf,
} from '@/lib/partyImport'
import { workbookReadErrorKey } from '@/lib/safeWorkbook'
import { supabase } from '@/lib/supabase'

export interface LessorImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after at least one row was inserted, so the list refetches. */
  onImported: () => void
}

/**
 * The supplier Excel import (EM-260, 0175): the name is required; the
 * contact details, the tax number, the CR, the address, the city, the
 * email, the bank and the IBAN are optional columns, matched by their
 * Arabic or English header. A bad shape, a name already stored or repeated,
 * and a tax number or CR already stored or repeated are marked per row and
 * the row is left out. The insert follows `lessors.edit` (the row policy
 * re-checks it) and reads the rows back.
 */
export function LessorImportDialog({
  open,
  onOpenChange,
  onImported,
}: LessorImportDialogProps) {
  const { t } = useI18n()
  const [rows, setRows] = useState<LessorImportRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState<{ success: number; fail: number } | null>(
    null,
  )
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setRows([])
    setSelected(new Set())
    setError(null)
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const readFile = async (file: File) => {
    setError(null)
    setResult(null)
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError(t('invalidFile'))
      return
    }
    let parsed: LessorImportRow[]
    try {
      parsed = parseLessorsExcel(await file.arrayBuffer(), t)
    } catch (readError) {
      setError(t(workbookReadErrorKey(readError, 'invalidFile')))
      return
    }
    setReading(true)
    try {
      // Names: the stored suppliers with one of the file's names, and the
      // names repeated inside the file (compared without case).
      const names = [...new Set(parsed.map((row) => row.name).filter(Boolean))]
      const storedNames = new Set<string>()
      for (let i = 0; i < names.length; i += 100) {
        const { data, error: namesError } = await supabase
          .from('lessors')
          .select('name')
          .in('name', names.slice(i, i + 100))
        if (namesError) throw namesError
        for (const row of data ?? []) storedNames.add(row.name.toLowerCase())
      }
      const seenNames = new Set<string>()
      for (const row of parsed) {
        const key = row.name.toLowerCase()
        if (key && (storedNames.has(key) || seenNames.has(key)))
          row._errors.push(t('duplicateLessorName'))
        if (key) seenNames.add(key)
      }
      markPartyDuplicates(
        parsed,
        await fetchTakenPartyNumbers('lessors', partyNumbersOf(parsed)),
        t,
      )
      // 0177: the bank must be one of the banks list (Settings › «البنوك»).
      if (parsed.some((row) => row.bank_name))
        matchImportBanks(
          parsed,
          await fetchBankNames(supabase),
          t('bankNotInList'),
        )
    } catch {
      setError(t('importError'))
      return
    } finally {
      setReading(false)
    }
    setRows(parsed)
    setSelected(
      new Set(
        parsed.filter((row) => row._errors.length === 0).map((r) => r._rowNumber),
      ),
    )
  }

  const validRows = rows.filter((row) => row._errors.length === 0)
  const allValidSelected =
    validRows.length > 0 && validRows.every((row) => selected.has(row._rowNumber))

  const toggle = (rowNumber: number) => {
    const next = new Set(selected)
    if (next.has(rowNumber)) next.delete(rowNumber)
    else next.add(rowNumber)
    setSelected(next)
  }

  const runImport = async () => {
    setImporting(true)
    setError(null)
    const payload = validRows
      .filter((row) => selected.has(row._rowNumber))
      .map((row) => ({
        name: row.name,
        ...partyImportPayload(row, LESSOR_IMPORT_PARTY_FIELDS),
      }))
    let success = 0
    let fail = 0
    let refused = false
    try {
      for (let i = 0; i < payload.length; i += 50) {
        const batch = payload.slice(i, i + 50)
        const { data, error: insertError } = await supabase
          .from('lessors')
          .insert(batch)
          .select('id')
        if (refusedByPolicy(insertError, data)) {
          refused = true
          fail += batch.length
        } else if (insertError) fail += batch.length
        else success += batch.length
      }
      if (refused && success === 0) {
        setError(t('lessorsImportNotAllowed'))
        return
      }
      setResult({ success, fail })
      setRows([])
      if (success > 0) onImported()
    } catch {
      setError(t('importError'))
    } finally {
      setImporting(false)
    }
  }

  const templateButton = (
    <Button
      variant="ghost"
      size="sm"
      icon={<Download size={16} aria-hidden="true" />}
      onClick={() => downloadLessorTemplate(t)}
    >
      {t('downloadTemplate')}
    </Button>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      title={t('importLessors')}
      description={t('dialogDescLessorImport')}
      size="lg"
      footer={
        rows.length > 0 ? (
          <>
            <Button variant="outline" onClick={reset}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              loading={importing}
              disabled={selected.size === 0}
              onClick={runImport}
            >
              {`${t('importSelected')} (${selected.size})`}
            </Button>
          </>
        ) : result ? (
          <Button
            variant="primary"
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            {t('close')}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        {result && (
          <Alert type={result.fail > 0 ? 'warning' : 'success'}>
            {result.fail > 0
              ? t('lessorsImportPartialSuccess')
                  .replace('{success}', String(result.success))
                  .replace('{fail}', String(result.fail))
              : t('lessorsImportSuccess').replace(
                  '{count}',
                  String(result.success),
                )}
          </Alert>
        )}

        {rows.length === 0 && !result && (
          <>
            <div className="flex justify-end">{templateButton}</div>
            <button
              type="button"
              disabled={reading}
              className={`block w-full cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${dragOver ? 'border-primary bg-surface-hover' : 'border-border'}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(false)
                const file = event.dataTransfer.files[0]
                if (file) void readFile(file)
              }}
            >
              <FileSpreadsheet
                size={48}
                aria-hidden="true"
                className="mx-auto mb-4 text-muted"
              />
              <span className="text-muted">{t('dragDropFile')}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void readFile(file)
              }}
            />
          </>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 size={16} aria-hidden="true" /> {t('validRows')}
                  : {validRows.length}
                </span>
                <span className="flex items-center gap-1.5 text-danger">
                  <AlertTriangle size={16} aria-hidden="true" />{' '}
                  {t('errorRows')}: {rows.length - validRows.length}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={validRows.length === 0}
                  onClick={() =>
                    setSelected(
                      allValidSelected
                        ? new Set()
                        : new Set(validRows.map((row) => row._rowNumber)),
                    )
                  }
                >
                  {allValidSelected ? t('deselectAll') : t('selectAll')}
                </Button>
                {templateButton}
              </div>
            </div>
            <div className="max-h-[400px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b">
                    <th className="w-8 px-3 py-2" />
                    <th className="table-header px-3 py-2 text-start">
                      {t('row')}
                    </th>
                    <th className="table-header px-3 py-2 text-start">
                      {t('lessorName')}
                    </th>
                    <th className="table-header px-3 py-2 text-start">
                      {t('taxNumber')}
                    </th>
                    <th className="table-header px-3 py-2 text-start">
                      {t('rowErrors')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const invalid = row._errors.length > 0
                    return (
                      <tr
                        key={row._rowNumber}
                        className={`border-b last:border-0 ${invalid ? 'bg-danger-soft' : ''}`}
                      >
                        <td className="px-3 py-2 text-center">
                          <Checkbox
                            aria-label={`${t('row')} ${row._rowNumber}`}
                            disabled={invalid}
                            checked={selected.has(row._rowNumber)}
                            onCheckedChange={() => toggle(row._rowNumber)}
                          />
                        </td>
                        <td className="px-3 py-2 text-muted">{row._rowNumber}</td>
                        <td className="px-3 py-2 font-semibold">
                          {row.name || '—'}
                        </td>
                        <td className="px-3 py-2 text-muted">
                          <bdi dir="ltr">{row.tax_number || '—'}</bdi>
                        </td>
                        <td className="px-3 py-2">
                          {invalid ? (
                            <div className="flex flex-wrap gap-1">
                              {row._errors.map((message, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 text-xs text-danger"
                                >
                                  <XCircle size={12} aria-hidden="true" />{' '}
                                  {message}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <CheckCircle2
                              size={16}
                              aria-label={t('validRows')}
                              className="text-success"
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
