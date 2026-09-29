import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import {
  Building2,
  Clock,
  ExternalLink,
  FileText,
  Hash,
  Link2,
  MapPin,
  Pencil,
  StickyNote,
  Store,
  Timer,
  Wrench,
} from 'lucide-react'
import type {
  EntryExitLog,
  Company,
  Project,
  EntryExitPhoto,
  MovementDriverChange,
} from '@/lib/types'
import type { SelectOption } from '@/components/Select'
import { sanitizeSearchTerm } from '@/lib/search'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import { saudiDateKey } from '@/lib/saudiTime'
import { localizedName } from '@/lib/localizedName'
import { uploadMovementPhotosDirectly } from '@/lib/movementPhotoUpload'
import { prepareMovementPhotos } from '@/lib/movementPhotoCompression'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  BackButton,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DetailHeader,
  ErrorState,
  InfoGrid,
  InfoGridSection,
  Lightbox,
  MovementBadge,
  Notice,
  SectionHeader,
  WorkshopPurposeBadge,
  useConfirm,
  type InfoGridItem,
  type LightboxItem,
  type PhotoGalleryItem,
} from '@/components/ui'
// wave7-A — sections extracted from this screen onto the approved
// DetailHeader/InfoGrid layout.
import { ContractorCodeDialog } from '@/components/movement/detail/ContractorCodeDialog'
import { MovementDriverSection } from '@/components/movement/detail/MovementDriverSection'
import { MovementPhotosPanel } from '@/components/movement/detail/MovementPhotosPanel'
// wave6-J3/J4 — admin-only header menu: the single correction dialog, or
// delete the movement. Both are authoritative in PostgreSQL (0104/0105).
import { MovementAdminMenu } from '@/components/movement/MovementAdminMenu'
import { MovementDetailSkeleton } from '@/components/movement/MovementDetailSkeleton'
import { MovementEditDialog } from '@/components/movement/MovementEditDialog'
import {
  movementAdminErrorKey,
  movementDriverEditMode,
} from '@/lib/movementAdmin'

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
  // Id of the movement whose data is currently on screen (null until loaded).
  const loadedMovementIdRef = useRef<string | null>(null)
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
  // wave6-J3/J4 — the single admin correction dialog and the admin delete,
  // behind the header menu (migrations 0104/0105).
  const router = useRouter()
  const [detailsEditOpen, setDetailsEditOpen] = useState(false)
  // Partial success of the correction dialog (the correction was stored but
  // the appended driver change failed). Survives the refetch.
  const [editWarning, setEditWarning] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  // Foreman edit of the contractor code on his own open site ENTRY
  // (migration 0093). Separate from the admin correction dialog.
  const [codeEditOpen, setCodeEditOpen] = useState(false)
  const lightboxItems: LightboxItem[] =
    photoItems.length > 0
      ? photoItems.map((item) => ({ id: item.id, src: item.url }))
      : photoUrl
        ? [{ id: 'legacy-photo', src: photoUrl }]
        : []
  // The same photos for the shared gallery: new `entry_exit_photos` rows, or
  // the single legacy `photo_url` photo, which stays readable.
  const galleryPhotos: PhotoGalleryItem[] = lightboxItems.map((item) => ({
    id: item.id,
    src: item.src,
    status: 'ready',
  }))

  const startRequest = useListRequest()
  const fetchData = useCallback(async () => {
    const signal = startRequest()
    // A refetch of the movement that is already on screen (after an edit, a
    // photo or a driver change) keeps the current page visible: no skeleton,
    // and each section is overwritten when its new data arrives. Only a first
    // load or a switch to another movement resets all movement-specific state,
    // so stale values cannot bleed into the next one (especially when
    // navigating directly between linked ENTRY and EXIT records).
    const isRefetch = loadedMovementIdRef.current === movementId
    if (!isRefetch) {
      loadedMovementIdRef.current = null
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
      setDriverChanges([])
      setCurrentDriverMobileNumber(null)
      setDriverEntryId(null)
      setLoading(true)
    }
    setLinkedError(null)
    setError(null)

    try {
      // wave7-A — the recorder's name comes from `profile_names` (migration
      // 0099: id, full_name, role only), not `profiles`: `select_profiles`
      // hides other users' profile rows from non-admin roles, so the old
      // `supervisor:profiles(*)` embed came back empty for them (and read
      // every profile column for admins). PostgREST resolves the embed
      // through the view via the `entry_exit_logs_supervisor_id_fkey` FK to
      // `profiles(id)`; `entry_exit_logs` RLS still decides which movement
      // is returned at all.
      const { data, error: fetchError } = await supabase
        .from('entry_exit_logs')
        .select(
          '*, equipment:equipment(*, lessor:lessors(name)), supervisor:profile_names!entry_exit_logs_supervisor_id_fkey(id,full_name), driver:drivers(*), company:companies(id,name_ar,name_en,created_at), project:projects(id,name_ar,name_en,created_at)',
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
      loadedMovementIdRef.current = movementId
      setLog(logData)
      setCompany(logData.company ?? null)
      setProject(logData.project ?? null)
      setCurrentDriverMobileNumber(logData.driver?.mobile_number ?? null)

      const loadDriverChanges = async (entryId: string) => {
        const { data: changes } = await supabase
          .from('movement_driver_changes')
          .select(
            'id,entry_log_id,previous_driver_id,previous_driver_name,new_driver_id,new_driver_name,changed_by,changed_at,note,changer:profile_names!movement_driver_changes_changed_by_fkey(id,full_name,role)',
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
            setPhotoUrl(null)
            setPhotoItems(
              signedItems.filter(
                (item): item is EntryExitPhoto & { url: string } =>
                  item !== null,
              ),
            )
          } else if (logData.photo_url) {
            setPhotoItems([])
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
          } else {
            setPhotoItems([])
            setPhotoUrl(null)
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
              .select('*')
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
                '*, company:companies(id,name_ar,name_en,created_at), project:projects(id,name_ar,name_en,created_at)',
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

  // The database is authoritative: `admin_delete_movement` (migration 0104)
  // re-checks the admin role, refuses any movement that is not the last one of
  // its (equipment, context) sequence, removes the driver-change and photo
  // rows and writes the audit rows. The API route then removes the Storage
  // objects; a leftover object is reported, never treated as a failed delete,
  // because the movement row is already gone.
  const deleteMovement = async () => {
    setDeleteBusy(true)
    setDeleteError(null)
    let response: Response
    try {
      const { data } = await supabase.auth.getSession()
      response = await fetch(`/api/movements/${movementId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        },
      })
    } catch (cause) {
      console.error('Movement delete request failed', cause)
      // Close the confirmation first, otherwise the error banner would sit
      // behind the modal overlay.
      setDeleteOpen(false)
      setDeleteError(t('movementDeleteFailed'))
      return
    } finally {
      setDeleteBusy(false)
    }

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      setDeleteOpen(false)
      setDeleteError(t(movementAdminErrorKey(result?.error, 'delete')))
      return
    }

    const result = (await response.json().catch(() => null)) as {
      storage_cleanup?: string
    } | null
    setDeleteOpen(false)
    setDeleted(true)
    if (result?.storage_cleanup === 'pending')
      console.warn('Movement deleted; its photo files are still in storage')
    router.push('/logs')
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

  // The movement is gone: never keep rendering its details while the router
  // navigates back to the log.
  if (deleted)
    return (
      <div className="space-y-4">
        <Notice tone="success">{t('movementDeleted')}</Notice>
        <BackButton onClick={() => router.push('/logs')} label={t('logs')} />
      </div>
    )

  // Skeleton only for the first load (no movement yet); a refetch after an
  // edit keeps the current page on screen.
  if (loading && !log && !error) return <MovementDetailSkeleton />

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

  // wave6-J3 — which driver path the admin edit must take. An open site visit
  // keeps its immutable entry driver, so the dialog routes that change through
  // the append-only `change_active_movement_driver`; the prefilled driver is
  // then the CURRENT one (latest append), while a closed visit or an EXIT row
  // corrects the row's own `driver_id` column.
  const driverEditMode = movementDriverEditMode({
    movementType: log.movement_type,
    movementContext: log.movement_context,
    hasLaterMovement: Boolean(linkedLog),
  })
  const latestDriverChange = driverChanges.at(-1)
  const editDriverId =
    driverEditMode === 'driver_change'
      ? (latestDriverChange?.new_driver_id ?? log.driver_id ?? null)
      : (log.driver_id ?? null)
  const editDriverName =
    driverEditMode === 'driver_change'
      ? (latestDriverChange?.new_driver_name ?? log.driver_name ?? null)
      : (log.driver_name ?? null)

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

  const role = profile?.role
  const companyName = company
    ? localizedName(lang, company.name_ar, company.name_en)
    : null
  const projectName = project
    ? localizedName(lang, project.name_ar, project.name_en)
    : null

  // Photo permissions mirror the previous screen; the photo API route, RLS
  // and Storage policies stay authoritative (uploader or admin may delete,
  // monitor is read-only, max three per movement).
  const selectedPhoto = photoItems[photoCarouselIndex]
  const canAddPhotos = role !== 'monitor' && photoItems.length < 3
  const canDeleteSelectedPhoto =
    role !== 'monitor' &&
    Boolean(selectedPhoto) &&
    (selectedPhoto?.uploaded_by === user?.id || role === 'admin')

  // The driver change is recorded on an open site ENTRY only; the database
  // function re-checks the role and that the visit is still open.
  const canChangeDriver =
    isEntry && !linkedLog && role !== 'workshop' && role !== 'monitor'
  const driverDisplayName =
    (isEntry ? latestDriverChange?.new_driver_name : undefined) ??
    log.driver?.full_name ??
    log.driver_name ??
    null

  const movementItems: InfoGridItem[] = [
    {
      key: 'movementDate',
      icon: <Clock size={16} />,
      label: t('movementDate'),
      value: formatDate(log.recorded_at),
      dir: 'ltr',
    },
    ...(linkedLog
      ? [
          {
            key: 'duration',
            icon: <Timer size={16} />,
            label: t('durationOnSite'),
            value: formatElapsedDuration(durationMs, t, lang),
          },
        ]
      : []),
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
    ...(log.notes
      ? [
          {
            key: 'notes',
            icon: <StickyNote size={16} />,
            label: t('notes'),
            // A node, not a string, so InfoGrid never truncates the note.
            value: (
              <span className="whitespace-pre-wrap break-words">
                {log.notes}
              </span>
            ),
          },
        ]
      : []),
  ]

  const equipmentItems: InfoGridItem[] = [
    {
      key: 'equipmentCode',
      icon: <Hash size={16} />,
      label: t('equipmentDetailsCode'),
      value: log.equipment?.code,
      dir: 'ltr',
    },
    {
      key: 'equipmentType',
      icon: <Wrench size={16} />,
      label: t('equipmentDetailsType'),
      value: log.equipment?.type,
    },
    {
      key: 'plateNumber',
      icon: <Hash size={16} />,
      label: t('plateNumber'),
      value: log.equipment?.plate_number,
      dir: 'ltr',
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
  ]

  const companyItems: InfoGridItem[] = [
    {
      key: 'company',
      icon: <Building2 size={16} />,
      label: t('company'),
      value: companyName,
    },
    {
      key: 'project',
      icon: <MapPin size={16} />,
      label: t('project'),
      value: projectName,
    },
    {
      key: 'contractorCode',
      icon: <Hash size={16} />,
      label: t('contractorEquipmentCode'),
      value: log.contractor_equipment_code,
      dir: 'ltr',
    },
  ]

  const linkedItems: InfoGridItem[] = linkedLog
    ? [
        {
          key: 'linkedDate',
          icon: <Link2 size={16} />,
          label: t('movementDate'),
          value: formatDate(linkedLog.recorded_at),
          dir: 'ltr',
        },
        // The EXIT page keeps showing what its ENTRY recorded.
        ...(!isEntry && !isWorkshopMovement
          ? [
              {
                key: 'linkedCompany',
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
                key: 'linkedProject',
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
                key: 'linkedContractorCode',
                icon: <Hash size={16} />,
                label: t('contractorEquipmentCode'),
                value: linkedLog.contractor_equipment_code,
                dir: 'ltr' as const,
              },
            ]
          : []),
      ]
    : []

  const headerActions =
    canEditContractorCode || role === 'admin' ? (
      <>
        {canEditContractorCode && (
          <Button
            variant="outline"
            size="sm"
            icon={<Pencil size={14} />}
            onClick={() => setCodeEditOpen(true)}
          >
            {t('editContractorCode')}
          </Button>
        )}
        {role === 'admin' && (
          <MovementAdminMenu
            busy={deleteBusy}
            onEdit={() => {
              setDeleteError(null)
              setEditWarning(null)
              setDetailsEditOpen(true)
            }}
            onDelete={() => {
              setDeleteError(null)
              setEditWarning(null)
              setDeleteOpen(true)
            }}
          />
        )}
      </>
    ) : undefined

  // The recorder's name is display data every role may see on a movement it
  // can already read (owner decision 2026-09-22, migration 0099); the
  // creation timestamp stays admin-only as before. wave7-V2 — the line also
  // carries the movement date as a Saudi calendar day (UTC+03:00), isolated
  // LTR so the digits keep their order inside Arabic text.
  const recordedBy = t('movementRecordedByOn')
    .replace('{name}', log.supervisor?.full_name || '—')
    .replace(
      '{date}',
      `\u2066${formatDate(saudiDateKey(log.recorded_at))}\u2069`,
    )

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} label={t('backToMovements')} />

      {/* wave7-V2 — owner review: every section sits in its own card. The
          header card carries the audit line as its footer so "recorded by"
          is visible without scrolling. */}
      <Card className="space-y-3">
        <DetailHeader
          as="h1"
          identifier={log.equipment?.code ?? t('movementDetails')}
          identifierLtr={Boolean(log.equipment?.code)}
          subtitle={log.equipment?.type}
          badges={
            <>
              <MovementBadge type={isEntry ? 'entry' : 'exit'} withIcon />
              {isWorkshopMovement && (
                <Badge tone="neutral">{t('workshopContext')}</Badge>
              )}
            </>
          }
          actions={headerActions}
        />

        <p className="border-t pt-3 text-xs text-muted">
          {recordedBy}
          {role === 'admin' && log.created_at
            ? ` — ${t('createdAt')}: ${formatDateTime(log.created_at)}`
            : ''}
        </p>
      </Card>

      {deleteError && <Notice tone="danger">{deleteError}</Notice>}
      {/* Partial success: the correction was stored, a follow-up step was
          not. Never reported as a total failure. */}
      {editWarning && <Notice tone="warning">{editWarning}</Notice>}

      <Card>
        <InfoGridSection
          title={t('movementSectionMovement')}
          items={movementItems}
        />
      </Card>

      <Card>
        <InfoGridSection
          title={t('sectionEquipmentDetails')}
          items={equipmentItems}
        />
      </Card>

      {!isWorkshopMovement && (
        <Card>
          <InfoGridSection
            title={t('movementSectionCompanyProject')}
            items={companyItems}
          />
        </Card>
      )}

      {!isWorkshopMovement && (
        <Card>
          <MovementDriverSection
            key={log.id}
            driverName={driverDisplayName}
            nameLabel={
              isEntry && driverChanges.length > 0
                ? t('currentDriver')
                : t('driverName')
            }
            mobileNumber={currentDriverMobileNumber}
            entryLogId={driverEntryId}
            changes={driverChanges}
            canChangeDriver={canChangeDriver}
            loadDrivers={loadDrivers}
            onChanged={fetchData}
          />
        </Card>
      )}

      <Card>
        <MovementPhotosPanel
          photos={galleryPhotos}
          selectedIndex={photoCarouselIndex}
          onSelectIndex={setPhotoCarouselIndex}
          onOpen={() => setLightboxOpen(true)}
          canAdd={canAddPhotos}
          onAddFiles={addPhotos}
          canDeleteSelected={canDeleteSelectedPhoto}
          onDeleteSelected={() => {
            if (selectedPhoto) deletePhoto(selectedPhoto.id)
          }}
          busy={photoBusy}
          error={photoActionError}
        />
      </Card>

      {/* The linked exit/entry comes last, after everything else. */}
      <Card className="space-y-3">
        <SectionHeader
          title={isEntry ? t('linkedExit') : t('linkedEntry')}
          action={
            linkedLog ? (
              <Button
                variant="outline"
                size="sm"
                icon={<ExternalLink size={14} />}
                onClick={() => onNavigateMovement(linkedLog.id)}
              >
                {t('viewDetails')}
              </Button>
            ) : undefined
          }
        />
        {linkedError ? (
          <Notice tone="danger" size="compact">
            {linkedError}
          </Notice>
        ) : linkedLog ? (
          <InfoGrid items={linkedItems} />
        ) : (
          <p className="text-sm text-muted">
            {isEntry ? t('notExitedYet') : '—'}
          </p>
        )}
      </Card>

      <Lightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        items={lightboxItems}
        index={photoCarouselIndex}
        onIndexChange={setPhotoCarouselIndex}
      />

      {canEditContractorCode && (
        <ContractorCodeDialog
          open={codeEditOpen}
          onOpenChange={setCodeEditOpen}
          logId={log.id}
          currentCode={log.contractor_equipment_code}
          onSaved={fetchData}
        />
      )}

      {role === 'admin' && (
        <>
          <MovementEditDialog
            open={detailsEditOpen}
            onOpenChange={setDetailsEditOpen}
            movement={log}
            company={company}
            project={project}
            driverId={editDriverId}
            driverName={editDriverName}
            driverMode={driverEditMode}
            driverEntryId={driverEntryId ?? (isEntry ? log.id : null)}
            loadDrivers={loadDrivers}
            onSaved={async (warning) => {
              setEditWarning(warning ?? null)
              await fetchData()
            }}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={t('confirmDeleteMovement')}
            description={t('dialogDescMovementDelete')}
            confirmLabel={t('delete')}
            tone="danger"
            loading={deleteBusy}
            onConfirm={deleteMovement}
          />
        </>
      )}

      {confirmDialog}
    </div>
  )
}
