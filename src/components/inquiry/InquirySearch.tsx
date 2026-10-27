import { useId, useState } from 'react'
import { ArrowLeft, ArrowRight, Search } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Badge, Spinner, cn } from '@/components/ui'
import { equipmentStateText, parseEquipmentState } from '@/lib/equipmentState'
import type { EquipmentSuggestion } from './EquipmentSuggestSearch'
import { InquiryPlate } from './InquiryPlate'
import { InquiryStateDot } from './inquiryStyle'

export interface InquirySearchProps {
  query: string
  onQueryChange: (query: string) => void
  /** Server-side suggestions for `query` (the screen fetches them). */
  suggestions: EquipmentSuggestion[]
  loading?: boolean
  onPick: (suggestion: EquipmentSuggestion) => void
  /** The page's start: a big field in the middle; small once a unit shows. */
  big: boolean
}

/**
 * The one field of the inquiry page (owner 2026-10-26: «نفس واجهات الAI
 * الرئيسية الي يكون الحقل في النص»): a rounded field with a round send
 * button, and the suggestions hanging under it in the layout — never a
 * popover measured in page coordinates, so the phone lifts the field itself
 * as the approved mobile search field does. Enter or the button shows the
 * highlighted suggestion.
 */
export function InquirySearch({
  query,
  onQueryChange,
  suggestions,
  loading = false,
  onPick,
  big,
}: InquirySearchProps) {
  const { t, lang } = useI18n()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const showList = open && query.trim().length > 0
  const activeId = suggestions[active] ? `${listId}-${suggestions[active].id}` : undefined
  const Send = lang === 'ar' ? ArrowLeft : ArrowRight
  const stateLabel = (value: unknown) => {
    const parsed = parseEquipmentState(value)
    return parsed ? equipmentStateText(t, parsed) : null
  }

  const choose = (suggestion: EquipmentSuggestion | undefined) => {
    if (!suggestion) return
    setOpen(false)
    onPick(suggestion)
  }

  return (
    <div className="relative w-full">
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl bg-bg pe-2 ps-4 shadow-md transition-[height] duration-500',
          big ? 'h-14' : 'h-11',
        )}
      >
        <Search size={big ? 20 : 17} aria-hidden="true" className="shrink-0 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActive((index) => Math.min(index + 1, suggestions.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter' && showList && suggestions[active]) {
              event.preventDefault()
              choose(suggestions[active])
            } else if (event.key === 'Escape') setOpen(false)
          }}
          placeholder={t('inquirySearchPlaceholder')}
          // An empty field keeps the page direction; a typed Latin code
          // reads left to right.
          dir={query ? 'auto' : undefined}
          role="combobox"
          aria-label={t('inquirySearchPlaceholder')}
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList ? activeId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="button"
          onClick={() => choose(suggestions[active] ?? suggestions[0])}
          disabled={suggestions.length === 0}
          aria-label={t('inquiryShowUnit')}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-contrast transition-opacity disabled:opacity-25',
            big ? 'h-10 w-10' : 'h-8 w-8',
          )}
        >
          <Send size={17} aria-hidden="true" />
        </button>
      </div>
      {showList && (
        <div
          className="inq-rise absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl bg-bg p-1.5 shadow-xl"
          style={{ animationDuration: '220ms' }}
        >
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
              <Spinner size="sm" />
              {t('loading')}
            </p>
          ) : suggestions.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">{t('noResults')}</p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('equipmentSuggestions')}
              className="space-y-0.5"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`${listId}-${suggestion.id}`}
                  role="option"
                  aria-selected={index === active}
                  // Keeps focus in the field: mousedown would blur it first.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(suggestion)}
                  // Taller rows (owner 2026-10-27: «زيد الارتفاع حق المعدة في
                  // قائمة اختيار المعدات في الاستعلام»).
                  className={cn(
                    'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm',
                    index === active && 'bg-surface-hover',
                  )}
                >
                  <InquiryStateDot
                    state={suggestion.equipment_state}
                    label={stateLabel(suggestion.equipment_state)}
                  />
                  <bdi dir="ltr" className="font-semibold">
                    {suggestion.code}
                  </bdi>
                  {suggestion.matched_previous_code && (
                    <Badge tone="neutral" size="sm">
                      {t('previousCodeBadge')}
                    </Badge>
                  )}
                  {suggestion.matched_company_number && (
                    <Badge tone="neutral" size="sm">
                      {t('companyNumber')}:{' '}
                      <bdi dir="ltr">{suggestion.matched_company_number}</bdi>
                    </Badge>
                  )}
                  <span className="min-w-0 flex-1 truncate-safe text-muted">
                    {suggestion.type_name || '—'}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    <InquiryPlate
                      plate={suggestion.plate_number ?? null}
                      chassis={suggestion.chassis_number ?? null}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
