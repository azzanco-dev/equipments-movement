import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Dialog, ErrorState } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  COMPANY_EXPORT_COLUMNS,
  companyExportColumnLabels,
  exportCompaniesToExcel,
  type CompanyExportColumn,
  type CompanyExportRow,
} from '@/lib/companyExport'
import type { Company } from '@/lib/types'

export interface CompanyExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Moved as-is from the legacy `AdminCompanies` screen: it always exports
 *  every company (independent of the list's current filters/paging), so it
 *  needs no data from the list screen beyond opening/closing. */
export function CompanyExportDialog({
  open,
  onOpenChange,
}: CompanyExportDialogProps) {
  const { t, lang } = useI18n()
  const [exportColumns, setExportColumns] = useState<Set<CompanyExportColumn>>(
    () => new Set(['name_ar', 'name_en', 'linked_projects']),
  )
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const toggleExportColumn = (column: CompanyExportColumn) => {
    setExportColumns((current) => {
      const next = new Set(current)
      if (next.has(column)) next.delete(column)
      else next.add(column)
      return next
    })
  }

  const handleExport = async () => {
    const selectedColumns = COMPANY_EXPORT_COLUMNS.filter((column) =>
      exportColumns.has(column),
    )
    if (!selectedColumns.length) return
    setExporting(true)
    setExportError(null)
    try {
      const allCompanies: Company[] = []
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from('companies')
          .select('id,name_ar,name_en,created_at,updated_at')
          .order('name_ar')
          .order('id')
          .range(from, from + 499)
        if (error) throw error
        const batch = (data as Company[]) ?? []
        allCompanies.push(...batch)
        if (batch.length < 500) break
      }

      const projectsByCompany = new Map<
        string,
        Array<{ name_ar: string; name_en: string }>
      >()
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from('company_projects')
          .select('company_id,project:projects(name_ar,name_en)')
          .order('company_id')
          .range(from, from + 499)
        if (error) throw error
        const batch = (data ?? []) as unknown as Array<{
          company_id: string
          project: { name_ar: string; name_en: string } | null
        }>
        for (const link of batch) {
          if (!link.project) continue
          const projects = projectsByCompany.get(link.company_id) ?? []
          projects.push(link.project)
          projectsByCompany.set(link.company_id, projects)
        }
        if (batch.length < 500) break
      }

      const rows: CompanyExportRow[] = allCompanies.map((company) => ({
        ...company,
        projects: projectsByCompany.get(company.id) ?? [],
      }))
      exportCompaniesToExcel(rows, selectedColumns, t, lang)
      onOpenChange(false)
    } catch (error) {
      console.error(error)
      setExportError(t('exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setExportError(null)
        onOpenChange(next)
      }}
      title={t('exportCompanies')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            icon={<Download size={16} />}
            loading={exporting}
            disabled={exportColumns.size === 0}
            onClick={handleExport}
          >
            {t('exportExcel')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {exportError && <ErrorState title={exportError} className="p-4" />}
        <p className="text-sm text-muted">{t('companyExportHelp')}</p>
        <div className="space-y-2">
          {COMPANY_EXPORT_COLUMNS.map((column) => (
            <label
              key={column}
              className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <input
                type="checkbox"
                checked={exportColumns.has(column)}
                onChange={() => toggleExportColumn(column)}
                className="rounded"
              />
              {t(companyExportColumnLabels[column])}
            </label>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
