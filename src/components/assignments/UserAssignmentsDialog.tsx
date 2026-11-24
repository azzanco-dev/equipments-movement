import { useEffect, useMemo, useState } from 'react'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
// The Radix Popover multi-select: its list opens INSIDE the dialog's layer.
// The older `@/components/AsyncMultiSelect` portals its list to the body,
// where a modal dialog takes a click on it for a click outside and closes
// (owner 2026-11-24, «فيه مشكلة في الdialog حق تعديل الاسناد»).
import { AsyncMultiSelect } from '@/components/data-list/AsyncMultiSelect'
import { Badge, Button, Dialog, Field, Notice } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  assignmentSaveMessage,
  assignmentsKey,
  companiesProjectLoader,
  companyAssignmentLoader,
  projectsWithinCompanies,
  type CompanyAssignmentOption,
  type ProjectOption,
  type UserAssignments,
} from '@/lib/foremanAssignments'
import { localizedName } from '@/lib/localizedName'
import { supabase } from '@/lib/supabase'

/**
 * «تعديل اسناد …» (migration 0212, owner 2026-11-24, design approved in
 * Figma): a user's companies («الشركات المسؤول عنها») and, inside them, the
 * projects he is narrowed to («المشاريع المسؤول عنها»; a company with none
 * picked = all of its projects), saved in ONE `admin_set_profile_assignments`
 * call. Opened from Settings › «اسناد الشركات والمشاريع» and from the user
 * page. Taking a company off drops its projects; the project options are the
 * projects of the chosen companies (server side, 20). «حفظ» stays disabled
 * while nothing changed; a refusal shows its mapped message, never the raw
 * error (the database checks users.manage / users.assignments, the caller's
 * own account and an admin's).
 */
export function UserAssignmentsDialog({
  open,
  onOpenChange,
  userId,
  userName,
  subtitle,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userName: string
  /** The user's role, under the title. */
  subtitle?: string | null
  initial: UserAssignments
  onSaved: (saved: UserAssignments) => void
}) {
  const { t, lang } = useI18n()
  const [companies, setCompanies] = useState<CompanyAssignmentOption[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setCompanies(initial.companies)
    setProjects(initial.projects)
    setMessage(null)
    setSaving(false)
    // `initial` is read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const loadCompanies = useMemo(
    () => companyAssignmentLoader(supabase, lang),
    [lang],
  )
  const companyIdsKey = companies.map((company) => company.value).join(',')
  const loadProjects = useMemo(
    () =>
      companiesProjectLoader(
        supabase,
        companyIdsKey ? companyIdsKey.split(',') : [],
        lang,
      ),
    [companyIdsKey, lang],
  )
  const companyOptions = useMemo(
    () =>
      companies.map((company) => ({
        ...company,
        label: localizedName(lang, company.name_ar, company.name_en),
      })),
    [companies, lang],
  )
  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        ...project,
        label: localizedName(lang, project.name_ar, project.name_en),
      })),
    [projects, lang],
  )
  const changed =
    assignmentsKey({ companies, projects }) !== assignmentsKey(initial)

  /** The picked ids back to full options: from what the control knows (the
   *  loader's rows carry both names and, for a project, its companies), else
   *  from what was already chosen. */
  function pick<T extends AsyncSearchSelectOption>(
    ids: string[],
    known: AsyncSearchSelectOption[],
    current: readonly T[],
  ): T[] {
    const byId = new Map<string, T>()
    for (const option of current) byId.set(option.value, option)
    for (const option of known) byId.set(option.value, option as T)
    return ids.flatMap((id) => {
      const option = byId.get(id)
      return option ? [option] : []
    })
  }

  const changeCompanies = (
    ids: string[],
    known: AsyncSearchSelectOption[],
  ) => {
    const nextCompanies = pick(ids, known, companies)
    setMessage(null)
    setCompanies(nextCompanies)
    setProjects((current) =>
      projectsWithinCompanies(
        current,
        nextCompanies.map((company) => company.value),
      ),
    )
  }

  const submit = async () => {
    if (saving || !changed) return
    setSaving(true)
    setMessage(null)
    let failure: { code?: string; message?: string } | null = null
    try {
      const { error } = await supabase.rpc('admin_set_profile_assignments', {
        p_profile_id: userId,
        p_company_ids: companies.map((company) => company.value),
        p_project_ids: projects.map((project) => project.value),
      })
      if (error) failure = error
    } catch {
      failure = {}
    }
    setSaving(false)
    if (failure) {
      const key = assignmentSaveMessage(failure)
      setMessage(
        key === 'userProjectsSaveFailed' ? 'userAssignmentsSaveFailed' : key,
      )
      return
    }
    onSaved({ companies, projects })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
      title={t('userAssignmentsEditTitle').replace('{name}', userName)}
      description={subtitle ?? undefined}
      size="md"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!changed}
            onClick={submit}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('assignedCompanies')}
          hint={t('userAssignmentsCompaniesHint')}
        >
          {(control) => (
            <AsyncMultiSelect
              id={control.id}
              aria-describedby={control['aria-describedby']}
              value={companyOptions.map((company) => company.value)}
              selectedOptions={companyOptions}
              onValueChange={changeCompanies}
              loadOptions={loadCompanies}
              allLabel={t('userAssignmentsAllCompanies')}
              disabled={saving}
            />
          )}
        </Field>
        <PickedChips options={companyOptions} />
        {companies.length > 0 && (
          <>
            <Field
              label={t('assignedProjects')}
              hint={t('userAssignmentsProjectsHint')}
            >
              {(control) => (
                <AsyncMultiSelect
                  // Re-mounted when the companies change, so its options
                  // follow them.
                  key={companyIdsKey}
                  id={control.id}
                  aria-describedby={control['aria-describedby']}
                  value={projectOptions.map((project) => project.value)}
                  selectedOptions={projectOptions}
                  onValueChange={(ids, known) => {
                    setMessage(null)
                    setProjects(pick(ids, known, projects))
                  }}
                  loadOptions={loadProjects}
                  allLabel={t('assignedProjectsAll')}
                  disabled={saving}
                />
              )}
            </Field>
            <PickedChips options={projectOptions} />
          </>
        )}
        {message && (
          <Notice tone="danger" size="compact">
            {t(message)}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}

/** The picked names under a field once there are more than the control's
 *  trigger names (it then reads «3 محددة»), so every choice stays in view. */
function PickedChips({ options }: { options: readonly AsyncSearchSelectOption[] }) {
  if (options.length <= 2) return null
  return (
    <div className="-mt-2 flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Badge
          key={option.value}
          tone="neutral"
          size="sm"
          className="max-w-full !shrink !whitespace-normal break-words"
        >
          {option.label}
        </Badge>
      ))}
    </div>
  )
}
