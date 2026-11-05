import { useCallback, useEffect, useRef, useState } from 'react'
import { Edit2, Landmark, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  SearchInput,
  useConfirm,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { Notice } from '@/components/ui/Notice'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useListRequest } from '@/components/data-list/useListRequest'
import { RelativeTime } from '@/components/RelativeTime'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import { lessorsActions, refusedByPolicy } from '@/lib/actionPermissions'
import {
  BANK_DATABASE_RULES,
  BANK_FIELD_ORDER,
  bankInUse,
  type BankFormValues,
} from '@/lib/banks'
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
  lessor_count: number
  updated_at: string
}
type BankQueryRow = {
  id: string
  name: string
  updated_at: string
  lessors: Array<{ count: number }>
}
const PAGE_SIZE = 20

/**
 * Settings › «البنوك» (migration 0177, owner 2026-11-05): the banks list the
 * supplier's bank is picked from. Server-side search and paging, the count
 * of suppliers on each bank, add / rename / delete for `lessors.edit` (the
 * row policies re-check it and every write reads its row back). Renaming
 * cascades to the suppliers; a bank in use cannot be deleted.
 */
export function BanksSettings() {
  const { t } = useI18n()
  const canEdit = lessorsActions(usePermissions()).edit
  const [rows, setRows] = useState<BankRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const fetchRows = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('banks')
      .select('id,name,updated_at,lessors(count)', { count: 'exact' })
      .order('name')
      .order('id')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, search)
    if (searchFilter) query = query.or(searchFilter)
    const { data, error: fetchError, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (fetchError) setLoadError(t('banksLoadError'))
    setRows(
      ((data as BankQueryRow[] | null) ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        lessor_count: row.lessors[0]?.count ?? 0,
        updated_at: row.updated_at,
      })),
    )
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, startRequest, t])

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
        title: t('confirmDeleteBank'),
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

  const columns: DataTableColumn<BankRow>[] = [
    {
      key: 'name',
      header: t('bankNameLabel'),
      className: 'font-semibold',
      cell: (row) => row.name,
    },
    {
      key: 'lessor_count',
      header: t('linkedLessorsCount'),
      cell: (row) => row.lessor_count,
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: t('actions'),
            cell: (row: BankRow) => (
              <span className="flex items-center gap-1">
                <IconButton
                  size="sm"
                  label={t('edit')}
                  title={t('edit')}
                  icon={<Edit2 size={15} />}
                  onClick={() => openForm(row)}
                />
                <IconButton
                  size="sm"
                  label={t('delete')}
                  title={t('delete')}
                  icon={<Trash2 size={15} />}
                  onClick={() => remove(row)}
                />
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'updated_at',
      header: t('updatedAt'),
      className: 'text-muted',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  const addButton = canEdit && (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={() => openForm(null)}
    >
      {t('addBank')}
    </Button>
  )

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
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<Landmark size={28} aria-hidden="true" />}
          title={t('noBanks')}
          action={addButton || undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          size="md"
          caption={t('banks')}
          empty={t('noBanks')}
        />
      )}
      {!loadError && total > 0 && (
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
        description={t('dialogDescBankForm')}
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
          <Field
            label={t('bankNameLabel')}
            name="name"
            required
            error={nameErrors.name && t(nameErrors.name)}
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
        </div>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
