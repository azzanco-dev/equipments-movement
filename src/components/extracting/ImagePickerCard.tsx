import type { ChangeEvent } from 'react'
import { FileImage, ScanText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useI18n } from '@/i18n/I18nContext'
import { OCR_IMAGE_TYPES } from '@/lib/extracting/ocr'

interface ImagePickerCardProps {
  image: File | null
  preview: string
  reading: boolean
  disabled: boolean
  onChoose: (file: File) => void
  onRead: () => void
}

export function ImagePickerCard({
  image,
  preview,
  reading,
  disabled,
  onChoose,
  onRead,
}: ImagePickerCardProps) {
  const { t } = useI18n()
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset so choosing the same file again still fires a change.
    event.target.value = ''
    if (file) onChoose(file)
  }

  return (
    <Card className="space-y-4">
      <label className="block cursor-pointer rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:bg-surface-hover">
        <input
          className="sr-only"
          type="file"
          accept={OCR_IMAGE_TYPES.join(',')}
          onChange={handleChange}
        />
        <FileImage className="mx-auto mb-2 text-muted" aria-hidden="true" />
        <span className="block font-medium">
          {image ? (
            <>
              <span dir="auto">{image.name}</span> (
              {Math.round(image.size / 1024)} {t('extractingKilobytes')})
            </>
          ) : (
            t('extractingChooseImage')
          )}
        </span>
        <span className="mt-1 block text-sm text-muted">
          {t('extractingImageHint')}
        </span>
      </label>
      {preview ? (
        <div className="flex h-80 items-center justify-center rounded-lg bg-surface">
          <img
            src={preview}
            alt={t('extractingPreviewAlt')}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={<ScanText size={17} aria-hidden="true" />}
          loading={reading}
          disabled={!image || disabled}
          onClick={onRead}
        >
          {t('extractingRead')}
        </Button>
      </div>
    </Card>
  )
}
