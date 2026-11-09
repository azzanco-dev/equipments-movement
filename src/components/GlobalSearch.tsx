import type { RoutePage } from '@/lib/navPermissions'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { usePathname } from 'next/navigation'
import {
  AlertCircle,
  Briefcase,
  FileSearch,
  FileText,
  FolderKanban,
  Truck,
  UserRound,
} from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { AppLink, SearchInput, Spinner, cn } from '@/components/ui'
import {
  GLOBAL_SEARCH_DEBOUNCE_MS,
  globalSearchGroupsFor,
  globalSearchTerm,
  type GlobalSearchGroupId,
} from '@/lib/globalSearch'
import {
  fetchGlobalSearch,
  type GlobalSearchGroupResult,
} from '@/lib/globalSearchData'

const GROUP_ICON: Record<GlobalSearchGroupId, JSX.Element> = {
  equipment: <Truck size={14} />,
  drivers: <UserRound size={14} />,
  companies: <Briefcase size={14} />,
  projects: <FolderKanban size={14} />,
  purchaseOrders: <FileText size={14} />,
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; groups: GlobalSearchGroupResult[] }
  | { kind: 'error' }

/**
 * The header's general search (owner 2026-11-08, approved on /ui-kit
 * «نموذج الهيدر الجديد», variant «ب»): units, drivers, companies, projects
 * and supplier POs in one field, only the groups whose page the shell opens
 * (`opens`). Ctrl K / Cmd K focuses it from anywhere; the results hang under
 * the field, each a real link (right click › new tab works), the arrows move
 * between them and Escape closes.
 */
export function GlobalSearch({
  opens,
  autoFocus = false,
  onNavigated,
}: {
  opens: (page: RoutePage) => boolean
  autoFocus?: boolean
  /** Runs after a result is followed (the phone row closes itself). */
  onNavigated?: () => void
}) {
  const { t, lang } = useI18n()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = 'global-search-results'

  // The parent's `opens` is a new function on every render: the groups are
  // keyed by their ids so the search does not run again for nothing.
  const allowed = globalSearchGroupsFor(opens)
  // A unit's link depends on which of its two pages are open.
  const groupKey = [
    ...allowed.map((group) => group.id),
    opens('equipment/:id') ? 'unit' : '',
    opens('inquiry') ? 'inquiry' : '',
  ].join(',')
  const opensRef = useRef(opens)
  opensRef.current = opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => allowed, [groupKey])
  const term = globalSearchTerm(query)

  // A followed result (or any navigation) closes and clears the search.
  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [pathname])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        // Only the visible field takes the shortcut.
        if (!inputRef.current?.offsetParent) return
        event.preventDefault()
        inputRef.current.focus()
        setOpen(true)
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  useEffect(() => {
    if (!term || groups.length === 0) {
      setState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    setState({ kind: 'loading' })
    const timer = window.setTimeout(() => {
      fetchGlobalSearch(
        term,
        groups,
        lang,
        t,
        (page) => opensRef.current(page),
        controller.signal,
      ).then(
        (result) => setState({ kind: 'done', groups: result }),
        () => {
          if (!controller.signal.aborted) setState({ kind: 'error' })
        },
      )
    }, GLOBAL_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [term, groups, lang, t])

  if (groups.length === 0) return null

  const links = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLAnchorElement>(
        'a[data-search-result]',
      ) ?? [],
    )
  const moveFocus = (step: 1 | -1) => {
    const items = links()
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLAnchorElement)
    if (current === -1 && step === -1) return
    const next = current + step
    if (next < 0) inputRef.current?.focus()
    else items[Math.min(next, items.length - 1)]?.focus()
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      moveFocus(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
    }
  }

  const visible = open && query.trim().length > 0
  const shown =
    state.kind === 'done'
      ? state.groups.filter((group) => group.items.length > 0)
      : []
  const someFailed =
    state.kind === 'done' && state.groups.some((group) => group.failed)

  return (
    <div ref={boxRef} className="relative w-full" onKeyDown={onKeyDown}>
      <SearchInput
        ref={inputRef}
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('globalSearchPlaceholder')}
        aria-label={t('globalSearchLabel')}
        aria-controls={visible ? panelId : undefined}
        aria-expanded={visible}
        autoComplete="off"
        className="[&_input]:rounded-full [&_input]:!bg-surface lg:[&_input]:!pe-24"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute end-9 top-1/2 hidden -translate-y-1/2 rounded-md border bg-bg px-1.5 font-latin text-[10px] leading-5 text-muted lg:block"
      >
        {/* The direction on the inner text only: on the kbd itself it would
            turn its logical «end» into the right edge. */}
        <span dir="ltr">Ctrl K</span>
      </kbd>
      {visible && (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label={t('globalSearchLabel')}
          aria-live="polite"
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[min(24rem,70dvh)] overflow-y-auto rounded-xl border bg-bg p-1.5 shadow-lg"
        >
          {!term ? (
            <p className="px-2 py-3 text-center text-sm text-muted">
              {t('globalSearchMinChars')}
            </p>
          ) : state.kind === 'loading' || state.kind === 'idle' ? (
            <p className="flex items-center justify-center gap-2 px-2 py-3 text-sm text-muted">
              <Spinner size="sm" />
              {t('globalSearchSearching')}
            </p>
          ) : state.kind === 'error' ? (
            <p className="flex items-center justify-center gap-2 px-2 py-3 text-sm text-danger">
              <AlertCircle size={16} aria-hidden="true" />
              {t('globalSearchError')}
            </p>
          ) : (
            <>
              {shown.length === 0 && !someFailed && (
                <p className="px-2 py-3 text-center text-sm text-muted">
                  {t('globalSearchNoResults')}
                </p>
              )}
              {shown.map((group) => (
                <div key={group.id} className="py-1">
                  <p className="flex items-center gap-1.5 px-2 pb-1 text-[11px] text-muted">
                    <span aria-hidden="true">{GROUP_ICON[group.id]}</span>
                    {t(group.label)}
                  </p>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-1">
                        <AppLink
                          href={item.href}
                          data-search-result=""
                          onClick={() => onNavigated?.()}
                          className="flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <span
                            className={cn(
                              'shrink-0 font-semibold',
                              !item.ltr && 'truncate-safe max-w-[60%]',
                            )}
                            dir={item.ltr ? 'ltr' : undefined}
                          >
                            {item.title}
                          </span>
                          <span className="truncate-safe min-w-0 flex-1 text-xs text-muted">
                            {item.detail}
                          </span>
                        </AppLink>
                        {/* Owner 2026-11-08, «اضف للبحث العام صفحة استعلام
                            عن معدة»: the unit's inquiry beside its page. */}
                        {item.inquiryHref && (
                          <AppLink
                            href={item.inquiryHref}
                            data-search-result=""
                            onClick={() => onNavigated?.()}
                            aria-label={t('globalSearchInquiryFor').replace(
                              '{code}',
                              item.title,
                            )}
                            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-fg focus-visible:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <FileSearch size={14} aria-hidden="true" />
                            {t('globalSearchInquiry')}
                          </AppLink>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {someFailed && (
                <p className="flex items-center gap-1.5 px-2 py-2 text-xs text-danger">
                  <AlertCircle size={14} aria-hidden="true" />
                  {t('globalSearchPartialError')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
