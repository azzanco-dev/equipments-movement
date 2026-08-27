import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import {
  ChevronLeft,
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
import { PageHeader } from '@/components/PageHeader'
import { Modal } from '@/components/Modal'
import { Alert } from '@/components/Alert'
import { InlineSpinner } from '@/components/Spinner'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { sanitizeSearchTerm } from '@/lib/search'

type EquipmentTypeRow = { id: string; name: string }
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
  const [loading, setLoading] = useState(true)
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

  const fetchRows = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('equipment_types')
      .select('id,name', { count: 'exact' })
      .order('name')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (search.trim()) query = query.ilike('name', `%${search.trim()}%`)
    const { data, count } = await query
    setRows((data as EquipmentTypeRow[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search])

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
    if (!confirm(t('confirmDeleteEquipmentType'))) return
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

  function downloadTemplate() {
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
        <button className="btn-ghost" onClick={() => router.push('/settings')}>
          <ChevronLeft size={16} className="rtl-flip" />
          {t('backToSettings')}
        </button>
        <PageHeader
          title={t('workshopOpeningBalance')}
          description={t('workshopOpeningBalanceDesc')}
        />
        {openingMessage && (
          <Alert
            type={
              openingMessage === t('workshopOpeningSaved') ? 'success' : 'error'
            }
          >
            {openingMessage}
          </Alert>
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
          <button
            className="btn-primary"
            disabled={!openingEquipmentId || openingSaving}
            onClick={addOpeningBalance}
          >
            {openingSaving ? t('saving') : t('markInsideWorkshop')}
          </button>
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
            className="card group flex min-h-36 flex-col items-start text-start transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
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
            className="card group flex min-h-36 flex-col items-start text-start transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
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

  return (
    <div className="space-y-4">
      <button className="btn-ghost" onClick={() => router.push('/settings')}>
        <ChevronLeft size={16} className="rtl-flip" />
        {t('backToSettings')}
      </button>
      <PageHeader
        title={t('equipmentTypes')}
        description={t('equipmentTypesDesc')}
      />
      {error && <Alert type="error">{error}</Alert>}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{t('equipmentTypes')}</h2>
          <div className="flex flex-wrap gap-2">
            <button className="btn-outline" onClick={downloadTemplate}>
              <Download size={16} />
              {t('downloadTemplate')}
            </button>
            <label className="btn-outline cursor-pointer">
              <Upload size={16} />
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
            <button className="btn-primary" onClick={openCreate}>
              <Plus size={16} />
              {t('addEquipmentType')}
            </button>
          </div>
        </div>
        <input
          className="input max-w-md"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
          placeholder={t('searchEquipmentTypes')}
        />
        {loading ? (
          <InlineSpinner label={t('loading')} />
        ) : (
          <div
            className="overflow-hidden rounded-lg border"
            style={{ borderColor: 'var(--border)' }}
          >
            <table className="compact-table w-full text-sm">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <th className="table-header px-3 py-2 text-start">
                    {t('equipmentTypeName')}
                  </th>
                  <th className="table-header px-3 py-2 text-start">
                    {t('actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          className="btn-ghost p-1.5"
                          onClick={() => openEdit(row)}
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          className="btn-ghost p-1.5 text-red-600"
                          onClick={() => remove(row)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DataListPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPage={setPage}
        />
      </div>
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t('editEquipmentType') : t('addEquipmentType')}
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="label">{t('equipmentTypeName')} *</label>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('equipmentTypePlaceholder')}
            />
          </div>
          <div className="flex gap-2">
            <button
              className="btn-outline flex-1"
              onClick={() => setModalOpen(false)}
            >
              {t('cancel')}
            </button>
            <button className="btn-primary flex-1" onClick={save}>
              {t('save')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
