import { useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Alert } from '@/components/Alert'
import { Modal } from '@/components/Modal'
import {
  downloadDriverTemplate,
  parseDriverWorkbook,
  type DriverImportRow,
} from '@/lib/driverExcel'
import { useI18n } from '@/i18n/I18nContext'

export function DriverExcelImport({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported: () => void
}) {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<DriverImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = rows.filter((row) => row.errors.length === 0 && !row.duplicate)
  const chooseFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const parsed = await parseDriverWorkbook(file)
      const ids = parsed.flatMap((row) =>
        row.id_number ? [row.id_number] : [],
      )
      const mobiles = parsed.flatMap((row) =>
        row.mobile_number ? [row.mobile_number] : [],
      )
      const [idResult, mobileResult] = await Promise.all([
        ids.length
          ? supabase.from('drivers').select('id_number').in('id_number', ids)
          : Promise.resolve({ data: [] }),
        mobiles.length
          ? supabase
              .from('drivers')
              .select('mobile_number')
              .in('mobile_number', mobiles)
          : Promise.resolve({ data: [] }),
      ])
      const existingIds = new Set(
        (idResult.data ?? []).map((item) => item.id_number),
      )
      const existingMobiles = new Set(
        (mobileResult.data ?? []).map((item) => item.mobile_number),
      )
      setRows(
        parsed.map((row) => ({
          ...row,
          duplicate:
            row.duplicate ||
            Boolean(
              (row.id_number && existingIds.has(row.id_number)) ||
              (row.mobile_number && existingMobiles.has(row.mobile_number)),
            ),
        })),
      )
    } catch {
      setError(t('driverFileReadFailed'))
    } finally {
      setBusy(false)
    }
  }
  const confirmImport = async () => {
    if (!valid.length) return
    setBusy(true)
    setError('')
    const payload = valid.map((row) => ({
      full_name: row.full_name,
      id_number: row.id_number,
      mobile_number: row.mobile_number,
      nationality: row.nationality,
      employment_type: row.employment_type,
      job_title: row.job_title,
    }))
    const { error: insertError } = await supabase
      .from('drivers')
      .insert(payload)
    setBusy(false)
    if (insertError) {
      setError(t('driverImportFailed'))
      return
    }
    onImported()
    onClose()
    setRows([])
  }
  const formatError = (value: string) =>
    lang === 'ar'
      ? value
      : value
          .replace('full_name مطلوب', 'Full name is required')
          .replace('id_number غير صالح', 'Invalid ID number')
          .replace('mobile_number غير صالح', 'Invalid mobile number')
          .replace('nationality غير معتمدة', 'Unsupported nationality')
          .replace('employment_type غير معتمد', 'Unsupported employment type')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('importDriversExcel')}
      size="xl"
    >
      <div className="space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline"
            onClick={downloadDriverTemplate}
          >
            <Download size={17} />
            {t('downloadTemplate')}
          </button>
          <label className="btn-primary cursor-pointer">
            <Upload size={17} />
            {t('uploadExcel')}
            <input
              className="hidden"
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                chooseFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
        </div>
        {!rows.length ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-muted">
            <FileSpreadsheet className="mx-auto mb-2" />
            {t('uploadForPreview')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="card py-3">
                <b>{valid.length}</b>
                <br />
                {t('valid')}
              </div>
              <div className="card py-3">
                <b>{rows.filter((r) => r.errors.length).length}</b>
                <br />
                {t('invalid')}
              </div>
              <div className="card py-3">
                <b>{rows.filter((r) => r.duplicate).length}</b>
                <br />
                {t('duplicateSuspected')}
              </div>
            </div>
            <div
              className="max-h-80 overflow-auto rounded-lg border"
              style={{ borderColor: 'var(--border)' }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="table-header p-2">{t('row')}</th>
                    <th className="table-header p-2">{t('fullName')}</th>
                    <th className="table-header p-2">{t('idNumber')}</th>
                    <th className="table-header p-2">{t('mobileNumber')}</th>
                    <th className="table-header p-2">{t('status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.rowNumber}
                      className="border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="p-2">{row.rowNumber}</td>
                      <td className="p-2">{row.full_name || '—'}</td>
                      <td className="p-2" dir="ltr">
                        {row.id_number || '—'}
                      </td>
                      <td className="p-2" dir="ltr">
                        {row.mobile_number || '—'}
                      </td>
                      <td className="p-2">
                        {row.errors.length
                          ? row.errors
                              .map(formatError)
                              .join(lang === 'ar' ? '، ' : ', ')
                          : row.duplicate
                            ? t('duplicateSuspected')
                            : t('valid')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex gap-3 pt-2">
          <button className="btn-outline flex-1" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="btn-primary flex-1"
            disabled={busy || !valid.length}
            onClick={confirmImport}
          >
            {busy
              ? t('processing')
              : t('importValidRows').replace('{count}', String(valid.length))}
          </button>
        </div>
      </div>
    </Modal>
  )
}
