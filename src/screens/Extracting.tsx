import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { FullPageSpinner } from '@/components/Spinner'
import { ExtractionFieldsCard } from '@/components/extracting/ExtractionFieldsCard'
import { ImagePickerCard } from '@/components/extracting/ImagePickerCard'
import { PublishResultCard } from '@/components/extracting/PublishResultCard'
import { PublishTargetsCard } from '@/components/extracting/PublishTargetsCard'
import { useExtraction } from '@/components/extracting/useExtraction'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { useI18n } from '@/i18n/I18nContext'
import type { ExtractionFieldKey, PublishTarget } from '@/lib/extracting/form'
import { AuthScreen } from '@/screens/AuthScreen'

const EXTRACTED_FIELDS: ExtractionFieldKey[] = [
  'full_name_ar',
  'full_name_en',
  'id_number',
  'date_of_birth',
  'residence_expiry_date',
  'nationality',
  'occupation',
]

const EMPLOYMENT_FIELDS: ExtractionFieldKey[] = [
  'gender',
  'language',
  'email',
  'employee_number',
  'mobile_number',
  'company',
  'employment_type',
  'department',
  'date_of_joining',
  'ctc',
]

function ExtractingWorkspace({ token }: { token: string | undefined }) {
  const { t } = useI18n()
  const extraction = useExtraction(token)
  const { form, errors, targets, stage, notice, results } = extraction
  const showReview = stage === 'review' || stage === 'publishing' || !!results

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void extraction.publish()
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <PageHeader
        title={t('extractingTitle')}
        description={t('extractingSubtitle')}
      />

      <ImagePickerCard
        image={extraction.image}
        preview={extraction.preview}
        reading={stage === 'extracting'}
        disabled={stage === 'publishing'}
        onChoose={extraction.chooseImage}
        onRead={() => void extraction.extract()}
      />

      {showReview ? (
        <form onSubmit={submit} noValidate className="space-y-6">
          <ExtractionFieldsCard
            title="extractingExtractedSection"
            fields={EXTRACTED_FIELDS}
            form={form}
            errors={errors}
            targets={targets}
            onChange={extraction.updateField}
          />
          <ExtractionFieldsCard
            title="extractingEmploymentSection"
            fields={EMPLOYMENT_FIELDS}
            form={form}
            errors={errors}
            targets={targets}
            onChange={extraction.updateField}
          />
          <PublishTargetsCard
            targets={targets}
            onChange={extraction.setTarget}
          />
          <Button
            type="submit"
            variant="primary"
            icon={<Send size={17} aria-hidden="true" />}
            loading={stage === 'publishing'}
          >
            {t('extractingSubmit')}
          </Button>
        </form>
      ) : null}

      {notice ? (
        <Notice tone={notice.tone}>
          {t(notice.message)}
          {notice.providerStatus ? (
            <span className="mt-1 block text-xs opacity-80">
              {t('extractingProviderStatus')}: {notice.providerStatus}
            </span>
          ) : null}
        </Notice>
      ) : null}

      {results ? (
        <section className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(results) as PublishTarget[]).map((target) => (
            <PublishResultCard
              key={target}
              target={target}
              result={results[target]}
            />
          ))}
        </section>
      ) : null}
    </main>
  )
}

/** Admin-only residence permit OCR and driver/ERPNext publishing. */
export function Extracting() {
  const { t } = useI18n()
  const { session, profile, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!profile) return <AuthScreen />
  if (profile.role !== 'admin')
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold">
            {t('extractingNotAuthorized')}
          </h1>
          <p className="mt-2 text-muted">{t('extractingAdminOnly')}</p>
        </Card>
      </main>
    )
  return <ExtractingWorkspace token={session?.access_token} />
}
