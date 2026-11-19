import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import { CompanyContactFormDialog } from '@/components/companies/CompanyContactFormDialog'
import {
  Button,
  ErrorState,
  IconButton,
  Notice,
  Skeleton,
  useConfirm,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  companyContactErrorOutcome,
  companyContactSummary,
  type CompanyContact,
} from '@/lib/companyContacts'
import {
  deleteCompanyContact,
  fetchCompanyContacts,
} from '@/lib/companyContactsData'
import { localizedName } from '@/lib/localizedName'

/**
 * «الاشخاص المسؤولون» of a client company (migration 0204, owner
 * 2026-11-19): the list of its responsible persons — the name, the contact
 * number and the email, with the projects a person is assigned to («كل
 * المشاريع» when none) — and, for `canEdit`, add / edit / delete. Every
 * change is saved at once through its own function, apart from the company
 * form's Save button; a quotation that copied a person keeps its copy. A
 * failed load is an error with a retry, never «no persons».
 */
export function CompanyContactsSection({
  companyId,
  canEdit,
}: {
  companyId: string
  canEdit: boolean
}) {
  const { t, lang } = useI18n()
  const { confirm, confirmDialog } = useConfirm()
  const [contacts, setContacts] = useState<CompanyContact[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  // The dialog: a person to edit, `new`, or closed.
  const [editing, setEditing] = useState<CompanyContact | 'new' | null>(null)
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const request = useRef(0)

  const load = useCallback(
    async (quiet = false) => {
      const current = ++request.current
      if (!quiet) setState('loading')
      try {
        const rows = await fetchCompanyContacts(companyId)
        if (current !== request.current) return
        setContacts(rows)
        setState('ready')
      } catch {
        if (current !== request.current) return
        setState('error')
      }
    },
    [companyId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (contact: CompanyContact) => {
    if (
      !(await confirm({
        title: t('companyContactDeleteTitle').replace('{name}', contact.name),
        description: t('companyContactDeleteDesc'),
        confirmLabel: t('companyContactDelete'),
        tone: 'danger',
      }))
    )
      return
    setMessage(null)
    setDeleting(contact.id)
    const result = await deleteCompanyContact(contact.id)
    setDeleting(null)
    if (result.error) {
      const outcome = companyContactErrorOutcome(result.error)
      setMessage(
        'message' in outcome ? outcome.message : 'companyContactSaveFailed',
      )
    }
    void load(true)
  }

  return (
    <section className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t('companyContactsTitle')}</p>
          {canEdit && (
            <p className="text-xs text-muted">{t('companyContactsHint')}</p>
          )}
        </div>
        {canEdit && state === 'ready' && (
          <Button
            variant="outline"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => {
              setMessage(null)
              setEditing('new')
            }}
          >
            {t('companyContactAdd')}
          </Button>
        )}
      </div>
      {message && (
        <Notice tone="danger" size="compact" onDismiss={() => setMessage(null)}>
          {t(message)}
        </Notice>
      )}
      {state === 'loading' ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : state === 'error' ? (
        <ErrorState
          description={t('companyContactsLoadError')}
          onRetry={() => void load()}
          className="p-4"
        />
      ) : contacts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-sm text-muted">
          {t('companyContactsEmpty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {contacts.map((contact) => {
            const summary = companyContactSummary(contact)
            const projects = contact.projects
              .map((project) =>
                localizedName(lang, project.name_ar, project.name_en),
              )
              .filter(Boolean)
            return (
              <li
                key={contact.id}
                className="flex items-start gap-3 rounded-xl border bg-bg p-3"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-muted"
                >
                  <UserRound size={16} />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="break-words text-sm font-medium">
                    {contact.name}
                  </p>
                  {summary.length > 0 && (
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                      {summary.map((part) => (
                        <bdi key={part} dir="ltr">
                          {part}
                        </bdi>
                      ))}
                    </p>
                  )}
                  <p className="break-words text-xs text-muted">
                    {t('companyContactProjects')}:{' '}
                    {projects.length
                      ? projects.join('، ')
                      : t('companyContactAllProjects')}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={`${t('companyContactEdit')} ${contact.name}`}
                      title={t('companyContactEdit')}
                      icon={<Pencil size={15} />}
                      onClick={() => {
                        setMessage(null)
                        setEditing(contact)
                      }}
                    />
                    <IconButton
                      label={`${t('companyContactDelete')} ${contact.name}`}
                      title={t('companyContactDelete')}
                      icon={<Trash2 size={15} />}
                      disabled={deleting === contact.id}
                      onClick={() => void remove(contact)}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canEdit && (
        <CompanyContactFormDialog
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null)
          }}
          companyId={companyId}
          contact={editing && editing !== 'new' ? editing : null}
          onSaved={() => {
            setEditing(null)
            void load(true)
          }}
        />
      )}
      {confirmDialog}
    </section>
  )
}
