import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Edit2 } from 'lucide-react'
import { Button, Dialog, IconButton } from '@/components/ui'
import { CompletenessRing } from '@/components/parties/CompletenessRing'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import type { Completeness } from '@/lib/partyCompleteness'

/** One fact of a supplier or a client. */
export interface PartyDetailsItem {
  label: string
  /** The stored value; empty shows «غير مسجل». */
  value?: string | null
  /** How it is shown when it differs from the stored text (the IBAN in
   *  groups of four, the short address «RRRD 2929»). */
  display?: string
  /** Numbers, codes, the email: read left to right. */
  ltr?: boolean
  /** Offers a copy button (the numbers, the IBAN, the email). */
  copy?: boolean
  /** Opens the phone or the mail app (`tel:` / `mailto:`). */
  href?: string
  /** Spans both columns (the full address). */
  wide?: boolean
  /** A picture before the value (the bank's logo). */
  icon?: ReactNode
}

export interface PartyDetailsSection {
  title: TranslationKey
  icon: ReactNode
  items: PartyDetailsItem[]
}

export interface PartyDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: TranslationKey
  /** The supplier's or the client's name, bold at the top. */
  heading: ReactNode
  /** A muted line under the name (the client's English name, the
   *  supplier's contact person). */
  subheading?: ReactNode
  /** The avatar's icon: the sidebar's (Building2 for a supplier,
   *  Briefcase for a client). */
  icon: ReactNode
  /** The list's completeness ring, repeated in the header. */
  completeness?: Completeness
  sections: readonly PartyDetailsSection[]
  /** Omitted without the edit key: no «تعديل». */
  onEdit?: () => void
  /** The dialog width; the supplier's is `lg` (owner 2026-11-05, «وسع
   *  dialog تفاصيل المورد»). */
  size?: 'md' | 'lg'
  /** Shown after the sections: the «المستندات» of 0182. */
  children?: ReactNode
}

/**
 * The read-only facts of a supplier or a client (EM-260, 0175), redesigned
 * on the owner's «حسن الdialog حق التفاصيل … خليها جمالي اكثر» (2026-11-05):
 * a header with an avatar, the name, a muted line under it and the
 * completeness ring; then one soft card per section with its icon, the facts
 * in two columns (label over value), «غير مسجل» for an empty one, a copy
 * button on the numbers and links for the phone and the email. Token
 * colours only.
 */
export function PartyDetailsDialog({
  open,
  onOpenChange,
  title,
  heading,
  subheading,
  icon,
  completeness,
  sections,
  onEdit,
  size = 'md',
  children,
}: PartyDetailsDialogProps) {
  const { t } = useI18n()
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(title)}
      size={size}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          {onEdit && (
            <Button
              variant="primary"
              icon={<Edit2 size={16} aria-hidden="true" />}
              onClick={onEdit}
            >
              {t('edit')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <header className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-[var(--surface)] text-muted"
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-7">{heading}</p>
            {subheading && <p className="text-sm text-muted">{subheading}</p>}
          </div>
          {completeness && (
            <div className="flex shrink-0 flex-col items-center gap-1">
              <CompletenessRing value={completeness} />
              <span className="text-[11px] text-muted">
                {t('completeness')}
              </span>
            </div>
          )}
        </header>
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-xl border bg-[var(--surface)] p-4"
          >
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden="true" className="text-muted">
                {section.icon}
              </span>
              {t(section.title)}
            </h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {section.items.map((item) => (
                <DetailsItem key={item.label} item={item} />
              ))}
            </dl>
          </section>
        ))}
        {children}
      </div>
    </Dialog>
  )
}

function DetailsItem({ item }: { item: PartyDetailsItem }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const value = item.value?.trim()
  const shown = item.display ?? value
  const text = item.ltr ? <bdi dir="ltr">{shown}</bdi> : shown

  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // A browser without clipboard access: nothing to report.
    }
  }

  return (
    <div className={item.wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <dt className="text-xs text-muted">{item.label}</dt>
      <dd className="mt-0.5 flex min-h-7 items-center gap-1 text-sm font-medium">
        {value ? (
          <>
            {item.href ? (
              <a
                href={item.href}
                className="min-w-0 break-words underline-offset-4 hover:underline"
              >
                {text}
              </a>
            ) : (
              <span className="flex min-w-0 items-center gap-2 break-words">
                {item.icon}
                {text}
              </span>
            )}
            {item.copy && (
              <IconButton
                size="sm"
                label={copied ? t('detailsCopied') : t('detailsCopy')}
                title={copied ? t('detailsCopied') : t('detailsCopy')}
                icon={
                  copied ? (
                    <Check size={14} className="text-[var(--success)]" />
                  ) : (
                    <Copy size={14} />
                  )
                }
                onClick={copy}
              />
            )}
          </>
        ) : (
          <span className="text-xs font-normal text-placeholder">
            {t('detailsNotRecorded')}
          </span>
        )}
      </dd>
    </div>
  )
}
