import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import { Alert } from '@/components/Alert'
import { AlertTriangle } from 'lucide-react'
import type { Driver, Equipment, MovementType, LastMovement } from '@/lib/types'
import {
  BackButton,
  Button,
  DatePicker,
  Field,
  Input,
  Textarea,
} from '@/components/ui'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { driverOption } from '@/lib/driverOptions'
import { useMovementFormOptions } from '@/components/movement/useMovementFormOptions'
import { LastEntrySummary } from '@/components/movement/LastEntrySummary'
import { EquipmentStep } from '@/components/movement/EquipmentStep'
import { MovementFormShell } from '@/components/movement/MovementFormShell'
import { MovementPhotosSection } from '@/components/movement/MovementPhotosSection'
import { MovementStatusCard } from '@/components/movement/MovementStatusCard'
import {
  EMPTY_QUICK_DRIVER,
  QuickDriverForm,
} from '@/components/movement/QuickDriverForm'
import {
  EMPTY_QUICK_EQUIPMENT,
  QuickEquipmentForm,
} from '@/components/movement/QuickEquipmentForm'
import {
  EMPTY_QUICK_LESSOR,
  QuickLessorDialog,
} from '@/components/movement/QuickLessorDialog'
import { sanitizeSearchTerm } from '@/lib/search'
import { toLatinDigits } from '@/lib/plate'
import { siteExitEquipmentArgs } from '@/lib/exitEquipmentSearch'
import {
  entryEquipmentArgs,
  type EntryEquipmentStateFields,
} from '@/lib/entryEquipmentSearch'
import { localizedName } from '@/lib/localizedName'
import {
  actualMovementDate,
  movementDateKey,
  toLocalDateTimeInput,
  withCurrentLocalTime,
} from '@/lib/movementFormTime'
import { movementSaveErrorKey } from '@/lib/movementSaveErrors'
import {
  useMovementPhotoStaging,
  type StagedPhotoError,
} from '@/components/useMovementPhotoStaging'

interface EntryExitFormProps {
  open: boolean
  onClose: () => void
  movementType: MovementType
  onSaved: () => void
  pageMode?: boolean
  onViewMovement?: (id: string) => void
  onGoHome?: () => void
}

