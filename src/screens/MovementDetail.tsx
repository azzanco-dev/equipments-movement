import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
import { unwrapRows } from '@/lib/supabaseResult'
import { formatDate, formatDateTime } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'
import { localizedName } from '@/lib/localizedName'
import { exitPurposeLabelKey } from '@/lib/exitPurpose'
import { uploadMovementPhotosDirectly } from '@/lib/movementPhotoUpload'
import { prepareMovementPhotos } from '@/lib/movementPhotoCompression'
import {
  ALLOWED_MOVEMENT_PHOTO_TYPES,
  MAX_MOVEMENT_PHOTOS,
} from '@/components/useMovementPhotoStaging'
import {
  MOVEMENT_DETAIL_GALLERY_WIDTH_CLASS,
  detailPhotosToGalleryItems,
  type StagedPhotoLike,
} from '@/lib/movementPhotoGallery'
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
  ConfirmDialog,
  DescriptionList,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  InfoRow,
  Input,
  Lightbox,
  MovementBadge,
  Notice,
  PageHeader,
  PhotoGallery,
  WorkshopPurposeBadge,
  useConfirm,
  type DescriptionListItem,
} from '@/components/ui'
import { LtrValue } from '@/components/ui/InfoGrid'
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

// One title style for every card on the page.
const SECTION_TITLE_CLASS = 'mb-2 text-sm font-bold text-muted'

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
  // Index of the photo shown in the gallery's main box and in the lightbox.
  const [photoIndex, setPhotoIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  // Local previews of the files being uploaded. `base` is the saved-photo
  // list they were added to: as soon as the refetch replaces that list, the
  // previews give way to the saved photos in the same render.
  const [pendingUploads, setPendingUploads] = useState<{
    base: (EntryExitPhoto & { url: string })[]
    photos: StagedPhotoLike[]
  } | null>(null)
  // Object URLs of those previews that are still alive, for unmount cleanup.
  const pendingPreviewUrlsRef = useRef<Set<string>>(new Set())
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
  // The driver-change history failed to load: the card then shows a notice
  // instead of presenting the original entry driver as the current one.
  const [driverChangesError, setDriverChangesError] = useState(false)
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
  const [codeEditValue, setCodeEditValue] = useState('')
  const [codeEditBusy, setCodeEditBusy] = useState(false)
  const [codeEditError, setCodeEditError] = useState<string | null>(null)
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
      setPhotoIndex(0)
      setLightboxOpen(false)
      setDriverChanges([])
      setCurrentDriverMobileNumber(null)
      setDriverEntryId(null)
      setDriverChangesError(false)
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
        const { data: changes, error: changesError } = await supabase
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
        if (changesError) {
          setDriverChanges([])
          setDriverChangesError(true)
          return
        }
        setDriverChangesError(false)
        setDriverChanges((changes as unknown as MovementDriverChange[]) ?? [])
        const latestChange = (
          changes as unknown as MovementDriverChange[] | null
        )?.at(-1)
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
      return unwrapRows(await request).map((driver) => ({
        value: driver.id,
        label: `${driver.full_name}${driver.name_en ? ` — ${driver.name_en}` : ''}${driver.mobile_number ? ` — ${driver.mobile_number}` : ''}`,
      }))
    },
    [],
  )

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

  useEffect(() => {
    const previewUrls = pendingPreviewUrlsRef.current
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url)
      previewUrls.clear()
    }
  }, [])

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
    // Show the selected files in the gallery right away, after the saved
    // photos, with the busy overlay; the first of them becomes the main image.
    const previews: StagedPhotoLike[] = selected.map((file, index) => ({
      id: `pending-${index}`,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      status: 'preparing',
      progress: 0,
    }))
    for (const photo of previews)
      pendingPreviewUrlsRef.current.add(photo.previewUrl)
    setPendingUploads({ base: photoItems, photos: previews })
    setPhotoIndex(photoItems.length)
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
    if (failureMessage) setPhotoActionError(failureMessage)
    await fetchData()
    // The saved photos are on screen now; drop this batch of previews (a
    // newer batch, if any, is left alone).
    setPendingUploads((current) =>
      current?.photos === previews ? null : current,
    )
    for (const photo of previews) {
      URL.revokeObjectURL(photo.previewUrl)
      pendingPreviewUrlsRef.current.delete(photo.previewUrl)
    }
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
    setPhotoIndex(0)
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

  // Skeleton for the whole first load: `loading` is only raised for a first
  // load or a switch to another movement (never for a refetch after an edit),
  // and it stays up until the photos, the linked movement and the driver
  // changes have all resolved. Revealing the page as soon as the movement row
  // arrived made the photo box, the linked card and the driver card pop in
  // one after the other.
  if (loading && !error) {
    const role = profile?.role
    // The context is only known once the movement row arrived; until then the
    // role gives the likeliest shape (workshop roles work on workshop
    // movements, everyone else mostly on site movements).
    const skeletonContext =
      log?.movement_context ??
      (role === 'workshop' ||
      role === 'assistant_workshop_manager' ||
      role === 'workshop_manager'
        ? 'workshop'
        : 'site')
    return (
      <MovementDetailSkeleton
        context={skeletonContext === 'workshop' ? 'workshop' : 'site'}
        isAdmin={role === 'admin'}
        canUpload={role !== 'monitor'}
      />
    )
  }

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
  // Who may act on this movement. Both rules only decide what is shown; they
  // are enforced in PostgreSQL (migrations 0108 and 0109).
  const isWorkshopRole =
    profile?.role === 'workshop' ||
    profile?.role === 'assistant_workshop_manager' ||
    profile?.role === 'workshop_manager'
  const isOwnMovement = log.supervisor_id === user?.id
  // An admin, the foreman who registered the entry.
  const canChangeDriver =
    profile?.role === 'admin' ||
    (profile?.role === 'supervisor' && isOwnMovement)
  // An admin, the movement's own recorder, or a workshop role on a workshop
  // movement. Monitor never uploads.
  const canAddPhotos =
    profile?.role === 'admin' ||
    (profile?.role !== 'monitor' && profile?.role != null && isOwnMovement) ||
    (isWorkshopRole && isWorkshopMovement)

  // The gallery shows the saved photos (or the legacy `photo_url` photo when
  // the movement has no photo rows) followed by the files being uploaded.
  // Only the uploader or an admin gets the remove button of a photo.
  const galleryItems = detailPhotosToGalleryItems({
    saved: photoItems,
    legacyUrl: photoUrl,
    pending: pendingUploads?.base === photoItems ? pendingUploads.photos : [],
    viewer: { userId: user?.id, role: profile?.role },
    busy: photoBusy,
    alt: t('photoGalleryMainAlt'),
  })
  const selectedPhotoIndex = galleryItems[photoIndex] ? photoIndex : 0
  const selectPhoto = (id: string) => {
    const index = galleryItems.findIndex((item) => item.id === id)
    if (index >= 0) setPhotoIndex(index)
  }
  // Nothing to add and nothing to remove: a plain read-only gallery.
  const photosReadOnly =
    !canAddPhotos && !galleryItems.some((item) => item.removable !== false)

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

  const currentDriverName =
    (isEntry ? driverChanges.at(-1)?.new_driver_name : undefined) ??
    log.driver?.full_name ??
    log.driver_name ??
    null

  const exitPurposeKey = exitPurposeLabelKey(log.exit_purpose)

  const detailItems: DescriptionListItem[] = [
    {
      key: 'equipment',
      icon: <Truck size={16} />,
      label: t('equipmentNameLabel'),
      value: log.equipment ? (
        <>
          <LtrValue>{log.equipment.code}</LtrValue> — {log.equipment.type}
        </>
      ) : null,
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
    // wave-10-exit-purpose (migration 0111): site exits only. A row recorded
    // before the purpose existed stores NULL and shows the muted dash.
    ...(!isWorkshopMovement && !isEntry
      ? [
          {
            key: 'exitPurpose',
            icon: <FileText size={16} />,
            label: t('exitPurpose'),
            value: exitPurposeKey ? t(exitPurposeKey) : null,
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
                {log.contractor_equipment_code ? (
                  <LtrValue>{log.contractor_equipment_code}</LtrValue>
                ) : (
                  <span className="font-normal text-muted">—</span>
                )}
                <IconButton
                  size="sm"
                  label={t('editContractorCode')}
                  icon={<Pencil size={14} />}
                  onClick={openContractorCodeEdit}
                />
              </span>
            ) : log.contractor_equipment_code ? (
              <LtrValue>{log.contractor_equipment_code}</LtrValue>
            ) : null,
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
                {currentDriverName ?? (
                  // A driverless entry reads like every other empty value.
                  <span className="font-normal text-muted">—</span>
                )}
                {currentDriverMobileNumber && (
                  // The number is an inline LTR run under the name at the
                  // start edge; `dir` never goes on the block itself.
                  <span className="mt-0.5 block select-text text-muted">
                    <LtrValue>
                      <a href={`tel:${currentDriverMobileNumber}`}>
                        {currentDriverMobileNumber}
                      </a>
                    </LtrValue>
                  </span>
                )}
              </>
            ),
          },
        ]
      : []),
    // The recorder's name is display data every role may see on a movement
    // it can already read (owner decision 2026-09-22, migration 0099).
    {
      key: 'supervisor',
      icon: <User size={16} />,
      label: t('supervisorName'),
      value: log.supervisor?.full_name,
    },
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
          ) : undefined
        }
      />

      {deleteError && <Alert type="error">{deleteError}</Alert>}
      {/* Partial success: the correction was stored, a follow-up step was
          not. Never reported as a total failure. */}
      {editWarning && <Alert type="warning">{editWarning}</Alert>}

      {/* Movement type banner: same card surface as the sections below
          (owner decision 2026-09-30). */}
      <div className="card flex items-center gap-3">
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
        <h3 className={SECTION_TITLE_CLASS}>{t('movementDetails')}</h3>
        <DescriptionList items={detailItems} columns={2} />

        {/* Notes. `InfoRow` carries its own 8px block padding, so 8px here
            gives the same 16px under the divider as the photos section. */}
        {log.notes && (
          <div
            className="mt-4 border-t pt-2"
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
          <div className="mb-2 flex items-center gap-3">
            <Camera size={16} className="shrink-0 text-muted" />
            <p className="text-xs text-muted">{t('photo')}</p>
          </div>
          {photoActionError && (
            <div className="mb-3">
              <Alert type="error">{photoActionError}</Alert>
            </div>
          )}
          {/* The "no photo" state lives in the gallery's main box, so the
              block keeps the same height with and without photos. */}
          <div className={MOVEMENT_DETAIL_GALLERY_WIDTH_CLASS}>
            <PhotoGallery
              photos={galleryItems}
              max={MAX_MOVEMENT_PHOTOS}
              selectedId={galleryItems[selectedPhotoIndex]?.id ?? null}
              onSelect={selectPhoto}
              // A disabled file input ignores the click, so no new files are
              // accepted while a photo request is running.
              onAdd={
                canAddPhotos ? () => photoInputRef.current?.click() : undefined
              }
              onRemove={(id) => void deletePhoto(id)}
              onOpen={(id) => {
                selectPhoto(id)
                setLightboxOpen(true)
              }}
              readOnly={photosReadOnly}
            />
            {canAddPhotos && (
              <input
                ref={photoInputRef}
                type="file"
                multiple
                accept={ALLOWED_MOVEMENT_PHOTO_TYPES.join(',')}
                className="hidden"
                disabled={photoBusy}
                onChange={(event) => {
                  addPhotos(event.target.files)
                  event.target.value = ''
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Equipment data */}
      <div className="card">
        <h3 className={SECTION_TITLE_CLASS}>{t('sectionEquipmentDetails')}</h3>
        <DescriptionList
          items={[
            {
              key: 'equipmentDetailsCode',
              icon: <Truck size={16} />,
              label: t('equipmentDetailsCode'),
              value: log.equipment?.code,
              dir: 'ltr',
            },
            {
              key: 'equipmentDetailsType',
              icon: <FileText size={16} />,
              label: t('equipmentDetailsType'),
              value: log.equipment?.type,
            },
            {
              key: 'equipmentDetailsPlate',
              icon: <FileText size={16} />,
              label: t('plateNumber'),
              value: log.equipment?.plate_number,
              dir: 'ltr',
            },
          ]}
          columns={2}
        />
      </div>

      {driverEntryId && log.movement_context !== 'workshop' && (
        <div className="card space-y-4">
          {/* The text block may shrink (`min-w-0`) but starts from a 12rem
              basis, so on a narrow phone the button wraps under it instead
              of squeezing the driver name. */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-[1_1_12rem]">
              <h3 className={SECTION_TITLE_CLASS}>
                {t('driverChangeHistory')}
              </h3>
              <p className="text-xs text-muted">{t('currentDriver')}</p>
              <p className="break-words font-medium leading-relaxed">
                {driverChangesError ? (
                  <span className="font-normal text-muted">—</span>
                ) : (
                  (driverChanges.at(-1)?.new_driver_name ??
                  (isEntry ? log.driver_name : linkedLog?.driver_name) ?? (
                    <span className="font-normal text-muted">—</span>
                  ))
                )}
              </p>
            </div>
            {isEntry &&
              !linkedLog &&
              canChangeDriver &&
              !driverChangesError && (
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
          {driverChangesError ? (
            <Notice
              tone="danger"
              size="compact"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  icon={<RefreshCw size={14} aria-hidden="true" />}
                  onClick={() => void fetchData()}
                >
                  {t('retry')}
                </Button>
              }
            >
              {t('dataLoadError')}
            </Notice>
          ) : driverChanges.length === 0 ? (
            <p className="text-sm text-muted">{t('noDriverChanges')}</p>
          ) : (
            <div className="space-y-2">
              {driverChanges.map((change) => (
                <div
                  key={change.id}
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {/* Label above value, like every other field on the page.
                      `<bdi>` isolates a Latin name inline, so the value
                      keeps the start edge. */}
                  <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted">
                        {t('previousDriver')}
                      </p>
                      <p className="break-words font-medium">
                        {change.previous_driver_name ? (
                          <bdi>{change.previous_driver_name}</bdi>
                        ) : (
                          <span className="font-normal text-muted">—</span>
                        )}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-muted">{t('newDriver')}</p>
                      <p className="break-words font-medium">
                        <bdi>{change.new_driver_name}</bdi>
                      </p>
                    </div>
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
          <h3 className={`${SECTION_TITLE_CLASS} flex items-center gap-2`}>
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
                columns={2}
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
          <h3 className={`${SECTION_TITLE_CLASS} flex items-center gap-2`}>
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
                          dir: 'ltr' as const,
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
                columns={2}
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
        items={galleryItems}
        index={selectedPhotoIndex}
        onIndexChange={setPhotoIndex}
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

      {profile?.role === 'admin' && (
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
