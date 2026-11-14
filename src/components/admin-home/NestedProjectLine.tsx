import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import type { FleetEquipmentRow } from '@/lib/adminHomeStats'

/**
 * «تابعة لمشروع {project}» under the identity of a unit that is in the
 * workshop while its project visit is open (nested workshop stays,
 * 2026-11-14). Nothing when no project visit is open, or against an older
 * database that does not return the project columns.
 */
export function NestedProjectLine({
  row,
}: {
  row: Pick<FleetEquipmentRow, 'siteProjectNameAr' | 'siteProjectNameEn'>
}) {
  const { t, lang } = useI18n()
  if (!row.siteProjectNameAr && !row.siteProjectNameEn) return null
  return (
    <span className="block text-xs text-muted">
      {t('nestedUnderProjectLine').replace(
        '{project}',
        localizedName(lang, row.siteProjectNameAr, row.siteProjectNameEn),
      )}
    </span>
  )
}