export function EntryExitForm({
  open,
  onClose,
  movementType,
  onSaved,
  pageMode = false,
  onViewMovement,
  onGoHome,
}: EntryExitFormProps) {
  const { t, lang } = useI18n()
  const { user, profile } = useAuth()

  const [step, setStep] = useState<'select' | 'details'>('select')
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  // The site ENTRY search adds the current state of each row; every other
  // search leaves those fields undefined.
  const [equipment, setEquipment] = useState<
    (Equipment & EntryEquipmentStateFields)[]
  >([])
  const [selected, setSelected] = useState<Equipment | null>(null)
  const [loadingEquipment, setLoadingEquipment] = useState(false)
  const [equipmentError, setEquipmentError] = useState(false)
  const [lastMovement, setLastMovement] = useState<LastMovement | null>(null)
  const [loadingMovement, setLoadingMovement] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [driverId, setDriverId] = useState('')
  const [selectedDriver, setSelectedDriver] =
    useState<AsyncSearchSelectOption | null>(null)
  const [notes, setNotes] = useState('')
  const [photoIndex, setPhotoIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveWarning, setSaveWarning] = useState<string | null>(null)
  const [movementSaved, setMovementSaved] = useState(false)
  const [savedMovementId, setSavedMovementId] = useState('')
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedCompany, setSelectedCompany] =
    useState<AsyncSearchSelectOption | null>(null)
  const [selectedProject, setSelectedProject] =
    useState<AsyncSearchSelectOption | null>(null)
  const [contractorCode, setContractorCode] = useState('')
  const [recordedAt, setRecordedAt] = useState('')
  const [quickDriver, setQuickDriver] = useState(EMPTY_QUICK_DRIVER)
  const [quickEquipment, setQuickEquipment] = useState(EMPTY_QUICK_EQUIPMENT)
  const [selectedQuickLessor, setSelectedQuickLessor] =
    useState<AsyncSearchSelectOption | null>(null)
  const [quickLessor, setQuickLessor] = useState(EMPTY_QUICK_LESSOR)
  const [quickSaving, setQuickSaving] = useState(false)
  const equipmentListRef = useRef<HTMLDivElement>(null)
  const quickEquipmentRef = useRef<HTMLDivElement>(null)
  const successRef = useRef<HTMLDivElement>(null)

  const {
    loadDrivers,
    loadCompanies,
    loadProjects,
    loadEquipmentTypes,
    loadLessors,
  } = useMovementFormOptions()

  const photoErrorMessage = (error: StagedPhotoError) => {
    if (error === 'invalid_type') return t('invalidPhotoType')
    if (error === 'too_large') return t('photoTooLargeMulti')
    if (error === 'session_expired') return t('sessionExpiredError')
    return t('photoUploadFailed')
  }
  const photoStaging = useMovementPhotoStaging({
    onError: (error) => setSaveError(error ? photoErrorMessage(error) : null),
  })
  const stagedPhotos = photoStaging.photos
  const uploadingPhotos = photoStaging.uploading
  const { reset: resetPhotoStaging } = photoStaging

  const isEntry = movementType === 'entry'
  const workshopMode =
    profile?.role === 'workshop' ||
    profile?.role === 'assistant_workshop_manager' ||
    profile?.role === 'workshop_manager'
  // A site EXIT may only be registered by the foreman who registered the open
  // ENTRY, or by an admin, so its equipment list is filtered in the database.
  const siteExitMode = !workshopMode && !isEntry
  const currentLocalDateTime = toLocalDateTimeInput(new Date())
  const movementDate = movementDateKey(recordedAt)

  const updateMovementDate = (date: string) => {
    if (!date) {
      setRecordedAt('')
      return
    }
    setRecordedAt(withCurrentLocalTime(date, new Date()))
  }

  const reset = useCallback(() => {
    setStep('select')
    setSearch('')
    setOwnerFilter('')
    setEquipmentError(false)
    setSelected(null)
    setLastMovement(null)
    setLoadingMovement(false)
    setValidationError(null)
    setDriverId('')
    setSelectedDriver(null)
    setNotes('')
    resetPhotoStaging()
    setPhotoIndex(0)
    setSaveError(null)
    setSaveWarning(null)
    setMovementSaved(false)
    setSavedMovementId('')
    setSelectedCompanyId('')
    setSelectedProjectId('')
    setSelectedCompany(null)
    setSelectedProject(null)
    setContractorCode('')
    setRecordedAt('')
    setQuickDriver(EMPTY_QUICK_DRIVER)
    setQuickEquipment(EMPTY_QUICK_EQUIPMENT)
    setSelectedQuickLessor(null)
    setQuickLessor(EMPTY_QUICK_LESSOR)
  }, [resetPhotoStaging])

  useEffect(() => {
    if (open) {
      setRecordedAt(toLocalDateTimeInput(new Date()))
    } else {
      reset()
    }
  }, [open, reset])

  useEffect(() => {
    if (!quickEquipment.open) return
    const frame = window.requestAnimationFrame(() => {
      quickEquipmentRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [quickEquipment.open])

  useEffect(() => {
    if (!movementSaved) return
    const frame = window.requestAnimationFrame(() => {
      successRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [movementSaved])

  // Search equipment
  useEffect(() => {
    if (!open || step !== 'select') return
    let active = true
    setLoadingEquipment(true)

    const term = toLatinDigits(sanitizeSearchTerm(search))
    const timer = window.setTimeout(
      async () => {
        let result
        if (workshopMode) {
          result = await supabase.rpc('search_workshop_equipment', {
            p_movement_type: movementType,
            p_search: term || null,
            p_ownership_status: ownerFilter || null,
          })
        } else if (siteExitMode) {
          result = await supabase.rpc(
            'search_site_exit_equipment',
            siteExitEquipmentArgs(term, ownerFilter),
          )
        } else {
          // Site ENTRY. Equipment that is already inside a site (entered by any
          // foreman) stays listed with its state, so a foreman does not assume
          // it is missing and quick-create a duplicate. The state comes from a
          // narrowly scoped SECURITY DEFINER function because `entry_exit_logs`
          // RLS hides other foremen's movements.
          result = await supabase.rpc(
            'search_entry_equipment',
            entryEquipmentArgs(term, ownerFilter),
          )
        }
        const { data, error } = result
        if (!active) return
        if (error) console.error(error)
        setEquipmentError(Boolean(error))
        setEquipment(
          (data as unknown as (Equipment & EntryEquipmentStateFields)[]) ?? [],
        )
        setLoadingEquipment(false)
      },
      search ? 300 : 0,
    )

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    open,
    step,
    search,
    ownerFilter,
    workshopMode,
    siteExitMode,
    movementType,
  ])

  // Check last movement when equipment is selected
  const checkLastMovement = useCallback(
    async (eq: Equipment): Promise<LastMovement | null> => {
      setLoadingMovement(true)
      setValidationError(null)

      const { data, error } = await supabase.rpc('get_last_movement', {
        p_equipment_id: eq.id,
        p_movement_context: workshopMode ? 'workshop' : 'site',
      })

      setLoadingMovement(false)

      if (error) {
        console.error(error)
        setSaveError(t('saveFailed'))
        return null
      }

      const last = (data as LastMovement[])[0] ?? null
      setLastMovement(last)
      // An EXIT carries no driver field: the database inherits the latest
      // current driver of the open visit when the exit row is written.

      // Validation logic
      if (isEntry) {
        if (last && last.movement_type === 'entry') {
          setValidationError(t('entryBlockedMsg'))
        } else {
          setValidationError(null)
        }
      } else {
        if (!last) {
          setValidationError(t('exitNoPreviousMsg'))
        } else if (last.movement_type === 'exit') {
          setValidationError(t('exitBlockedMsg'))
        } else {
          setValidationError(null)
        }
      }

      return last
    },
    [isEntry, t, workshopMode],
  )

  const createQuickLessor = async () => {
    const trimmedName = quickLessor.name.trim()
    if (!trimmedName) {
      setQuickLessor((current) => ({
        ...current,
        error: t('lessorNameRequired'),
      }))
      return
    }
    setQuickSaving(true)
    setQuickLessor((current) => ({ ...current, error: '' }))
    const { data, error } = await supabase.rpc('quick_create_lessor_by_name', {
      p_name: trimmedName,
    })
    setQuickSaving(false)
    if (error || !data) {
      setQuickLessor((current) => ({ ...current, error: t('saveFailed') }))
      return
    }
    const lessor = data as { id: string; name: string }
    const option = { value: lessor.id, label: lessor.name }
    setQuickEquipment((current) => ({ ...current, lessorId: lessor.id }))
    setSelectedQuickLessor(option)
    setQuickLessor(EMPTY_QUICK_LESSOR)
  }

  const handleSelectEquipment = (eq: Equipment) => {
    setSelected(eq)
    setSaveError(null)
    setValidationError(null)
    setStep('details')
    // Fire async; don't block UI
    checkLastMovement(eq)
  }

  const createQuickDriver = async () => {
    if (
      !quickDriver.fullName.trim() ||
      !/^\+?\d{7,15}$/.test(quickDriver.mobile)
    ) {
      setSaveError(t('invalidQuickDriver'))
      return
    }
    setQuickSaving(true)
    setSaveError(null)
    const { data, error } = await supabase.rpc('quick_create_driver', {
      p_full_name: quickDriver.fullName.trim(),
      p_mobile_number: quickDriver.mobile.trim(),
    })
    setQuickSaving(false)
    if (error || !data) {
      setSaveError(t('saveFailed'))
      return
    }
    const driver = data as Driver
    setDriverId(driver.id)
    setSelectedDriver(driverOption(driver))
    setQuickDriver(EMPTY_QUICK_DRIVER)
  }

  const createQuickEquipment = async () => {
    if (
      (!workshopMode &&
        quickEquipment.identifierType === 'plate' &&
        !/[0-9]/.test(quickEquipment.plate)) ||
      (workshopMode && !/[0-9]/.test(quickEquipment.plate))
    ) {
      setSaveError(t('plateRequired'))
      return
    }
    if (
      !workshopMode &&
      !quickEquipment.chassis.trim() &&
      quickEquipment.identifierType === 'chassis'
    ) {
      setSaveError(t('chassisNumberRequired'))
      return
    }
    if (
      workshopMode &&
      quickEquipment.numberingStatus === 'numbered' &&
      !quickEquipment.code.trim()
    ) {
      setSaveError(t('equipmentCodeRequired'))
      return
    }
    if (!workshopMode && !quickEquipment.type) {
      setSaveError(t('equipmentTypeRequired'))
      return
    }
    if (!workshopMode && !quickEquipment.lessorId) {
      setSaveError(t('lessorRequired'))
      return
    }
    setQuickSaving(true)
    setSaveError(null)
    const { data, error } = workshopMode
      ? await supabase.rpc('quick_create_workshop_equipment', {
          p_numbering_status: quickEquipment.numberingStatus,
          p_code: quickEquipment.code.trim(),
          p_plate_number: quickEquipment.plate.trim(),
        })
      : await supabase.rpc('quick_create_foreman_equipment', {
          p_plate_number:
            quickEquipment.identifierType === 'plate'
              ? quickEquipment.plate.trim()
              : null,
          p_chassis_number: quickEquipment.chassis.trim() || null,
          p_type: quickEquipment.type,
          p_lessor_id: quickEquipment.lessorId,
        })
    setQuickSaving(false)
    if (error || !data) {
      setSaveError(t('saveFailed'))
      return
    }
    setQuickEquipment(EMPTY_QUICK_EQUIPMENT)
    setSelectedQuickLessor(null)
    handleSelectEquipment(data as Equipment)
  }

  const handleAddPhotos = (files: FileList | null) => {
    // Only the newly selected files are staged; photos already uploaded keep
    // their state and their staged storage objects.
    const firstNewIndex = stagedPhotos.length
    if (photoStaging.addPhotos(files) > 0) setPhotoIndex(firstNewIndex)
  }

  const handleRemovePhoto = (index: number) => {
    photoStaging.removePhoto(index)
    setPhotoIndex((prev) =>
      Math.max(0, Math.min(prev, stagedPhotos.length - 2)),
    )
  }

  const handleSave = async () => {
    if (!selected || !user) return
    if (validationError) return
    if (workshopMode && stagedPhotos.length === 0) {
      setSaveError(t('workshopPhotoRequired'))
      return
    }
    if (stagedPhotos.length > 0 && !photoStaging.ready) {
      setSaveError(t('photosMustFinishUploading'))
      return
    }
    if (!workshopMode && isEntry && !driverId) {
      setSaveError(t('driverRequired'))
      return
    }
    if (!workshopMode && isEntry && !selectedCompanyId) {
      setSaveError(t('companyRequiredForEntry'))
      return
    }
    if (!workshopMode && isEntry && !selectedProjectId) {
      setSaveError(t('projectRequiredForEntry'))
      return
    }
    if (!recordedAt.trim()) {
      setSaveError(`${t('actualMovementTime')}: ${t('required')}`)
      return
    }
    const movementInstant = actualMovementDate(movementDate, new Date())
    if (
      isNaN(movementInstant.getTime()) ||
      movementInstant.getTime() > Date.now()
    ) {
      setSaveError(t('movementTimeCannotBeFuture'))
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      let accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Missing session')

      const payload: Record<string, unknown> = {
        equipment_id: selected.id,
        movement_type: movementType,
        movement_context: workshopMode ? 'workshop' : 'site',
        registration_method: 'manual',
        recorded_at: movementInstant.toISOString(),
        photo_count: stagedPhotos.length,
      }
      const uploadBatchIds = photoStaging.uploadBatchIds()
      if (uploadBatchIds.length) payload.upload_batch_ids = uploadBatchIds
      if (notes) payload.notes = notes
      if (!workshopMode && isEntry) {
        payload.driver_id = driverId
        if (selectedCompanyId) payload.company_id = selectedCompanyId
        if (selectedProjectId) payload.project_id = selectedProjectId
        if (contractorCode.trim())
          payload.contractor_equipment_code = contractorCode.trim()
      }

      const submitMovement = (token: string) =>
        fetch('/api/movements', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
      let response = await submitMovement(accessToken)
      if (response.status === 401) {
        const { data: refreshed, error: refreshError } =
          await supabase.auth.refreshSession()
        accessToken = refreshed.session?.access_token
        if (refreshError || !accessToken) throw new Error('unauthorized')
        response = await submitMovement(accessToken)
      }
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error ?? 'movement_save_failed')
      }
      const result = (await response.json()) as {
        id: string
        photoFailures?: number
      }

      onSaved()
      setSavedMovementId(result.id)
      onViewMovement?.(result.id)
      // The saved movement now owns the staged objects, so they must not be
      // discarded when the form resets.
      photoStaging.releaseUploads()
      const photoFailures = result.photoFailures ?? 0
      if (photoFailures) {
        setSaveWarning(t('movementSavedPhotosFailed'))
      }
      setMovementSaved(true)
      if (!photoFailures && !pageMode) {
        onClose()
        reset()
      }
    } catch (err) {
      console.error(err)
      const code = err instanceof Error ? err.message : 'movement_save_failed'
      setSaveError(t(movementSaveErrorKey(code, isEntry)))
      checkLastMovement(selected)
    } finally {
      setSaving(false)
    }
  }

  // `localizedName` falls back to an em dash, but the last-entry summary needs
  // a missing name to stay empty so it does not render "— - project".
  const optionalLocalizedName = (
    nameAr?: string | null,
    nameEn?: string | null,
  ) =>
    nameAr?.trim() || nameEn?.trim()
      ? localizedName(lang, nameAr, nameEn)
      : null

  return (
    <>
      <MovementFormShell
        open={open}
        onClose={onClose}
        pageMode={pageMode}
        title={isEntry ? t('registerEntry') : t('registerExit')}
      >
        {step === 'select' && (
          <EquipmentStep
            search={search}
            onSearchChange={setSearch}
            ownerFilter={ownerFilter}
            onOwnerFilterChange={setOwnerFilter}
            equipment={equipment}
            loading={loadingEquipment}
            loadError={equipmentError}
            isEntry={isEntry}
            siteExitMode={siteExitMode}
            isAdmin={profile?.role === 'admin'}
            onSelect={handleSelectEquipment}
            onAddEquipment={() =>
              setQuickEquipment((value) => ({
                ...value,
                open: true,
                plate: search,
              }))
            }
            listRef={equipmentListRef}
            quickCreateSlot={
              quickEquipment.open ? (
                <QuickEquipmentForm
                  ref={quickEquipmentRef}
                  value={quickEquipment}
                  onChange={setQuickEquipment}
                  workshopMode={workshopMode}
                  saving={quickSaving}
                  selectedLessor={selectedQuickLessor}
                  onSelectLessor={setSelectedQuickLessor}
                  loadEquipmentTypes={loadEquipmentTypes}
                  loadLessors={loadLessors}
                  onCreateLessor={(query) =>
                    setQuickLessor({ open: true, name: query, error: '' })
                  }
                  onCancel={() => {
                    setQuickEquipment(EMPTY_QUICK_EQUIPMENT)
                    setSelectedQuickLessor(null)
                  }}
                  onSave={createQuickEquipment}
                />
              ) : null
            }
          />
        )}

        {step === 'details' && selected && (
          <div className="space-y-4">
            {/* Selected equipment info */}
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-bold">{selected.code}</h3>
                <BackButton
                  onClick={() => {
                    setStep('select')
                    setSelected(null)
                  }}
                />
              </div>
              <p className="text-sm text-muted">{selected.type}</p>
              {selected.plate_number && (
                <p className="text-sm text-muted">
                  {t('plateNumber')}: {selected.plate_number}
                </p>
              )}
              {selected.project && (
                <p className="text-sm text-muted">
                  {t('project')}:{' '}
                  {localizedName(
                    lang,
                    selected.project.name_ar,
                    selected.project.name_en,
                  )}
                </p>
              )}
            </div>

            <MovementStatusCard
              loading={loadingMovement}
              lastMovement={lastMovement}
              isEntry={isEntry}
              blocked={!!validationError}
            />

            {/* Validation warning */}
            {validationError && (
              <Alert type="error">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{validationError}</span>
                </div>
              </Alert>
            )}

            {/* Form fields */}
            {!workshopMode &&
              !isEntry &&
              (loadingMovement || (lastMovement && !validationError)) && (
                <LastEntrySummary
                  loading={loadingMovement}
                  recordedAt={lastMovement?.recorded_at}
                  driverName={lastMovement?.driver_name}
                  driverMobile={lastMovement?.driver_mobile_number}
                  contractorCode={lastMovement?.contractor_equipment_code}
                  companyName={optionalLocalizedName(
                    lastMovement?.company_name_ar,
                    lastMovement?.company_name_en,
                  )}
                  projectName={optionalLocalizedName(
                    lastMovement?.project_name_ar,
                    lastMovement?.project_name_en,
                  )}
                />
              )}

            <div className="space-y-4">
              {!workshopMode && isEntry ? (
                <>
                  <Field label={t('company')} required>
                    {() => (
                      <AsyncSearchSelect
                        value={selectedCompanyId}
                        selectedOption={selectedCompany}
                        onChange={(value, option) => {
                          setSelectedCompanyId(value)
                          setSelectedCompany(option)
                        }}
                        placeholder={t('selectCompany')}
                        loadOptions={loadCompanies}
                      />
                    )}
                  </Field>

                  <Field label={t('project')} required>
                    {() => (
                      <AsyncSearchSelect
                        value={selectedProjectId}
                        selectedOption={selectedProject}
                        onChange={(value, option) => {
                          setSelectedProjectId(value)
                          setSelectedProject(option)
                        }}
                        placeholder={t('selectProject')}
                        loadOptions={loadProjects}
                      />
                    )}
                  </Field>

                  <Field label={t('contractorEquipmentCode')}>
                    {(control) => (
                      <Input
                        {...control}
                        type="text"
                        value={contractorCode}
                        placeholder={t('contractorCodePlaceholder')}
                        onChange={(e) => setContractorCode(e.target.value)}
                        dir="ltr"
                      />
                    )}
                  </Field>
                </>
              ) : null}

              {/* Site EXIT has no driver field: the exit inherits the latest
                  current driver of the open visit server-side. */}
              {!workshopMode && isEntry && (
                <Field label={t('driverName')} required>
                  {() => (
                    <AsyncSearchSelect
                      value={driverId}
                      selectedOption={selectedDriver}
                      onChange={(value, option) => {
                        setDriverId(value)
                        setSelectedDriver(option)
                      }}
                      loadOptions={loadDrivers}
                      placeholder={t('selectDriver')}
                      createLabel={`${t('addNewDriver')} +`}
                      onCreate={(query) =>
                        setQuickDriver({
                          open: true,
                          fullName: query,
                          mobile: '',
                        })
                      }
                      alwaysShowCreate
                    />
                  )}
                </Field>
              )}
              {!workshopMode && isEntry && quickDriver.open && (
                <QuickDriverForm
                  value={quickDriver}
                  onChange={setQuickDriver}
                  saving={quickSaving}
                  onCancel={() => setQuickDriver(EMPTY_QUICK_DRIVER)}
                  onSave={createQuickDriver}
                />
              )}

              <Field label={t('actualMovementTime')}>
                {(control) => (
                  <DatePicker
                    {...control}
                    value={movementDate}
                    onChange={updateMovementDate}
                    max={currentLocalDateTime.slice(0, 10)}
                    placeholder={t('date')}
                  />
                )}
              </Field>

              <Field label={t('notes')}>
                {(control) => (
                  <Textarea
                    {...control}
                    value={notes}
                    placeholder={t('notesPlaceholder')}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                )}
              </Field>

              <MovementPhotosSection
                photos={stagedPhotos}
                selectedIndex={photoIndex}
                onSelectIndex={setPhotoIndex}
                uploading={uploadingPhotos}
                required={workshopMode}
                onAddFiles={handleAddPhotos}
                onRemoveIndex={handleRemovePhoto}
                onRetryPhoto={photoStaging.retryPhoto}
              />
            </div>

            <div ref={successRef} className="space-y-3">
              {saveError && <Alert type="error">{saveError}</Alert>}
              {saveWarning && <Alert type="warning">{saveWarning}</Alert>}
              {movementSaved && (
                <Alert type="success">{t('movementSavedSuccess')}</Alert>
              )}

              {/* Actions */}
              {!movementSaved ? (
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={onClose}
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={handleSave}
                    loading={saving}
                    disabled={
                      saving ||
                      uploadingPhotos ||
                      !!validationError ||
                      loadingMovement ||
                      (stagedPhotos.length > 0 && !photoStaging.ready)
                    }
                  >
                    {saving ? t('saving') : t('save')}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {onViewMovement && (
                    <Button
                      variant="primary"
                      onClick={() => onViewMovement(savedMovementId)}
                    >
                      {t('viewMovement')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      reset()
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                  >
                    {t('registerAnotherMovement')}
                  </Button>
                  {onGoHome && (
                    <Button
                      variant="outline"
                      className="col-span-2"
                      onClick={onGoHome}
                    >
                      {t('dashboard')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </MovementFormShell>

      <QuickLessorDialog
        value={quickLessor}
        onChange={setQuickLessor}
        saving={quickSaving}
        onClose={() => setQuickLessor(EMPTY_QUICK_LESSOR)}
        onSave={createQuickLessor}
      />
    </>
  )
}
