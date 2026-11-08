import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  Input,
  useConfirm,
} from '@/components/ui'
import {
  PartyFormSection,
  type PartyFieldSpec,
} from '@/components/parties/PartyFormSection'
import { PartyDocumentsSection } from '@/components/parties/PartyDocumentsSection'
import {
  partyDocumentLabel,
  type DraftPartyDocument,
  type SavedDocumentUploads,
} from '@/lib/partyDocuments'
import { uploadDraftDocuments } from '@/lib/partyDocumentsData'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import {
  CHANGED_CONTROL_CLASS,
  ChangedLabel,
} from '@/components/parties/changedField'
import { usePermissions } from '@/auth/PermissionsContext'
import { bankOptionLoader } from '@/lib/banks'
import { BankLogo } from '@/components/banks/BankLogo'
import { changedFields } from '@/lib/formChanges'
import { useI18n } from '@/i18n/I18nContext'
import { lessorsActions, refusedByPolicy } from '@/lib/actionPermissions'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_LESSOR_FORM,
  LESSOR_FIELD_ORDER,
  buildLessorPayload,
  lessorFormValues,
  lessorSaveFieldErrors,
  validateLessorForm,
  type LessorFormValues,
} from '@/lib/lessorForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import type { Lessor } from '@/lib/types'

/** EM-260 (0175): «بيانات رسمية», then the contact details, then the bank. */
const OFFICIAL_FIELDS: readonly PartyFieldSpec<LessorFormValues>[] = [
  {
    field: 'commercial_register',
    label: 'commercialRegister',
    placeholder: 'commercialRegisterPlaceholder',
    ltr: true,
    inputMode: 'numeric',
  },
  {
    field: 'tax_number',
    label: 'taxNumber',
    placeholder: 'taxNumberPlaceholder',
    ltr: true,
    inputMode: 'numeric',
  },
  // Owner 2026-11-05 «شيل المدينة, العنوان خليه العنوان الكامل»: no city
  // field (the column was dropped by migration 0181).
  // 0179: the short national address, split «RRRD | 2929».
  {
    field: 'short_address',
    label: 'shortAddress',
    control: 'shortAddress',
  },
  {
    field: 'address',
    label: 'address',
    placeholder: 'addressPlaceholder',
    wide: true,
  },
]
const CONTACT_FIELDS: readonly PartyFieldSpec<LessorFormValues>[] = [
  {
    field: 'contact_person',
    label: 'contactPerson',
    placeholder: 'contactPersonPlaceholder',
  },
  {
    field: 'contact_number',
    label: 'contactNumber',
    placeholder: 'contactNumberPlaceholder',
    ltr: true,
    type: 'tel',
  },
  {
    field: 'email',
    label: 'email',
    placeholder: 'partyEmailPlaceholder',
    ltr: true,
    type: 'email',
    wide: true,
  },
]
/** The bank itself is picked from the banks list (0177), above the IBAN. */
const BANK_FIELDS: readonly PartyFieldSpec<LessorFormValues>[] = [
  { field: 'iban', label: 'iban', placeholder: 'ibanPlaceholder', ltr: true },
]

export interface LessorFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null adds a new lessor; a record edits it. */
  lessor: Lessor | null
  /**
   * After a save; a NEW supplier passes its id (its details open next)
   * and what became of the files picked in the add form.
   */
  onSaved: (createdId?: string, uploads?: SavedDocumentUploads) => void
}

