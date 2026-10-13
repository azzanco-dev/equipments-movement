import { useEffect, useRef, useState } from 'react'
import type { NoticeTone } from '@/components/ui/Notice'
import type { TranslationKey } from '@/i18n/translations'
import {
  ExtractingApiError,
  extractIdentity,
  lookupExtraction,
  publishExtraction,
} from '@/lib/extracting/client'
import {
  EXTRACTION_FIELDS,
  applyFormPatch,
  createDefaultForm,
  isValidIdNumber,
  validateExtractionForm,
  type ExtractionFieldKey,
  type ExtractionForm,
  type PublishResults,
  type PublishTarget,
  type PublishTargets,
} from '@/lib/extracting/form'
import { publishModeFor, type LookupResult } from '@/lib/extracting/lookup'
import {
  errorMessageKey,
  FIELD_ERROR_MESSAGES,
} from '@/lib/extracting/messages'
import { OCR_IMAGE_TYPES, OCR_MAX_BYTES } from '@/lib/extracting/ocr'
import { focusFirstError, type FieldErrors } from '@/lib/formValidation'
import { saudiDateKey } from '@/lib/saudiTime'

export type ExtractionStage = 'idle' | 'extracting' | 'review' | 'publishing'

/** The existing-record lookup for the reviewed residence number. */
export type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: LookupResult }
  | { status: 'error'; message: TranslationKey }

/** Waits this long after the residence number stops changing. */
const LOOKUP_DEBOUNCE_MS = 400

export interface ExtractionNotice {
  tone: NoticeTone
  message: TranslationKey
  /** OCR provider HTTP status, shown to help diagnose a provider failure. */
  providerStatus?: number
}

/** Today's Saudi date in the DD-MM-YYYY format the form uses. */
function saudiToday() {
  const [year, month, day] = saudiDateKey().split('-')
  return `${day}-${month}-${year}`
}

function failureNotice(error: unknown, fallback: string): ExtractionNotice {
  const apiError = error instanceof ExtractingApiError ? error : null
  return {
    tone: 'danger',
    message: errorMessageKey(apiError?.code ?? fallback),
    providerStatus: apiError?.providerStatus,
  }
}

export function useExtraction(token: string | undefined) {
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [form, setForm] = useState<ExtractionForm>(() =>
    createDefaultForm(saudiToday()),
  )
  const [targets, setTargets] = useState<PublishTargets>({
    currentSystem: true,
    erpnext: false,
  })
  const [errors, setErrors] = useState<FieldErrors<ExtractionForm>>({})
  const [stage, setStage] = useState<ExtractionStage>('idle')
  const [notice, setNotice] = useState<ExtractionNotice | null>(null)
  const [results, setResults] = useState<PublishResults | null>(null)
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' })
  // Bumped after a publish so the card reflects the records just written.
  const [lookupVersion, setLookupVersion] = useState(0)
  const lookupRequest = useRef(0)

  // Looks up the existing records once the fields are under review and the
  // residence number is valid, debounced while the admin edits it; a stale
  // answer (an older number, a reset photo) is ignored by its sequence.
  const idNumber = form.id_number.trim()
  const reviewing = stage === 'review' || stage === 'publishing'
  useEffect(() => {
    const sequence = ++lookupRequest.current
    if (!token || !reviewing || !isValidIdNumber(idNumber)) {
      setLookup({ status: 'idle' })
      return
    }
    setLookup({ status: 'loading' })
    const timer = window.setTimeout(() => {
      lookupExtraction(token, idNumber).then(
        (result) => {
          if (sequence === lookupRequest.current)
            setLookup({ status: 'ready', result })
        },
        (error: unknown) => {
          if (sequence === lookupRequest.current)
            setLookup({
              status: 'error',
              message: failureNotice(error, 'lookup_failed').message,
            })
        },
      )
    }, LOOKUP_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [token, reviewing, idNumber, lookupVersion])

  const mode = publishModeFor(
    lookup.status === 'ready' ? lookup.result : null,
    idNumber,
    targets,
  )

  // Revokes the previous preview URL whenever it is replaced or unmounted.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )

  const chooseImage = (file: File) => {
    if (!OCR_IMAGE_TYPES.includes(file.type)) {
      setNotice({ tone: 'danger', message: 'extractingErrUnsupportedImage' })
      return
    }
    if (file.size === 0 || file.size > OCR_MAX_BYTES) {
      setNotice({ tone: 'danger', message: 'extractingErrImageTooLarge' })
      return
    }
    setPreview(URL.createObjectURL(file))
    setImage(file)
    setStage('idle')
    setNotice(null)
    setResults(null)
    setErrors({})
    setForm(createDefaultForm(saudiToday()))
  }

  const updateField = (key: ExtractionFieldKey, value: string) => {
    setForm((current) => applyFormPatch(current, { [key]: value }))
    if (errors[key])
      setErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
  }

  const setTarget = (key: PublishTarget, checked: boolean) => {
    setTargets((current) => ({ ...current, [key]: checked }))
    // Required fields depend on the targets; re-check on the next submit.
    setErrors({})
  }

  const extract = async () => {
    if (!image || !token) return
    setStage('extracting')
    setNotice(null)
    setResults(null)
    try {
      const fields = await extractIdentity(token, image)
      setForm((current) => applyFormPatch(current, fields))
      setStage('review')
      setNotice({ tone: 'info', message: 'extractingReviewNotice' })
    } catch (error) {
      setStage('idle')
      setNotice(failureNotice(error, 'ocr_failed'))
    }
  }

  const publish = async () => {
    if (!token || stage !== 'review') return
    if (!targets.currentSystem && !targets.erpnext) {
      setNotice({ tone: 'danger', message: 'extractingSelectTarget' })
      return
    }
    const invalid = validateExtractionForm(form, targets)
    const fieldErrors: FieldErrors<ExtractionForm> = {}
    for (const key of EXTRACTION_FIELDS) {
      const code = invalid[key]
      if (code) fieldErrors[key] = FIELD_ERROR_MESSAGES[code]
    }
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) {
      setNotice({ tone: 'danger', message: 'extractingFixFields' })
      focusFirstError(fieldErrors, EXTRACTION_FIELDS)
      return
    }

    setStage('publishing')
    setNotice(null)
    setResults(null)
    try {
      setResults(await publishExtraction(token, form, targets, mode))
      setNotice({ tone: 'success', message: 'extractingPublishDone' })
      setLookupVersion((version) => version + 1)
    } catch (error) {
      setNotice(failureNotice(error, 'publish_failed'))
    } finally {
      setStage('review')
    }
  }

  return {
    image,
    preview,
    form,
    targets,
    errors,
    stage,
    notice,
    results,
    lookup,
    mode,
    chooseImage,
    updateField,
    setTarget,
    extract,
    publish,
  }
}
