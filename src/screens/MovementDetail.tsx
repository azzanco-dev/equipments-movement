import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { Alert } from '@/components/Alert'
import { useAuth } from '@/auth/AuthContext'
import {
  LogIn,
  LogOut,
  Truck,
  Building2,
  MapPin,
  FileText,
  User,
  Clock,
  Camera,
  StickyNote,
  Link2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Trash2,
  Upload,
  RefreshCw,
  Pencil,
  Store,
} from 'lucide-react'
import type {
  EntryExitLog,
  Company,
  Project,
  EntryExitPhoto,
  MovementDriverChange,
} from '@/lib/types'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { sanitizeSearchTerm } from '@/lib/search'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import { localizedName } from '@/lib/localizedName'
import { uploadMovementPhotosDirectly } from '@/lib/movementPhotoUpload'
import { prepareMovementPhotos } from '@/lib/movementPhotoCompression'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  CONTRACTOR_CODE_MAX_LENGTH,
  contractorCodeErrorKey,
  contractorCodeUnchanged,
  isValidContractorCode,
  normalizeContractorCode,
} from '@/lib/contractorCodeEdit'
import {
  BackButton,
  Button,
  DescriptionList,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  InfoRow,
  Input,
  Lightbox,
  MovementBadge,
  PageHeader,
  Skeleton,
  WorkshopPurposeBadge,
  useConfirm,
  type DescriptionListItem,
  type LightboxItem,
} from '@/components/ui'

// Storage signed URLs are minted with a 3600s (60 min) expiry. Cached URLs
// are reused across re-fetches (add/delete photo, edit, driver change) and
// only re-requested once they are older than ~50 min, so switching photos or
// re-loading the movement never waits on a fresh signed URL unnecessarily.
const SIGNED_URL_REFRESH_AFTER_MS = 50 * 60 * 1000

interface MovementDetailProps {
  movementId: string
  onBack: () => void
  onNavigateMovement: (id: string) => void
}