export function LessorFormDialog({
  open,
  onOpenChange,
  lessor,
  onSaved,
}: LessorFormDialogProps) {
  const { t } = useI18n()
  // Adding and editing need `lessors.edit` (the row policies re-check it):
  // without the key the dialog offers no save.
  const canSave = lessorsActions(usePermissions()).edit
  const notAllowed = t('lessorSaveNotAllowed')
  const [form, setForm] = useState<LessorFormValues>(EMPTY_LESSOR_FORM)
  // The values the dialog opened with, to tell the user what is unsaved.
  const [initial, setInitial] = useState<LessorFormValues>(EMPTY_LESSOR_FORM)
  const { confirm, confirmDialog } = useConfirm()
  const [saving, setSaving] = useState(false)
  // Owner 2026-11-08 («المورد ينحفظ, وبعده ترتفع الملفات مباشرة»): the add
  // form only PICKS the files; they go up one by one after the save.
  const [drafts, setDrafts] = useState<DraftPartyDocument[]>([])
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<LessorFormValues>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  // Owner 2026-11-05 (approved on /ui-kit «شعارات البنوك»): every bank
  // with its logo, in the list and in the closed field.
  const loadBanks = useMemo(() => {
    const load = bankOptionLoader(supabase)
    return async (query: string) =>
      (await load(query)).map((option) => ({
        ...option,
        icon: <BankLogo name={option.value} size="sm" />,
      }))
  }, [])

  useEffect(() => {
    if (!open) return
    const start = lessor ? lessorFormValues(lessor) : EMPTY_LESSOR_FORM
    setForm(start)
    setInitial(start)
    setError(null)
    setErrors({})
    setDrafts([])
    setUploading(null)
  }, [open, lessor])

  /** Editing a field clears its message; nothing is validated while typing. */
  const update = (patch: Partial<LessorFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(
        current,
        Object.keys(patch) as (keyof LessorFormValues)[],
      ),
    )
  }

  const save = async () => {
    if (!canSave) {
      setError(notAllowed)
      return
    }
    const invalid = validateLessorForm(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      setError(null)
      focusFirstError(invalid, LESSOR_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    setError(null)
    const payload = buildLessorPayload(form)
    // Without the key an update matches no row and PostgREST answers with no
    // error, so the returned rows are read: none back is a refusal.
    const result = lessor
      ? await supabase
          .from('lessors')
          .update(payload)
          .eq('id', lessor.id)
          .select('id')
      : await supabase.from('lessors').insert(payload).select('id')
    setSaving(false)
    if (refusedByPolicy(result.error, result.data)) {
      setError(notAllowed)
      return
    }
    if (result.error) {
      // A duplicate or malformed 0175 value belongs on its field; anything
      // else stays a safe top-level message.
      const attributed = lessorSaveFieldErrors(result.error)
      if (attributed) {
        setErrors(attributed)
        focusFirstError(attributed, LESSOR_FIELD_ORDER, {
          root: bodyRef.current,
        })
        return
      }
      setError(t('saveFailed'))
      return
    }
    // The record is saved: its picked files go up now. A failed one never
    // undoes the record — its details open and name it.
    const createdId = lessor ? undefined : (result.data?.[0]?.id as string | undefined)
    let uploads: SavedDocumentUploads | undefined
    if (createdId && drafts.length > 0) {
      setUploading({ done: 0, total: drafts.length })
      const outcome = await uploadDraftDocuments('lessor', createdId, drafts, (done) =>
        setUploading({ done, total: drafts.length }),
      )
      setUploading(null)
      uploads = {
        uploaded: outcome.uploaded,
        failed: outcome.failed.map((draft) => partyDocumentLabel(draft.type, draft.title, t)),
      }
    }
    onOpenChange(false)
    // 0182 (owner «الاولى»): a new supplier opens on its documents.
    onSaved(createdId, uploads)
  }

  const shownError = error ?? (canSave ? null : notAllowed)

  // Owner 2026-11-05 («لما يضاف تعديل جديد في احد الحقول, عطني شي يعلمني …
  // تنبيه عام, او في زر الحفظ»): the footer says how many fields are
  // unsaved, the save button reads «حفظ التعديلات» and an unchanged record
  // cannot be saved; closing with unsaved changes asks first.
  // Owner 2026-11-05 («تعلم لون على الحقل الي تعدل»): each changed field is
  // coloured too, until it is saved or set back.
  // Only when editing a record (owner «مايحتاج تسوي حق التعديلات في حال
  // بسوي مستند جديد»): a new record shows no marks and closes without asking.
  const changedSet = new Set<string>(lessor ? changedFields(initial, form) : [])
  const changed = changedSet.size
  const dirty = changed > 0

  const requestClose = async () => {
    // Never while the record or its files are being saved.
    if (saving || uploading) return
    if (
      (dirty || (!lessor && drafts.length > 0)) &&
      canSave &&
      !(await confirm({
        title: t('unsavedChanges'),
        description: t('dialogDescUnsavedChanges'),
        tone: 'danger',
      }))
    )
      return
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}
      title={lessor ? t('editLessor') : t('addLessor')}
      description={t('dialogDescLessorForm')}
      size="lg"
      footer={
        <>
          {uploading && (
            <span
              role="status"
              className="me-auto self-center text-sm font-medium text-[var(--info)]"
            >
              {t('partyDocUploadingProgress')
                .replace('{done}', String(Math.min(uploading.done + 1, uploading.total)))
                .replace('{total}', String(uploading.total))}
            </span>
          )}
          {canSave && dirty && !uploading && (
            <span
              role="status"
              className="me-auto flex items-center gap-2 self-center text-sm font-medium text-[var(--warning)]"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-[var(--warning)]"
              />
              {t('unsavedFieldsCount').replace('{count}', String(changed))}
            </span>
          )}
          <Button
            variant="outline"
            disabled={saving || uploading !== null}
            onClick={() => void requestClose()}
          >
            {t('cancel')}
          </Button>
          {canSave && (
            <Button
              variant="primary"
              loading={saving || uploading !== null}
              disabled={!!lessor && !dirty}
              onClick={save}
            >
              {lessor ? t('saveChanges') : t('save')}
            </Button>
          )}
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {shownError && <ErrorState title={shownError} className="p-4" />}
        <Field
          label={
            <ChangedLabel
              label={t('lessorName')}
              changed={changedSet.has('name')}
            />
          }
          name="name"
          required
          error={errors.name && t(errors.name)}
        >
          {(control) => (
            <Input
              {...control}
              className={
                changedSet.has('name') ? CHANGED_CONTROL_CLASS : undefined
              }
              placeholder={t('lessorNamePlaceholder')}
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          )}
        </Field>
        <PartyFormSection
          title="partyOfficialSection"
          fields={OFFICIAL_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
          changed={changedSet}
        />
        <PartyFormSection
          title="partyContactSection"
          fields={CONTACT_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
          changed={changedSet}
        />
        <PartyFormSection
          title="partyBankSection"
          fields={BANK_FIELDS}
          form={form}
          errors={errors}
          onChange={update}
          changed={changedSet}
          leading={
            <Field
              label={
                <ChangedLabel
                  label={t('bankName')}
                  changed={changedSet.has('bank_name')}
                />
              }
              name="bank_name"
              error={errors.bank_name && t(errors.bank_name)}
            >
              {(control) => (
                <AsyncSearchSelect
                  {...control}
                  size="md"
                  menuSide="top"
                  // The selector's trigger has no tint of its own: a ring.
                  className={
                    changedSet.has('bank_name')
                      ? 'rounded-lg ring-2 ring-[color-mix(in_srgb,var(--info)_55%,transparent)]'
                      : undefined
                  }
                  value={form.bank_name}
                  selectedOption={
                    form.bank_name
                      ? {
                          value: form.bank_name,
                          label: form.bank_name,
                          icon: <BankLogo name={form.bank_name} size="sm" />,
                        }
                      : null
                  }
                  onChange={(value) => update({ bank_name: value })}
                  loadOptions={loadBanks}
                  placeholder={t('bankNamePlaceholder')}
                />
              )}
            </Field>
          }
        />
        {/* Owner 2026-11-08 («ليش ماتضيف اضافة المستندات لdialog التعديل»):
            editing a record shows its documents too. Files are saved the
            moment they are uploaded, apart from the form's save, so they
            never count as unsaved changes. A new record has no id yet: it
            uploads from its details after the first save. */}
        {lessor && (
          <PartyDocumentsSection
            key={lessor.id}
            kind="lessor"
            partyId={lessor.id}
            canEdit={canSave}
            hint={t('partyDocSavedDirectly')}
          />
        )}
        {!lessor && canSave && (
          <PartyDocumentsSection
            key="new"
            kind="lessor"
            draft={{ items: drafts, onChange: setDrafts }}
            canEdit
            hint={t('partyDocDraftHint')}
          />
        )}
      </div>
      {confirmDialog}
    </Dialog>
  )
}
