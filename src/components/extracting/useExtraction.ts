import { useEffect, useState } from 'react'
import type { NoticeTone } from '@/components/ui/Notice'
import type { TranslationKey } from '@/i18n/translations'
import {
  ExtractingApiError,
  extractIdentity,
  publishExtraction,
} from '@/lib/extracting/client'
import {
  EXTRACTION_FIELDS,
  applyFormPatch,
  createDefaultForm,
  validateExtractionForm,
  type ExtractionFieldKey,
  type ExtractionForm,
  type PublishResults,
  type PublishTarget,
  type PublishTargets,
} from '@/lib/extracting/form'
import {
  errorMessageKey,
  FIELD_ERROR_MESSAGES,
} from '@/lib/extracting/messages'
import { OCR_IMAGE_TYPES, OCR_MAX_BYTES } from '@/lib/extracting/ocr'
import { focusFirstError, type FieldErrors } from '@/lib/formValidation'
import { saudiDateKey } from '@/lib/saudiTime'

export type ExtractionStage = 'idle' | 'extracting' | 'review' | 'publishing'

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
      setResults(await publishExtraction(token, form, targets))
      setNotice({ tone: 'success', message: 'extractingPublishDone' })
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
    chooseImage,
    updateField,
    setTarget,
    extract,
    publish,
  }
}