export function MovementDetail({
  movementId,
  onBack,
  onNavigateMovement,
}: MovementDetailProps) {
  const { t, lang } = useI18n()
  const { user, profile } = useAuth()
  const { confirm, confirmDialog } = useConfirm()
  const [log, setLog] = useState<EntryExitLog | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [linkedLog, setLinkedLog] = useState<EntryExitLog | null>(null)
  const [linkedCompany, setLinkedCompany] = useState<Company | null>(null)
  const [linkedProject, setLinkedProject] = useState<Project | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoItems, setPhotoItems] = useState<
    (EntryExitPhoto & { url: string })[]
  >([])
  const [photoCarouselIndex, setPhotoCarouselIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // Signed URLs keyed by storage path, kept across re-fetches so navigating
  // or re-loading the movement never re-requests a still-fresh URL.
  const signedUrlCacheRef = useRef<
    Map<string, { url: string; fetchedAt: number }>
  >(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [linkedError, setLinkedError] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoActionError, setPhotoActionError] = useState<string | null>(null)
  const [driverChanges, setDriverChanges] = useState<MovementDriverChange[]>([])
  const [currentDriverMobileNumber, setCurrentDriverMobileNumber] = useState<
    string | null
  >(null)
  const [driverEntryId, setDriverEntryId] = useState<string | null>(null)
  const [driverChangeOpen, setDriverChangeOpen] = useState(false)
  const [newDriverId, setNewDriverId] = useState('')
  const [newDriverOption, setNewDriverOption] = useState<SelectOption | null>(
    null,
  )
  const [driverChangeNote, setDriverChangeNote] = useState('')
  const [driverChangeBusy, setDriverChangeBusy] = useState(false)
  const [driverChangeError, setDriverChangeError] = useState<string | null>(
    null,
  )
  const [editOpen, setEditOpen] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editEquipment, setEditEquipment] = useState<SelectOption | null>(null)
  const [editSupervisor, setEditSupervisor] = useState<SelectOption | null>(
    null,
  )
  const [editCompany, setEditCompany] = useState<SelectOption | null>(null)
  const [editProject, setEditProject] = useState<SelectOption | null>(null)
  const [editDriver, setEditDriver] = useState<SelectOption | null>(null)
  const [editRecordedAt, setEditRecordedAt] = useState('')
  const [editContractorCode, setEditContractorCode] = useState('')
  // Foreman edit of the contractor code on his own open site ENTRY
  // (migration 0093). Separate from the admin edit form above.
  const [codeEditOpen, setCodeEditOpen] = useState(false)
  const [codeEditValue, setCodeEditValue] = useState('')
  const [codeEditBusy, setCodeEditBusy] = useState(false)
  const [codeEditError, setCodeEditError] = useState<string | null>(null)
  const photoUrls = photoItems.map((item) => item.url)
  const lightboxItems: LightboxItem[] =
    photoUrls.length > 0
      ? photoItems.map((item) => ({ id: item.id, src: item.url }))
      : photoUrl
        ? [{ id: 'legacy-photo', src: photoUrl }]
        : []

  const startRequest = useListRequest()
  const fetchData = useCallback(async () => {
    const signal = startRequest()
    // Reset all movement-specific state so stale values from a previous
    // movement cannot bleed into the next one (especially when navigating
    // directly between linked ENTRY and EXIT records).
    setLog(null)
    setCompany(null)
    setProject(null)
    setLinkedLog(null)
    setLinkedCompany(null)
    setLinkedProject(null)
    setPhotoUrl(null)
    setPhotoItems([])
    setPhotoCarouselIndex(0)
    setLightboxOpen(false)
    setLinkedError(null)
    setDriverChanges([])
    setCurrentDriverMobileNumber(null)
    setDriverEntryId(null)
    setError(null)
    setLoading(true)

    try {
      const { data, error: fetchError } = await supabase
        .from('entry_exit_logs')
        .select(
          '*, equipment:equipment(*, lessor:lessors(name)), supervisor:profiles(*), driver:drivers(*), company:companies(id,name_ar,name_en,created_at), project:projects(id,name_ar,name_en,created_at)',
        )
        .eq('id', movementId)
        .abortSignal(signal)
        .maybeSingle()

      if (signal.aborted) return
      if (fetchError) throw fetchError
      if (!data) {
        setError(t('movementNotFound'))
        setLoading(false)
        return
      }

      const logData = data as EntryExitLog
      setLog(logData)
      setCompany(logData.company ?? null)
      setProject(logData.project ?? null)
      setCurrentDriverMobileNumber(logData.driver?.mobile_number ?? null)

      const loadDriverChanges = async (entryId: string) => {
        const { data: changes } = await supabase
          .from('movement_driver_changes')
          .select(
            'id,entry_log_id,previous_driver_id,previous_driver_name,new_driver_id,new_driver_name,changed_by,changed_at,note,changer:profiles!movement_driver_changes_changed_by_fkey(id,full_name,role,created_at)',
          )
          .eq('entry_log_id', entryId)
          .order('changed_at')
          .order('id')
          .abortSignal(signal)
        if (signal.aborted) return
        setDriverEntryId(entryId)
        setDriverChanges((changes as unknown as MovementDriverChange[]) ?? [])
        const latestChange = (changes as MovementDriverChange[] | null)?.at(-1)
        if (latestChange?.new_driver_id) {
          const { data: currentDriver } = await supabase
            .from('drivers')
            .select('mobile_number')
            .eq('id', latestChange.new_driver_id)
            .abortSignal(signal)
            .maybeSingle()
          if (signal.aborted) return
          setCurrentDriverMobileNumber(currentDriver?.mobile_number ?? null)
        }
      }

      await Promise.all([
        (async () => {
          // Fetch photo signed URLs — prefer new entry_exit_photos table,
          // fall back to legacy photo_url if no new photo rows exist.
          const { data: photoRows, error: photoErr } = await supabase
            .from('entry_exit_photos')
            .select('*')
            .eq('entry_exit_log_id', movementId)
            .order('sort_order', { ascending: true })
            .abortSignal(signal)

          if (signal.aborted) return
          if (photoErr) {
            console.error(photoErr)
          } else if (photoRows && photoRows.length > 0) {
            const cache = signedUrlCacheRef.current
            const now = Date.now()
            // Only (re)request paths that are missing or stale — a photo
            // that already has a fresh cached URL is never re-requested.
            const stalePaths = photoRows
              .map((photo) => photo.file_path)
              .filter((path) => {
                const cached = cache.get(path)
                return (
                  !cached ||
                  now - cached.fetchedAt > SIGNED_URL_REFRESH_AFTER_MS
                )
              })

            if (stalePaths.length > 0) {
              const { data: signed } = await supabase.storage
                .from('log-photos')
                .createSignedUrls(stalePaths, 3600)
              if (signal.aborted) return
              for (const item of signed ?? []) {
                if (item.path && item.signedUrl) {
                  cache.set(item.path, { url: item.signedUrl, fetchedAt: now })
                }
              }
            }

            const signedItems = (photoRows as EntryExitPhoto[]).map((photo) => {
              const url = cache.get(photo.file_path)?.url
              return url ? { ...photo, url } : null
            })
            setPhotoItems(
              signedItems.filter(
                (item): item is EntryExitPhoto & { url: string } =>
                  item !== null,
              ),
            )
          } else if (logData.photo_url) {
            const path = logData.photo_url
            const cache = signedUrlCacheRef.current
            const now = Date.now()
            const cached = cache.get(path)
            if (
              !cached ||
              now - cached.fetchedAt > SIGNED_URL_REFRESH_AFTER_MS
            ) {
              const { data: signed } = await supabase.storage
                .from('log-photos')
                .createSignedUrl(path, 3600)
              if (signal.aborted) return
              if (signed?.signedUrl)
                cache.set(path, { url: signed.signedUrl, fetchedAt: now })
            }
            const finalUrl = cache.get(path)?.url
            if (finalUrl) setPhotoUrl(finalUrl)
          }
        })(),
        (async () => {
          // Find linked movement using the same deterministic (recorded_at, id)
          // ordering as the database trigger, so ties on recorded_at are broken
          // by id consistently.
          if (logData.movement_type === 'entry') {
            await loadDriverChanges(logData.id)
            if (signal.aborted) return
            // Next EXIT: (recorded_at > entry) OR (recorded_at = entry AND id > entry.id)
            const { data: exitData, error: linkErr } = await supabase
              .from('entry_exit_logs')
              .select('*, supervisor:profiles(*)')
              .eq('equipment_id', logData.equipment_id)
              .eq('movement_context', logData.movement_context ?? 'site')
              .eq('movement_type', 'exit')
              .or(
                `recorded_at.gt.${logData.recorded_at},and(recorded_at.eq.${logData.recorded_at},id.gt.${logData.id})`,
              )
              .order('recorded_at', { ascending: true })
              .order('id', { ascending: true })
              .limit(1)
              .abortSignal(signal)
              .maybeSingle()

            if (signal.aborted) return
            if (linkErr) {
              setLinkedError(t('movementLoadError'))
            } else {
              setLinkedLog(exitData as EntryExitLog | null)
            }
          } else {
            // Preceding ENTRY: (recorded_at < exit) OR (recorded_at = exit AND id < exit.id)
            const { data: entryData, error: linkErr } = await supabase
              .from('entry_exit_logs')
              .select(
                '*, supervisor:profiles(*), company:companies(id,name_ar,name_en,created_at), project:projects(id,name_ar,name_en,created_at)',
              )
              .eq('equipment_id', logData.equipment_id)
              .eq('movement_context', logData.movement_context ?? 'site')
              .eq('movement_type', 'entry')
              .or(
                `recorded_at.lt.${logData.recorded_at},and(recorded_at.eq.${logData.recorded_at},id.lt.${logData.id})`,
              )
              .order('recorded_at', { ascending: false })
              .order('id', { ascending: false })
              .limit(1)
              .abortSignal(signal)
              .maybeSingle()

            if (signal.aborted) return
            if (linkErr) {
              setLinkedError(t('movementLoadError'))
            } else {
              const entryLog = entryData as EntryExitLog | null
              setLinkedLog(entryLog)
              setLinkedCompany(entryLog?.company ?? null)
              setLinkedProject(entryLog?.project ?? null)
              if (entryLog) await loadDriverChanges(entryLog.id)
            }
          }
        })(),
      ])
    } catch {
      if (!signal.aborted) setError(t('movementLoadError'))
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [movementId, t, startRequest])

  const loadDrivers = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      let request = supabase
        .from('drivers')
        .select('id,full_name,name_en,mobile_number')
        .order('full_name')
        .limit(20)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(
          `full_name.ilike.%${term}%,name_en.ilike.%${term}%,mobile_number.ilike.%${term}%`,
        )
      const { data } = await request
      return (data ?? []).map((driver) => ({
        value: driver.id,
        label: `${driver.full_name}${driver.name_en ? ` — ${driver.name_en}` : ''}${driver.mobile_number ? ` — ${driver.mobile_number}` : ''}`,
      }))
    },
    [],
  )

  const loadEquipment = useCallback(async (query: string) => {
    const term = sanitizeSearchTerm(query)
    let request = supabase
      .from('equipment')
      .select('id,code,type')
      .order('code')
      .limit(20)
    if (term) request = request.or(`code.ilike.%${term}%,type.ilike.%${term}%`)
    const { data } = await request
    return (data ?? []).map((item) => ({
      value: item.id,
      label: `${item.code} — ${item.type}`,
    }))
  }, [])

  const loadSupervisors = useCallback(async (query: string) => {
    const term = sanitizeSearchTerm(query)
    let request = supabase
      .from('profiles')
      .select('id,full_name')
      .in('role', ['admin', 'supervisor'])
      .order('full_name')
      .limit(20)
    if (term) request = request.ilike('full_name', `%${term}%`)
    const { data } = await request
    return (data ?? []).map((item) => ({
      value: item.id,
      label: item.full_name,
    }))
  }, [])

  const loadCompanies = useCallback(
    async (query: string) => {
      const term = sanitizeSearchTerm(query)
      let request = supabase
        .from('companies')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((item) => ({
        value: item.id,
        label: localizedName(lang, item.name_ar, item.name_en),
      }))
    },
    [lang],
  )

  const loadProjects = useCallback(
    async (query: string) => {
      const term = sanitizeSearchTerm(query)
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((item) => ({
        value: item.id,
        label: localizedName(lang, item.name_ar, item.name_en),
      }))
    },
    [lang],
  )

  const openEdit = () => {
    if (!log) return
    setEditEquipment(
      log.equipment
        ? {
            value: log.equipment.id,
            label: `${log.equipment.code} — ${log.equipment.type}`,
          }
        : null,
    )
    setEditSupervisor(
      log.supervisor
        ? { value: log.supervisor.id, label: log.supervisor.full_name }
        : null,
    )
    setEditCompany(
      company
        ? {
            value: company.id,
            label: localizedName(lang, company.name_ar, company.name_en),
          }
        : null,
    )
    setEditProject(
      project
        ? {
            value: project.id,
            label: localizedName(lang, project.name_ar, project.name_en),
          }
        : null,
    )
    setEditDriver(null)
    const date = new Date(log.recorded_at)
    setEditRecordedAt(
      new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16),
    )
    setEditContractorCode(log.contractor_equipment_code ?? '')
    setEditError(null)
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (
      !log ||
      !editEquipment ||
      !editSupervisor ||
      !editRecordedAt ||
      (!isWorkshopMovement && (!editCompany || !editProject))
    )
      return
    setEditBusy(true)
    setEditError(null)
    let response: Response
    try {
      const { data } = await supabase.auth.getSession()
      response = await fetch(`/api/movements/${log.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          equipment_id: editEquipment.value,
          supervisor_id: editSupervisor.value,
          recorded_at: new Date(editRecordedAt).toISOString(),
          company_id: editCompany?.value ?? null,
          project_id: editProject?.value ?? null,
          contractor_equipment_code: editContractorCode.trim() || null,
          driver_id: log.driver_id ? null : (editDriver?.value ?? null),
        }),
      })
    } catch (cause) {
      console.error('Movement edit request failed', cause)
      setEditError(t('movementEditFailed'))
      return
    } finally {
      setEditBusy(false)
    }
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      setEditError(
        result?.error === 'invalid_sequence'
          ? t('movementEditSequenceError')
          : t('movementEditFailed'),
      )
      return
    }
    setEditOpen(false)
    await fetchData()
  }

  const changeDriver = async () => {
    if (!driverEntryId || !newDriverId) return
    setDriverChangeBusy(true)
    setDriverChangeError(null)
    const { error: changeError } = await supabase.rpc(
      'change_active_movement_driver',
      {
        p_entry_log_id: driverEntryId,
        p_new_driver_id: newDriverId,
        p_note: driverChangeNote.trim() || null,
      },
    )
    setDriverChangeBusy(false)
    if (changeError) {
      setDriverChangeError(t('driverChangeFailed'))
      return
    }
    setDriverChangeOpen(false)
    setNewDriverId('')
    setNewDriverOption(null)
    setDriverChangeNote('')
    await fetchData()
  }

  const openContractorCodeEdit = () => {
    setCodeEditValue(log?.contractor_equipment_code ?? '')
    setCodeEditError(null)
    setCodeEditOpen(true)
  }

  // The database is authoritative: `update_entry_contractor_code` re-checks the
  // role, the ownership of the entry and that the visit is still open, and it
  // writes that single column only. The audit row is written by the existing
  // `audit_entry_exit_logs` trigger with the foreman as the actor.
  const saveContractorCode = async () => {
    if (!log) return
    if (!isValidContractorCode(codeEditValue)) {
      setCodeEditError(t('contractorCodeTooLong'))
      return
    }
    setCodeEditBusy(true)
    setCodeEditError(null)
    const { error: rpcError } = await supabase.rpc(
      'update_entry_contractor_code',
      {
        p_log_id: log.id,
        p_code: normalizeContractorCode(codeEditValue),
      },
    )
    setCodeEditBusy(false)
    if (rpcError) {
      setCodeEditError(t(contractorCodeErrorKey(rpcError.message)))
      return
    }
    setCodeEditOpen(false)
    await fetchData()
  }

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || photoItems.length >= 3) return
    const selected = Array.from(files)
    if (
      selected.length > 3 - photoItems.length ||
      selected.some(
        (file) =>
          file.size > 10 * 1024 * 1024 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type),
      )
    ) {
      setPhotoActionError(t('invalidPhotosForMovement'))
      return
    }
    setPhotoBusy(true)
    setPhotoActionError(null)
    let failureMessage: string | null = user
      ? null
      : t('photo_authorization_failed')
    try {
      if (user) {
        const prepared = await prepareMovementPhotos(selected)
        const uploadResults = await uploadMovementPhotosDirectly(
          movementId,
          prepared,
          user.id,
          photoItems.length,
        )
        for (const result of uploadResults) {
          if (!result.success && !failureMessage) {
            failureMessage = t(result.error ?? 'photoUploadFailed')
          }
        }
      }
    } catch (uploadError) {
      console.error(
        'Photo preparation or upload failed',
        uploadError instanceof Error ? uploadError.message : 'unknown_error',
      )
      failureMessage = t('photoCompressionFailed')
    } finally {
      setPhotoBusy(false)
    }
    if (failureMessage) {
      setPhotoActionError(failureMessage)
      await fetchData()
      return
    }
    await fetchData()
  }

  const deletePhoto = async (photoId: string) => {
    if (
      !(await confirm({
        title: t('confirmDeletePhoto'),
        description: t('dialogDescPhotoDelete'),
        tone: 'danger',
      }))
    )
      return
    setPhotoBusy(true)
    setPhotoActionError(null)
    let response: Response
    try {
      const { data } = await supabase.auth.getSession()
      response = await fetch(`/api/movements/${movementId}/photos`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ photoId }),
      })
    } catch (cause) {
      console.error('Photo delete request failed', cause)
      setPhotoActionError(t('photoDeleteFailed'))
      return
    } finally {
      setPhotoBusy(false)
    }
    if (!response.ok) {
      setPhotoActionError(t('photoDeleteFailed'))
      return
    }
    setPhotoCarouselIndex(0)
    await fetchData()
  }

  if (loading)
    return (
      <div
        className="space-y-2 py-2"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-4/5" />
      </div>
    )

  if (error) {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} label={t('backToMovements')} />
        <ErrorState title={error} />
      </div>
    )
  }

  if (!log) return null

  const isEntry = log.movement_type === 'entry'
  const isWorkshopMovement = log.movement_context === 'workshop'
  // A foreman may correct the contractor code on HIS OWN site ENTRY while the
  // visit is still open (`linkedLog` is the deterministically paired EXIT).
  // The same conditions are re-enforced in PostgreSQL by migration 0093.
  const canEditContractorCode =
    profile?.role === 'supervisor' &&
    isEntry &&
    !isWorkshopMovement &&
    !linkedLog &&
    log.supervisor_id === user?.id

  let durationMs = 0

  if (linkedLog) {
    if (linkedLog.movement_type === 'exit') {
      // log الحالي = دخول، linkedLog = خروج
      durationMs =
        new Date(linkedLog.recorded_at).getTime() -
        new Date(log.recorded_at).getTime()
    } else if (linkedLog.movement_type === 'entry') {
      // log الحالي = خروج، linkedLog = دخول
      durationMs =
        new Date(log.recorded_at).getTime() -
        new Date(linkedLog.recorded_at).getTime()
    }
  }

  const detailItems: DescriptionListItem[] = [
    {
      key: 'equipment',
      icon: <Truck size={16} />,
      label: t('equipmentNameLabel'),
      value: log.equipment
        ? `${log.equipment.code} — ${log.equipment.type}`
        : null,
    },
    ...(isWorkshopMovement && isEntry
      ? [
          {
            key: 'workshopPurpose',
            icon: <FileText size={16} />,
            label: t('workshopPurpose'),
            value:
              log.workshop_purpose === 'maintenance' ||
              log.workshop_purpose === 'parking' ? (
                <WorkshopPurposeBadge purpose={log.workshop_purpose} />
              ) : (
                t('pendingClassification')
              ),
          },
        ]
      : []),
    ...(!isWorkshopMovement
      ? [
          {
            key: 'contractorCode',
            icon: <FileText size={16} />,
            label: t('contractorEquipmentCode'),
            value: canEditContractorCode ? (
              <span className="flex items-center gap-1">
                <span
                  className={
                    log.contractor_equipment_code
                      ? ''
                      : 'text-muted font-normal'
                  }
                >
                  {log.contractor_equipment_code ?? '—'}
                </span>
                <IconButton
                  size="sm"
                  label={t('editContractorCode')}
                  icon={<Pencil size={14} />}
                  onClick={openContractorCodeEdit}
                />
              </span>
            ) : (
              log.contractor_equipment_code
            ),
          },
          ...(log.equipment?.ownership_status === 'external_supplier' &&
          log.equipment?.lessor?.name
            ? [
                {
                  key: 'lessor',
                  icon: <Store size={16} />,
                  label: t('lessor'),
                  value: log.equipment.lessor.name,
                },
              ]
            : []),
          {
            key: 'company',
            icon: <Building2 size={16} />,
            label: t('company'),
            value: company
              ? localizedName(lang, company.name_ar, company.name_en)
              : null,
          },
          {
            key: 'project',
            icon: <MapPin size={16} />,
            label: t('project'),
            value: project
              ? localizedName(lang, project.name_ar, project.name_en)
              : null,
          },
          {
            key: 'driver',
            icon: <User size={16} />,
            label: t('driverName'),
            value: (
              <>
                {(isEntry
                  ? driverChanges.at(-1)?.new_driver_name
                  : undefined) ??
                  log.driver?.full_name ??
                  log.driver_name ??
                  '—'}
                {currentDriverMobileNumber && (
                  <span
                    className="mt-0.5 block select-text text-muted"
                    dir="ltr"
                  >
                    <a href={`tel:${currentDriverMobileNumber}`}>
                      {currentDriverMobileNumber}
                    </a>
                  </span>
                )}
              </>
            ),
          },
        ]
      : []),
    ...(profile?.role === 'admin' ||
    profile?.role === 'monitor' ||
    (['workshop_manager', 'assistant_workshop_manager'].includes(
      profile?.role ?? '',
    ) &&
      isWorkshopMovement)
      ? [
          {
            key: 'supervisor',
            icon: <User size={16} />,
            label: t('supervisorName'),
            value: log.supervisor?.full_name,
          },
        ]
      : []),
    {
      key: 'movementDate',
      icon: <Clock size={16} />,
      label: t('movementDate'),
      value: formatDate(log.recorded_at),
    },
    ...(profile?.role === 'admin'
      ? [
          {
            key: 'createdAt',
            icon: <Clock size={16} />,
            label: t('createdAt'),
            value: log.created_at ? formatDateTime(log.created_at) : null,
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('movementDetails')}
        description={t('movementDetailsDesc')}
        onBack={onBack}
        backLabel={t('backToMovements')}
        actions={
          profile?.role === 'admin' ? (
            <Button
              type="button"
              variant="outline"
              icon={<Pencil size={16} />}
              onClick={openEdit}
            >
              {t('editMovement')}
            </Button>
          ) : undefined
        }
      />

      {editOpen && profile?.role === 'admin' && (
        <div className="card space-y-4">
          <h3 className="font-bold">{t('editMovement')}</h3>
          {editError && <Alert type="error">{editError}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('equipmentNameLabel')}>
              {() => (
                <AsyncSearchSelect
                  value={editEquipment?.value ?? ''}
                  selectedOption={editEquipment}
                  onChange={(_, option) => setEditEquipment(option)}
                  loadOptions={loadEquipment}
                />
              )}
            </Field>
            <Field label={t('supervisorName')}>
              {() => (
                <AsyncSearchSelect
                  value={editSupervisor?.value ?? ''}
                  selectedOption={editSupervisor}
                  onChange={(_, option) => setEditSupervisor(option)}
                  loadOptions={loadSupervisors}
                />
              )}
            </Field>
            <Field label={t('movementDate')}>
              {(control) => (
                <Input
                  {...control}
                  type="datetime-local"
                  value={editRecordedAt}
                  max={new Date().toISOString().slice(0, 16)}
                  onChange={(event) => setEditRecordedAt(event.target.value)}
                />
              )}
            </Field>
            {!isWorkshopMovement && (
              <Field label={t('contractorEquipmentCode')}>
                {(control) => (
                  <Input
                    {...control}
                    value={editContractorCode}
                    onChange={(event) =>
                      setEditContractorCode(event.target.value)
                    }
                  />
                )}
              </Field>
            )}
            {!isWorkshopMovement && (
              <Field label={t('company')}>
                {() => (
                  <AsyncSearchSelect
                    value={editCompany?.value ?? ''}
                    selectedOption={editCompany}
                    onChange={(_, option) => setEditCompany(option)}
                    loadOptions={loadCompanies}
                  />
                )}
              </Field>
            )}
            {!isWorkshopMovement && (
              <Field label={t('project')}>
                {() => (
                  <AsyncSearchSelect
                    value={editProject?.value ?? ''}
                    selectedOption={editProject}
                    onChange={(_, option) => setEditProject(option)}
                    loadOptions={loadProjects}
                  />
                )}
              </Field>
            )}
            {!isWorkshopMovement && !log.driver_id && (
              <Field label={t('driverName')}>
                {() => (
                  <AsyncSearchSelect
                    value={editDriver?.value ?? ''}
                    selectedOption={editDriver}
                    onChange={(_, option) => setEditDriver(option)}
                    loadOptions={loadDrivers}
                  />
                )}
              </Field>
            )}
          </div>
          {!isWorkshopMovement && log.driver_id && (
            <p className="text-xs text-muted">{t('existingDriverEditHint')}</p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" loading={editBusy} onClick={saveEdit}>
              {t('saveChanges')}
            </Button>
            <Button
              variant="outline"
              disabled={editBusy}
              onClick={() => setEditOpen(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Movement type banner */}
      <div
        className="flex items-center gap-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{
            backgroundColor: isEntry ? 'var(--entry-soft)' : 'var(--exit-soft)',
          }}
        >
          {isEntry ? (
            <LogIn size={20} style={{ color: 'var(--entry)' }} />
          ) : (
            <LogOut size={20} style={{ color: 'var(--exit)' }} />
          )}
        </div>
        <div>
          <p className="text-xs text-muted">{t('movementType')}</p>
          <MovementBadge
            type={isEntry ? 'entry' : 'exit'}
            withIcon
            className="mt-1"
          />
        </div>
      </div>

      {/* Main details card */}
      <div className="card">
        <h3 className="mb-2 text-sm font-bold text-muted">
          {t('movementDetails')}
        </h3>
        <DescriptionList items={detailItems} columns={2} />

        {/* Notes */}
        {log.notes && (
          <div
            className="mt-4 border-t pt-4"
            style={{ borderColor: 'var(--border)' }}
          >
            <InfoRow
              icon={<StickyNote size={16} />}
              label={t('notes')}
              value={<span className="whitespace-pre-wrap">{log.notes}</span>}
            />
          </div>
        )}

        {/* Photos */}
        <div
          className="mt-4 pt-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Camera size={16} className="text-muted" />
            <p className="text-xs text-muted">{t('photo')}</p>
          </div>
          {photoActionError && (
            <div className="mb-3">
              <Alert type="error">{photoActionError}</Alert>
            </div>
          )}
          {photoUrls.length > 0 ? (
            <div
              className="relative rounded-lg overflow-hidden"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                height: '320px',
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <img
                  src={photoUrls[photoCarouselIndex]}
                  alt={`${t('photoGalleryMainAlt')} ${photoCarouselIndex + 1}`}
                  className="max-h-full max-w-full object-contain cursor-zoom-in"
                  onClick={() => setLightboxOpen(true)}
                />
              </div>
              <button
                type="button"
                aria-label={t('photoGalleryOpenAria')}
                onClick={() => setLightboxOpen(true)}
                className="absolute top-1 end-1 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
              >
                <Maximize2 size={16} />
              </button>
              {profile?.role !== 'monitor' &&
                (photoItems[photoCarouselIndex]?.uploaded_by === user?.id ||
                  profile?.role === 'admin') && (
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={() =>
                      deletePhoto(photoItems[photoCarouselIndex].id)
                    }
                    className="absolute top-1 start-1 rounded-full bg-red-600/80 p-1.5 text-white hover:bg-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              {photoUrls.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setPhotoCarouselIndex(
                        (prev) =>
                          (prev - 1 + photoUrls.length) % photoUrls.length,
                      )
                    }
                    className="absolute start-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <ChevronLeft size={20} className="rtl-flip" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPhotoCarouselIndex(
                        (prev) => (prev + 1) % photoUrls.length,
                      )
                    }
                    className="absolute end-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
                  >
                    <ChevronRight size={20} className="rtl-flip" />
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white bg-black/50 rounded-full px-2 py-0.5">
                    {photoCarouselIndex + 1} / {photoUrls.length}
                  </span>
                </>
              )}
            </div>
          ) : photoUrl ? (
            <div
              className="relative rounded-lg overflow-hidden"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                height: '320px',
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <img
                  src={photoUrl}
                  alt={t('photoGalleryMainAlt')}
                  className="max-h-full max-w-full object-contain cursor-zoom-in"
                  onClick={() => setLightboxOpen(true)}
                />
              </div>
              <button
                type="button"
                aria-label={t('photoGalleryOpenAria')}
                onClick={() => setLightboxOpen(true)}
                className="absolute top-1 end-1 rounded-full p-1.5 bg-black/40 hover:bg-black/60 text-white transition-colors"
              >
                <Maximize2 size={16} />
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted italic">{t('noPhoto')}</p>
          )}
          {profile?.role !== 'monitor' && photoItems.length < 3 && (
            <label
              className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-sm hover:bg-surface-hover"
              style={{ borderColor: 'var(--border)' }}
            >
              <Upload size={16} />
              {photoBusy ? t('loading') : t('addPhoto')}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={photoBusy}
                onChange={(event) => {
                  addPhotos(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
          )}
        </div>
      </div>

      {driverEntryId && log.movement_context !== 'workshop' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">{t('driverChangeHistory')}</h3>
              <p className="text-xs text-muted">
                {t('currentDriver')}:{' '}
                {driverChanges.at(-1)?.new_driver_name ??
                  (isEntry ? log.driver_name : linkedLog?.driver_name) ??
                  '—'}
              </p>
            </div>
            {isEntry &&
              !linkedLog &&
              profile?.role !== 'workshop' &&
              profile?.role !== 'monitor' && (
                <Button
                  variant="outline"
                  icon={<RefreshCw size={16} />}
                  onClick={() => setDriverChangeOpen((value) => !value)}
                >
                  {t('changeDriver')}
                </Button>
              )}
          </div>
          {driverChangeOpen && (
            <div
              className="space-y-3 rounded-lg border p-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <Field label={t('newDriver')} required>
                {() => (
                  <AsyncSearchSelect
                    value={newDriverId}
                    selectedOption={newDriverOption}
                    onChange={(value, option) => {
                      setNewDriverId(value)
                      setNewDriverOption(option)
                    }}
                    loadOptions={loadDrivers}
                    placeholder={t('selectDriver')}
                  />
                )}
              </Field>
              <Field label={t('notes')}>
                {(control) => (
                  <Input
                    {...control}
                    value={driverChangeNote}
                    onChange={(event) =>
                      setDriverChangeNote(event.target.value)
                    }
                    placeholder={t('notesPlaceholder')}
                  />
                )}
              </Field>
              {driverChangeError && (
                <Alert type="error">{driverChangeError}</Alert>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDriverChangeOpen(false)}
                >
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!newDriverId}
                  loading={driverChangeBusy}
                  onClick={changeDriver}
                >
                  {t('save')}
                </Button>
              </div>
            </div>
          )}
          {driverChanges.length === 0 ? (
            <p className="text-sm text-muted">{t('noDriverChanges')}</p>
          ) : (
            <div className="space-y-2">
              {driverChanges.map((change) => (
                <div
                  key={change.id}
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="grid gap-1 sm:grid-cols-2">
                    <p>
                      <span className="text-muted">{t('previousDriver')}:</span>{' '}
                      <span className="font-medium" dir="auto">
                        {change.previous_driver_name}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted">{t('newDriver')}:</span>{' '}
                      <span className="font-medium" dir="auto">
                        {change.new_driver_name}
                      </span>
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatDateTime(change.changed_at)}
                    {change.changer?.full_name
                      ? ` — ${change.changer.full_name}`
                      : ''}
                  </p>
                  {change.note && <p className="mt-1 text-xs">{change.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Linked movement section */}
      {isEntry ? (
        <div className="card">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-muted">
            <Link2 size={16} /> {t('linkedExit')}
          </h3>
          {linkedError ? (
            <Alert type="error">{linkedError}</Alert>
          ) : linkedLog ? (
            <div className="space-y-2">
              <DescriptionList
                items={[
                  {
                    key: 'date',
                    icon: <Clock size={16} />,
                    label: t('movementDate'),
                    value: formatDate(linkedLog.recorded_at),
                  },
                  {
                    key: 'duration',
                    icon: <Clock size={16} />,
                    label: t('durationOnSite'),
                    value: formatElapsedDuration(durationMs, t, lang),
                  },
                ]}
              />
              <Button
                variant="outline"
                icon={<ExternalLink size={16} />}
                onClick={() => onNavigateMovement(linkedLog.id)}
                className="mt-2"
              >
                {t('viewDetails')}
              </Button>
            </div>
          ) : (
            <p className="text-sm italic text-muted">{t('notExitedYet')}</p>
          )}
        </div>
      ) : (
        <div className="card">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-muted">
            <Link2 size={16} /> {t('linkedEntry')}
          </h3>
          {linkedError ? (
            <Alert type="error">{linkedError}</Alert>
          ) : linkedLog ? (
            <div className="space-y-2">
              <DescriptionList
                items={[
                  {
                    key: 'date',
                    icon: <Clock size={16} />,
                    label: t('movementDate'),
                    value: formatDate(linkedLog.recorded_at),
                  },
                  ...(!isWorkshopMovement
                    ? [
                        {
                          key: 'company',
                          icon: <Building2 size={16} />,
                          label: t('company'),
                          value: linkedCompany
                            ? localizedName(
                                lang,
                                linkedCompany.name_ar,
                                linkedCompany.name_en,
                              )
                            : null,
                        },
                        {
                          key: 'project',
                          icon: <MapPin size={16} />,
                          label: t('project'),
                          value: linkedProject
                            ? localizedName(
                                lang,
                                linkedProject.name_ar,
                                linkedProject.name_en,
                              )
                            : null,
                        },
                        {
                          key: 'contractorCode',
                          icon: <FileText size={16} />,
                          label: t('contractorEquipmentCode'),
                          value: linkedLog.contractor_equipment_code,
                        },
                      ]
                    : []),
                  {
                    key: 'duration',
                    icon: <Clock size={16} />,
                    label: t('durationOnSite'),
                    value: formatElapsedDuration(durationMs, t, lang),
                  },
                ]}
              />
              <Button
                variant="outline"
                icon={<ExternalLink size={16} />}
                onClick={() => onNavigateMovement(linkedLog.id)}
                className="mt-2"
              >
                {t('viewDetails')}
              </Button>
            </div>
          ) : (
            <p className="text-sm italic text-muted">—</p>
          )}
        </div>
      )}

      <Lightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        items={lightboxItems}
        index={photoCarouselIndex}
        onIndexChange={setPhotoCarouselIndex}
      />

      {canEditContractorCode && (
        <Dialog
          open={codeEditOpen}
          onOpenChange={setCodeEditOpen}
          title={t('editContractorCode')}
          size="sm"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setCodeEditOpen(false)}
                disabled={codeEditBusy}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                loading={codeEditBusy}
                disabled={contractorCodeUnchanged(
                  codeEditValue,
                  log.contractor_equipment_code,
                )}
                onClick={saveContractorCode}
              >
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {codeEditError && <Alert type="error">{codeEditError}</Alert>}
            <Field label={t('contractorEquipmentCode')}>
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  dir="ltr"
                  value={codeEditValue}
                  maxLength={CONTRACTOR_CODE_MAX_LENGTH}
                  placeholder={t('contractorCodePlaceholder')}
                  onChange={(event) => setCodeEditValue(event.target.value)}
                />
              )}
            </Field>
          </div>
        </Dialog>
      )}

      {confirmDialog}
    </div>
  )
}
