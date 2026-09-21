import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronRight,
  Download,
  Edit2,
  List,
  Plus,
  Trash2,
  Upload,
  Warehouse,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import {
  Button,
  buttonClasses,
  cn,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  SearchInput,
  useConfirm,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
// Imported directly: Notice is not yet wired into the `ui` barrel
// (src/components/ui/index.ts), which is owned separately.
import { Notice } from '@/components/ui/Notice'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/lib/selectOption'
import { sanitizeSearchTerm } from '@/lib/search'
import { useListRequest } from '@/components/data-list/useListRequest'
import { RelativeTime } from '@/components/RelativeTime'

type EquipmentTypeRow = {
  id: string
  name: string
  equipment_count: number
  updated_at: string
}
type EquipmentTypeQueryRow = {
  id: string
  name: string
  updated_at: string
  equipment: Array<{ count: number }>
}
const PAGE_SIZE = 20

export function AdminSettings() {
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const showEquipmentTypes = pathname === '/settings/equipment-types'
  const showWorkshopOpening = pathname === '/settings/workshop-opening-balance'
  const [rows, setRows] = useState<EquipmentTypeRow[]>([])
  const [total, setTotal] = useState(0)
  const [typesCount, setTypesCount] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<EquipmentTypeRow | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [openingEquipmentId, setOpeningEquipmentId] = useState('')
  const [openingEquipment, setOpeningEquipment] = useState<SelectOption | null>(
    null,
  )
  const [openingSaving, setOpeningSaving] = useState(false)
  const [openingMessage, setOpeningMessage] = useState<string | null>(null)
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
      .from('equipment_types')
      .select('id,name,updated_at,equipment(count)', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    const term = sanitizeSearchTerm(search)
    if (term) query = query.ilike('name', `%${term}%`)
    const { data, error: fetchError, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (fetchError) setLoadError(t('equipmentTypesLoadError'))
    setRows(
      ((data as EquipmentTypeQueryRow[] | null) ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        equipment_count: row.equipment[0]?.count ?? 0,
        updated_at: row.updated_at,
      })),
    )
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, startRequest, t])

  useEffect(() => {
    supabase
      .from('equipment_types')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => setTypesCount(count ?? 0))
  }, [])

  useEffect(() => {
    if (showEquipmentTypes) fetchRows()
  }, [fetchRows, showEquipmentTypes])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setError(null)
    setModalOpen(true)
  }
  const openEdit = (row: EquipmentTypeRow) => {
    setEditing(row)
    setName(row.name)
    setError(null)
    setModalOpen(true)
  }

  async function save() {
    const clean = name.trim()
    if (!clean) {
      setError(t('equipmentTypeRequired'))
      return
    }
    const result = editing
      ? await supabase
          .from('equipment_types')
          .update({ name: clean })
          .eq('id', editing.id)
      : await supabase.from('equipment_types').insert({ name: clean })
    if (result.error) {
      setError(t('duplicateEquipmentType'))
      return
    }
    setModalOpen(false)
    await fetchRows()
  }

  async function remove(row: EquipmentTypeRow) {
    if (
      !(await confirm({
        title: t('confirmDeleteEquipmentType'),
        description: t('dialogDescEquipmentTypeDelete'),
        tone: 'danger',
      }))
    )
      return
    const { error: deleteError } = await supabase
      .from('equipment_types')
      .delete()
      .eq('id', row.id)
    if (deleteError) {
      setError(t('equipmentTypeInUse'))
      return
    }
    await fetchRows()
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.json_to_sheet([
      { [t('equipmentTypeName')]: 'حفار' },
    ])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Equipment Types')
    XLSX.writeFile(book, 'equipment-types-template.xlsx')
  }

  async function importExcel(file?: File) {
    if (!file) return
    setImporting(true)
    setError(null)
    let fileParsed = false
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = book.Sheets[book.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      })
      const importedNames = data
        .map((row) => String(Object.values(row)[0] ?? '').trim())
        .filter(Boolean)
      if (!importedNames.length) throw new Error('empty')
      fileParsed = true

      const uniqueNames = new Map<string, string>()
      importedNames.forEach((item) =>
        uniqueNames.set(item.toLocaleLowerCase(), item),
      )

      const { data: existingRows, error: existingError } = await supabase
        .from('equipment_types')
        .select('name')
      if (existingError) throw existingError
      const existingNames = new Set(
        (existingRows ?? []).map((row) => row.name.trim().toLocaleLowerCase()),
      )
      const namesToInsert = [...uniqueNames.entries()]
        .filter(([normalizedName]) => !existingNames.has(normalizedName))
        .map(([, item]) => ({ name: item }))

      if (namesToInsert.length) {
        const { error: insertError } = await supabase
          .from('equipment_types')
          .insert(namesToInsert)
        if (insertError) throw insertError
      }
      setPage(1)
      await fetchRows()
    } catch {
      setError(t(fileParsed ? 'saveFailed' : 'invalidEquipmentTypesFile'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const loadOpeningCandidates = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      const { data } = await supabase.rpc(
        'search_workshop_opening_candidates',
        { p_search: sanitizeSearchTerm(query) || null },
      )
      return (data ?? []).map(
        (item: {
          id: string
          code: string
          type: string
          plate_number: string | null
        }) => ({ value: item.id, label: `${item.code} — ${item.type}` }),
      )
    },
    [],
  )

  async function addOpeningBalance() {
    if (!openingEquipmentId) return
    setOpeningSaving(true)
    setOpeningMessage(null)
    const { error: openingError } = await supabase.rpc(
      'add_workshop_opening_balance',
      { p_equipment_id: openingEquipmentId },
    )
    setOpeningSaving(false)
    if (openingError) {
      setOpeningMessage(t('workshopOpeningFailed'))
      return
    }
    setOpeningEquipmentId('')
    setOpeningEquipment(null)
    setOpeningMessage(t('workshopOpeningSaved'))
  }

  if (showWorkshopOpening)
    return (
      <div className="space-y-4">
        <PageHeader
          title={t('workshopOpeningBalance')}
          description={t('workshopOpeningBalanceDesc')}
          onBack={() => router.push('/settings')}
          backLabel={t('backToSettings')}
        />
        {openingMessage && (
          <Notice
            tone={
              openingMessage === t('workshopOpeningSaved')
                ? 'success'
                : 'danger'
            }
          >
            {openingMessage}
          </Notice>
        )}
        <div className="card max-w-2xl space-y-4">
          <div>
            <label className="label">{t('equipment')} *</label>
            <AsyncSearchSelect
              value={openingEquipmentId}
              selectedOption={openingEquipment}
              onChange={(value, option) => {
                setOpeningEquipmentId(value)
                setOpeningEquipment(option)
                setOpeningMessage(null)
              }}
              loadOptions={loadOpeningCandidates}
              placeholder={t('selectEquipment')}
            />
          </div>
          <Button
            variant="primary"
            disabled={!openingEquipmentId}
            loading={openingSaving}
            onClick={addOpeningBalance}
          >
            {t('markInsideWorkshop')}
          </Button>
        </div>
      </div>
    )

  if (!showEquipmentTypes)
    return (
      <div className="space-y-4">
        <PageHeader title={t('settings')} description={t('settingsDesc')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => router.push('/settings/equipment-types')}
            className="card group flex min-h-36 flex-col items-start text-start transition-colors hover:bg-surface-hover"
          >
            <div className="mb-4 flex w-full items-start justify-between gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg border"
                style={{ borderColor: 'var(--border)' }}
              >
                <List size={18} />
              </span>
              <ChevronRight
                size={18}
                className="text-muted transition-transform group-hover:translate-x-[-2px] rtl-flip"
              />
            </div>
            <h2 className="font-semibold">{t('equipmentTypes')}</h2>
            <p className="mt-1 text-sm text-muted">{t('equipmentTypesDesc')}</p>
            <p className="mt-auto pt-4 text-xs text-muted">
              {typesCount === null
                ? t('loading')
                : t('itemsCount').replace('{count}', String(typesCount))}
            </p>
          </button>
          <button
            type="button"
            onClick={() => router.push('/settings/workshop-opening-balance')}
            className="card group flex min-h-36 flex-col items-start text-start transition-colors hover:bg-surface-hover"
          >
            <div className="mb-4 flex w-full items-start justify-between gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg border"
                style={{ borderColor: 'var(--border)' }}
              >
                <Warehouse size={18} />
              </span>
              <ChevronRight
                size={18}
                className="text-muted transition-transform group-hover:translate-x-[-2px] rtl-flip"
              />
            </div>
            <h2 className="font-semibold">{t('workshopOpeningBalance')}</h2>
            <p className="mt-1 text-sm text-muted">
              {t('workshopOpeningBalanceDesc')}
            </p>
          </button>
        </div>
      </div>
    )

  const columns: DataTableColumn<EquipmentTypeRow>[] = [
    {
      key: 'name',
      header: t('equipmentTypeName'),
      className: 'font-semibold',
      cell: (row) => row.name,
    },
    {
      key: 'equipment_count',
      header: t('linkedEquipmentCount'),
      cell: (row) => row.equipment_count,
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (row) => (
        <span className="flex items-center gap-1">
          <IconButton
            size="sm"
            label={t('edit')}
            title={t('edit')}
            icon={<Edit2 size={15} />}
            onClick={() => openEdit(row)}
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
    {
      key: 'updated_at',
      header: t('updatedAt'),
      className: 'text-muted',
      cell: (row) => <RelativeTime value={row.updated_at} />,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('equipmentTypes')}
        description={t('equipmentTypesDesc')}
        onBack={() => router.push('/settings')}
        backLabel={t('backToSettings')}
        actions={
          <>
            <Button
              variant="outline"
              icon={<Download size={16} aria-hidden="true" />}
              onClick={downloadTemplate}
            >
              {t('downloadTemplate')}
            </Button>
            <label
              className={cn(
                buttonClasses({ variant: 'outline' }),
                'cursor-pointer',
              )}
            >
              <Upload size={16} aria-hidden="true" />
              {importing ? t('loading') : t('importExcel')}
              <input
                ref={fileRef}
                className="hidden"
                type="file"
                accept=".xlsx,.xls"
                disabled={importing}
                onChange={(event) => importExcel(event.target.files?.[0])}
              />
            </label>
            <Button
              variant="primary"
              icon={<Plus size={16} aria-hidden="true" />}
              onClick={openCreate}
            >
              {t('addEquipmentType')}
            </Button>
          </>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="space-y-3">
        <SearchInput
          value={searchInput}
          onValueChange={setSearchInput}
          placeholder={t('searchEquipmentTypes')}
          className="max-w-md"
        />
        {loadError ? (
          <ErrorState description={loadError} onRetry={fetchRows} />
        ) : !loading && rows.length === 0 ? (
          <EmptyState
            icon={<List size={28} aria-hidden="true" />}
            title={t('noEquipmentTypes')}
            action={
              <Button
                variant="primary"
                icon={<Plus size={16} aria-hidden="true" />}
                onClick={openCreate}
              >
                {t('addEquipmentType')}
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={loading}
            loadingRows={6}
            size="md"
            caption={t('equipmentTypes')}
            empty={t('noEquipmentTypes')}
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
      </div>
      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? t('editEquipmentType') : t('addEquipmentType')}
        description={t('dialogDescEquipmentTypeForm')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" onClick={save}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <Notice tone="danger" size="compact">
              {error}
            </Notice>
          )}
          <Field label={t('equipmentTypeName')} required>
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('equipmentTypePlaceholder')}
              />
            )}
          </Field>
        </div>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
