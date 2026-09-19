import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Badge,
  Popover,
  PopoverAnchor,
  PopoverContent,
  SearchInput,
  Spinner,
  cn,
} from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import type { EquipmentPresence } from '@/lib/visitTimeline'

export interface EquipmentSuggestion {
  id: string
  code: string
  /** Equipment type name, already localized by the caller. */
  type_name?: string | null
  plate_number?: string | null
  chassis_number?: string | null
  /** Where the equipment is right now, for the small state badge. */
  state?: EquipmentPresence
}

export interface EquipmentSuggestSearchProps {
  query: string
  onQueryChange: (query: string) => void
  /** Already-filtered results; the component never fetches or filters. */
  suggestions: EquipmentSuggestion[]
  loading?: boolean
  onPick: (suggestion: EquipmentSuggestion) => void
  selected?: EquipmentSuggestion | null
  placeholder?: string
  className?: string
}

const STATE_TONE: Record<EquipmentPresence, BadgeTone> = {
  inside_site: 'success',
  inside_workshop: 'info',
  outside: 'neutral',
}

const STATE_LABEL = {
  inside_site: 'insideSite',
  inside_workshop: 'insideWorkshop',
  outside: 'outsideSite',
} as const

/**
 * One search field that suggests equipment as the user types and lets them
 * pick exactly one. Fully controlled: the query, the results, and the loading
 * flag all come from the caller, so a real screen can wire it to an RPC
 * (server-side search, best 20 results) without touching this component.
 */
export function EquipmentSuggestSearch({
  query,
  onQueryChange,
  suggestions,
  loading = false,
  onPick,
  selected,
  placeholder,
  className,
}: EquipmentSuggestSearchProps) {
  const { t } = useI18n()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  // A new result set invalidates the highlighted row.
  useEffect(() => {
    setActiveIndex(0)
  }, [suggestions])

  const hasPanel = query.trim().length > 0
  const panelOpen = open && hasPanel
  const activeId =
    panelOpen && suggestions[activeIndex]
      ? `${listId}-${suggestions[activeIndex].id}`
      : undefined

  function pick(suggestion: EquipmentSuggestion) {
    onPick(suggestion)
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (panelOpen) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!panelOpen) {
        setOpen(true)
        return
      }
      if (suggestions.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex(
        (index) => (index + step + suggestions.length) % suggestions.length,
      )
      return
    }
    if (event.key === 'Home' && panelOpen && suggestions.length > 0) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End' && panelOpen && suggestions.length > 0) {
      event.preventDefault()
      setActiveIndex(suggestions.length - 1)
      return
    }
    if (event.key === 'Enter' && panelOpen) {
      const suggestion = suggestions[activeIndex]
      if (suggestion) {
        event.preventDefault()
        pick(suggestion)
      }
    }
  }

  return (
    <div className={cn('relative', className)}>
      <Popover open={panelOpen} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div>
            <SearchInput
              value={query}
              onValueChange={(value) => {
                onQueryChange(value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              // A click on an already-focused field counts as an outside
              // interaction and closes the panel; reopen it on the click.
              onClick={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder ?? t('searchEquipmentAnyField')}
              role="combobox"
              autoComplete="off"
              aria-expanded={panelOpen}
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          // Focus stays in the field so typing never stops; the highlighted
          // row is announced through aria-activedescendant instead.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={() => setOpen(false)}
          className="max-h-80 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-2.5 py-3 text-sm text-muted">
              <Spinner size="sm" />
              <span>{t('loading')}</span>
            </div>
          ) : suggestions.length === 0 ? (
            <p className="px-2.5 py-3 text-sm text-muted">{t('noResults')}</p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('equipmentSuggestions')}
              className="space-y-0.5"
            >
              {suggestions.map((suggestion, index) => (
                <SuggestionRow
                  key={suggestion.id}
                  id={`${listId}-${suggestion.id}`}
                  suggestion={suggestion}
                  active={index === activeIndex}
                  picked={selected?.id === suggestion.id}
                  onHover={() => setActiveIndex(index)}
                  onPick={() => pick(suggestion)}
                />
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function SuggestionRow({
  id,
  suggestion,
  active,
  picked,
  onHover,
  onPick,
}: {
  id: string
  suggestion: EquipmentSuggestion
  active: boolean
  picked: boolean
  onHover: () => void
  onPick: () => void
}) {
  const { t } = useI18n()
  const state = suggestion.state ?? 'outside'
  return (
    <li
      id={id}
      role="option"
      aria-selected={picked}
      onMouseEnter={onHover}
      // Keeps focus in the field: mousedown would blur it before the click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2',
        active && 'bg-surface-hover',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate-safe font-semibold" dir="ltr">
            {suggestion.code}
          </span>
          {picked && (
            <Check size={14} aria-hidden="true" className="shrink-0 text-fg" />
          )}
        </span>
        <span className="truncate-safe block text-xs text-muted">
          {suggestion.type_name || '—'}
          {suggestion.plate_number && (
            <>
              {' · '}
              <span dir="ltr">{suggestion.plate_number}</span>
            </>
          )}
        </span>
      </span>
      <Badge tone={STATE_TONE[state]}>{t(STATE_LABEL[state])}</Badge>
    </li>
  )
}
