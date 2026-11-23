import { useCallback, useEffect, useRef, useState } from 'react'
import { Landmark, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  SearchInput,
  Skeleton,
  useConfirm,
} from '@/components/ui'
import { Notice } from '@/components/ui/Notice'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useUrlSearchPage } from '@/components/data-list/useUrlSearchPage'
import { BankLogo } from '@/components/banks/BankLogo'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import { lessorsActions, refusedByPolicy } from '@/lib/actionPermissions'
import {
  BANK_DATABASE_RULES,
  BANK_FIELD_ORDER,
  bankInUse,
  bankUsageCount,
  banksSelect,
  type BankFormValues,
  type BankUsageRow,
} from '@/lib/banks'
import { bankLogoOf } from '@/lib/bankLogos'
import {
  bankFormSchema,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import { buildSearchFilter, NAME_SEARCH_FIELDS } from '@/lib/search'
import { supabase } from '@/lib/supabase'

type BankRow = {
  id: string
  name: string
  /** Every use the reader could read (suppliers, financiers, contracts). */
  usage: number
}
type BankQueryRow = BankUsageRow & { id: string; name: string }
const PAGE_SIZE = 20

/**
 * Settings › «البنوك» (migration 0177, owner 2026-11-05; redrawn as wide
 * tiles on 2026-11-23, approved in Figma): the banks list the supplier's and
 * the financier's bank is picked from. Server-side search and paging; each
 * bank a tile with its logo and name and, for `lessors.edit`, a «...» menu
 * with «تعديل» and «حذف» (the row policies re-check it and every write reads
 * its row back). A bank in use has «حذف» locked with its reason (`banksSelect`
 * reads the use the reader may see); the foreign keys refuse it anyway.
 * Renaming cascades to every supplier, financier and contract.
 */
export function BanksSettings() {
  const { t } = useI18n()
  const permissions = usePermissions()
  const canEdit = lessorsActions(permissions).edit
  const withInstallments = permissions.can('installments.view')
  const [rows, setRows] = useState<BankRow[]>([])
  const [total, setTotal] = useState(0)
  // `q` and `page` live in the URL (EM-121), so Back and reload restore them.
  const { page, setPage, search, searchInput, setSearchInput } =
    useUrlSearchPage()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BankRow | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [nameErrors, setNameErrors] = useState<FieldErrors<BankFormValues>>({})
  const formRef = useRef<HTMLDivElement>(null)
  const { confirm, confirmDialog } = useConfirm()
  const startRequest = useListRequest()

  const fetchRows = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('banks')
      .select(banksSelect(withInstallments), { count: 'exact' })
      .order('name')
      .order('id')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, search)
    if (searchFilter) query = query.or(searchFilter)
    const { data, error: fetchError, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (fetchError) setLoadError(t('banksLoadError'))
    setRows(
      ((data as unknown as BankQueryRow[] | null) ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        usage: bankUsageCount(row),
      })),
    )
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, startRequest, t, withInstallments])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const openForm = (row: BankRow | null) => {
    setEditing(row)
    setName(row?.name ?? '')
    setFormError(null)
    setNameErrors({})
    setModalOpen(true)
  }

  async function save() {
    const invalid = validateWithSchema(bankFormSchema, { name })
    if (hasErrors(invalid)) {
      setNameErrors(invalid)
      focusFirstError(invalid, BANK_FIELD_ORDER, { root: formRef.current })
      return
    }
    const clean = name.trim()
    setSaving(true)
    setFormError(null)
    const result = editing
      ? await supabase
          .from('banks')
          .update({ name: clean })
          .eq('id', editing.id)
          .select('id')
      : await supabase.from('banks').insert({ name: clean }).select('id')
    setSaving(false)
    if (refusedByPolicy(result.error, result.data)) {
      setFormError(t('bankSaveNotAllowed'))
      return
    }
    if (result.error) {
      const attributed = mapDatabaseErrorToField(
        result.error,
        BANK_DATABASE_RULES,
      )
      if (!attributed) {
        setFormError(t('saveFailed'))
        return
      }
      setNameErrors(attributed)
      focusFirstError(attributed, BANK_FIELD_ORDER, { root: formRef.current })
      return
    }
    setModalOpen(false)
    await fetchRows()
  }

  async function remove(row: BankRow) {
    setError(null)
    if (
      !(await confirm({
        title: t('confirmDeleteBankNamed').replace('{name}', row.name),
        description: t('dialogDescBankDelete'),
        tone: 'danger',
      }))
    )
      return
    const result = await supabase
      .from('banks')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (bankInUse(result.error)) {
      setError(t('bankInUse'))
      await fetchRows()
      return
    }
    if (refusedByPolicy(result.error, result.data)) {
      setError(t('bankSaveNotAllowed'))
      return
    }
    if (result.error) {
      setError(t('saveFailed'))
      return
    }
    await fetchRows()
  }

  const addButton = canEdit && (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={() => openForm(null)}
    >
      {t('addBank')}
    </Button>
  )

  // The dialog's logo follows the typed name: renaming a bank that has a
  // logo shows its initials, which the warning explains.
  const typedName = name.trim()
  const editingHasLogo = Boolean(editing && bankLogoOf(editing.name))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={searchInput}
          onValueChange={setSearchInput}
          placeholder={t('searchBanks')}
          className="max-w-md flex-1"
        />
        {addButton}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {loadError ? (
        <ErrorState description={loadError} onRetry={fetchRows} />
      ) : loading && rows.length === 0 ? (
        <ul
          aria-busy="true"
          aria-label={t('banks')}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <li
              key={index}
              className="flex items-center gap-3 rounded-xl border bg-bg p-3"
            >
              <Skeleton className="h-9 w-16" />
              <Skeleton variant="text" className="w-28" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Landmark size={28} aria-hidden="true" />}
          title={t('noBanks')}
          action={addButton || undefined}
        />
      ) : (
        <ul
          aria-label={t('banks')}
          aria-busy={loading || undefined}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-h-[62px] items-center gap-3 rounded-xl border bg-bg p-3"
            >
              <BankLogo name={row.name} />
              <span className="min-w-0 flex-1 text-sm font-semibold">
                {row.name}
              </span>
              {canEdit && (
                <BankOptionsMenu
                  row={row}
                  onEdit={() => openForm(row)}
                  onDelete={() => remove(row)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {!loadError && total > PAGE_SIZE && (
        <DataListPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPage={setPage}
        />
      )}
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? t('editBank') : t('addBank')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div ref={formRef} className="space-y-4">
          {formError && (
            <Notice tone="danger" size="compact">
              {formError}
            </Notice>
          )}
          <div className="flex justify-start">
            <BankLogo name={typedName || editing?.name || ''} size="lg" />
          </div>
          <Field
            label={t('bankNameLabel')}
            name="name"
            required
            error={nameErrors.name && t(nameErrors.name)}
            hint={
              !editing && typedName && !bankLogoOf(typedName)
                ? t('bankNewInitialsHint')
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setNameErrors({})
                }}
                placeholder={t('bankPlaceholder')}
              />
            )}
          </Field>
          {editing && (
            <Notice tone="info" size="compact">
              {t('bankRenameNotice')}
            </Notice>
          )}
          {editingHasLogo && (
            <Notice tone="warning" size="compact">
              {t('bankRenameLogoWarning')}
            </Notice>
          )}
        </div>
      </Dialog>
      {confirmDialog}
    </div>
  )
}

/** The tile's «...»: «تعديل», and «حذف» locked with its reason while the
 *  bank is in use. */
function BankOptionsMenu({
  row,
  onEdit,
  onDelete,
}: {
  row: BankRow
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const used = row.usage > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('bankOptions').replace('{name}', row.name)}
          icon={<MoreHorizontal size={16} aria-hidden="true" />}
          className="text-muted"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<Pencil size={15} />} onSelect={onEdit}>
          {t('edit')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Trash2 size={15} />}
          tone={used ? 'default' : 'danger'}
          disabled={used}
          onSelect={onDelete}
        >
          {used ? (
            <span className="flex min-w-0 flex-col">
              <span>{t('delete')}</span>
              <span className="max-w-56 whitespace-normal text-xs text-muted">
                {t('bankUsedCannotDelete')}
              </span>
            </span>
          ) : (
            t('delete')
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
