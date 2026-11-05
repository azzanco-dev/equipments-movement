import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog, ErrorState, Field, useToast } from '@/components/ui'
import { AsyncMultiSelect } from '@/components/AsyncMultiSelect'
import { useI18n } from '@/i18n/I18nContext'
import {
  assignmentPayload,
  assignmentSaveMessage,
  companyLoader,
  companyProjectLoader,
  withCompanies,
  type CompanyAssignment,
} from '@/lib/foremanAssignments'
import { supabase } from '@/lib/supabase'

export interface ForemanAssignmentDialogProps {
  /** The foreman edited; null closes the dialog. */
  foreman: { id: string; name: string } | null
  /** His current companies and projects. */
  initial: CompanyAssignment[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

/**
 * One foreman's assignments in one dialog (0176): his companies, and under
 * each company the projects he is narrowed to — none chosen means every
 * project of that company. Saved in ONE `admin_set_profile_assignments`
 * call, which replaces both sets.
 */
export function ForemanAssignmentDialog({
  foreman,
  initial,
  onOpenChange,
  onSaved,
}: ForemanAssignmentDialogProps) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [items, setItems] = useState<CompanyAssignment[]>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadCompanies = useMemo(() => companyLoader(supabase, lang), [lang])

  useEffect(() => {
    if (!foreman) return
    setItems(initial)
    setError(null)
  }, [foreman, initial])

  const save = async () => {
    if (!foreman) return
    setSaving(true)
    setError(null)
    const { error: saveError } = await supabase.rpc(
      'admin_set_profile_assignments',
      assignmentPayload(foreman.id, items),
    )
    setSaving(false)
    if (saveError) {
      setError(t(assignmentSaveMessage(saveError)))
      return
    }
    toast({
      title: t('foremanAssignmentsSaved').replace('{name}', foreman.name),
      tone: 'success',
    })
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog
      open={foreman !== null}
      onOpenChange={onOpenChange}
      title={t('foremanAssignmentsEdit').replace('{name}', foreman?.name ?? '')}
      description={t('foremanAssignmentsEditDesc')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorState title={error} className="p-4" />}
        <Field
          label={t('assignedCompanies')}
          hint={t('foremanAssignmentsCompaniesHint')}
        >
          {() => (
            <AsyncMultiSelect
              value={items.map((item) => item.company)}
              onChange={(companies) =>
                setItems((current) => withCompanies(current, companies))
              }
              loadOptions={loadCompanies}
              placeholder={t('selectCompanies')}
            />
          )}
        </Field>
        {items.length > 0 && (
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">
              {t('foremanAssignmentsProjects')}
            </h3>
            {items.map((item) => (
              <CompanyProjectsField
                key={item.company.value}
                item={item}
                onChange={(projects) =>
                  setItems((current) =>
                    current.map((entry) =>
                      entry.company.value === item.company.value
                        ? { ...entry, projects }
                        : entry,
                    ),
                  )
                }
              />
            ))}
          </section>
        )}
      </div>
    </Dialog>
  )
}

function CompanyProjectsField({
  item,
  onChange,
}: {
  item: CompanyAssignment
  onChange: (projects: CompanyAssignment['projects']) => void
}) {
  const { t, lang } = useI18n()
  const loadProjects = useMemo(
    () => companyProjectLoader(supabase, item.company.value, lang),
    [item.company.value, lang],
  )
  return (
    <Field
      label={item.company.label}
      hint={
        item.projects.length
          ? t('foremanAssignmentsSomeProjects').replace(
              '{count}',
              String(item.projects.length),
            )
          : t('foremanAssignmentsAllProjects')
      }
    >
      {() => (
        <AsyncMultiSelect
          value={item.projects}
          onChange={onChange}
          loadOptions={loadProjects}
          placeholder={t('foremanAssignmentsAllProjects')}
        />
      )}
    </Field>
  )
}
