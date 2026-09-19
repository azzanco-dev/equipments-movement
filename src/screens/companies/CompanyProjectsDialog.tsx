import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Dialog, ErrorState } from '@/components/ui'
import { Spinner } from '@/components/ui/Spinner'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Company, CompanyProject } from '@/lib/types'

type CompanyProjectWithProject = CompanyProject & {
  project?: { id: string; name_ar: string; name_en: string } | null
}

const LINKS_SELECT =
  'id,company_id,project_id,created_at,project:projects(id,name_ar,name_en)'

export interface CompanyProjectsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The company whose project links are being managed. */
  company: Company | null
}

/** Moved as-is from the legacy `AdminCompanies` screen: `company_projects`
 *  is a many-to-many link table kept for future phases, so this stays a
 *  simple add/remove list rather than a full form. */
export function CompanyProjectsDialog({
  open,
  onOpenChange,
  company,
}: CompanyProjectsDialogProps) {
  const { t, lang } = useI18n()
  const [links, setLinks] = useState<CompanyProjectWithProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addProjectId, setAddProjectId] = useState('')
  const [addProjectOption, setAddProjectOption] = useState<SelectOption | null>(
    null,
  )

  const fetchLinks = useCallback(async (companyId: string) => {
    const { data } = await supabase
      .from('company_projects')
      .select(LINKS_SELECT)
      .eq('company_id', companyId)
    setLinks((data as unknown as CompanyProjectWithProject[]) ?? [])
  }, [])

  useEffect(() => {
    if (!open || !company) return
    setError(null)
    setAddProjectId('')
    setAddProjectOption(null)
    setLoading(true)
    fetchLinks(company.id).finally(() => setLoading(false))
  }, [open, company, fetchLinks])

  const loadAvailableProjects = useCallback(
    async (query: string) => {
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      const linkedIds = links.map((link) => link.project_id)
      if (linkedIds.length)
        request = request.not('id', 'in', `(${linkedIds.join(',')})`)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((project) => ({
        value: project.id,
        label: localizedName(lang, project.name_ar, project.name_en),
      }))
    },
    [links, lang],
  )

  const addLink = async () => {
    if (!company || !addProjectId) return
    setError(null)
    const { error: insertError } = await supabase
      .from('company_projects')
      .insert({ company_id: company.id, project_id: addProjectId })
    if (insertError) {
      console.error(insertError)
      setError(t('saveFailed'))
      return
    }
    setAddProjectId('')
    setAddProjectOption(null)
    fetchLinks(company.id)
  }

  const removeLink = async (linkId: string) => {
    if (!company) return
    setError(null)
    const { error: deleteError } = await supabase
      .from('company_projects')
      .delete()
      .eq('id', linkId)
    if (deleteError) {
      console.error(deleteError)
      setError(t('saveFailed'))
      return
    }
    fetchLinks(company.id)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${t('manageProjects')} — ${company ? localizedName(lang, company.name_ar, company.name_en) : ''}`}
      size="md"
    >
      {error && (
        <div className="mb-4">
          <ErrorState title={error} className="p-4" />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner label={t('loading')} />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="label mb-2">{t('linkedProjects')}</p>
            {links.length === 0 ? (
              <p className="text-sm text-muted py-2">{t('noLinkedProjects')}</p>
            ) : (
              <div className="space-y-1.5">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="text-sm font-medium">
                      {link.project
                        ? localizedName(
                            lang,
                            link.project.name_ar,
                            link.project.name_en,
                          )
                        : link.project_id}
                    </span>
                    <button
                      onClick={() => removeLink(link.id)}
                      className="btn-ghost p-1 text-red-600 dark:text-red-400"
                      title={t('removeProjectLink')}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className="pt-2 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <p className="label mb-2">{t('addProjectLink')}</p>
            <div className="flex gap-2">
              <AsyncSearchSelect
                className="flex-1"
                value={addProjectId}
                selectedOption={addProjectOption}
                onChange={(value, option) => {
                  setAddProjectId(value)
                  setAddProjectOption(option)
                }}
                loadOptions={loadAvailableProjects}
                placeholder="—"
              />
              <button
                onClick={addLink}
                disabled={!addProjectId}
                className="btn-primary px-3"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
