import { Card, SectionHeader } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { useI18n } from '@/i18n/I18nContext'
import type { PublishTarget, PublishTargets } from '@/lib/extracting/form'
import { TARGET_LABELS } from '@/lib/extracting/messages'

const TARGETS: PublishTarget[] = ['currentSystem', 'erpnext']

interface PublishTargetsCardProps {
  targets: PublishTargets
  onChange: (target: PublishTarget, checked: boolean) => void
}

export function PublishTargetsCard({
  targets,
  onChange,
}: PublishTargetsCardProps) {
  const { t } = useI18n()
  return (
    <Card className="space-y-2">
      <SectionHeader as="h2" title={t('extractingTargetsSection')} />
      <div className="flex flex-wrap gap-x-6">
        {TARGETS.map((target) => (
          <Checkbox
            key={target}
            label={t(TARGET_LABELS[target])}
            checked={targets[target]}
            onCheckedChange={(checked) => onChange(target, checked === true)}
          />
        ))}
      </div>
    </Card>
  )
}
