import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import type { SelectOption } from '@/components/Select'
import { prepareFloatingMenu } from '@/lib/floatingMenu'

interface AsyncMultiSelectProps {
  value: SelectOption[]
  onChange: (value: SelectOption[]) => void
  loadOptions: (query: string) => Promise<SelectOption[]>
  placeholder?: string
  disabled?: boolean
  loadAllOptions?: () => Promise<SelectOption[]>
}

export function AsyncMultiSelect({
  value,
  onChange,
  loadOptions,
  placeholder = '—',
  disabled = false,
  loadAllOptions,
}: AsyncMultiSelectProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<SelectOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectingAll, setSelectingAll] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef(0)
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 260,
    maxHeight: 240,
    openAbove: false,
  })

  const updatePosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const padding = 8
    const gap = 4
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - gap - padding,
    )
    const availableAbove = Math.max(0, rect.top - gap - padding)
    const openAbove = availableAbove > availableBelow
    const availableHeight = openAbove ? availableAbove : availableBelow
    const width = Math.min(
      Math.max(rect.width, 260),
      window.innerWidth - padding * 2,
    )
    const rtl = (document.documentElement.dir || 'rtl') === 'rtl'
    const preferredLeft = rtl ? rect.right - width : rect.left
    setPosition({
      top: openAbove ? rect.top - gap : rect.bottom + gap,
      left: Math.min(
        Math.max(padding, preferredLeft),
        window.innerWidth - width - padding,
      ),
      width,
      maxHeight: Math.min(240, Math.max(96, availableHeight)),
      openAbove,
    })
  }, [])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    if (!open) return
    updatePosition()
    inputRef.current?.focus()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const requestId = ++requestRef.current
    const timer = window.setTimeout(
      async () => {
        setLoading(true)
        try {
          const next = await loadOptions(query.trim())
          if (requestId === requestRef.current) setOptions(next.slice(0, 20))
        } finally {
          if (requestId === requestRef.current) setLoading(false)
        }
      },
      query ? 300 : 0,
    )
    return () => window.clearTimeout(timer)
  }, [loadOptions, open, query])

  const toggle = (option: SelectOption) => {
    const selected = value.some((item) => item.value === option.value)
    onChange(
      selected
        ? value.filter((item) => item.value !== option.value)
        : [...value, option],
    )
  }

  const selectAll = async () => {
    if (!loadAllOptions) return
    setSelectingAll(true)
    try {
      const all = await loadAllOptions()
      onChange(all)
    } finally {
      setSelectingAll(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (disabled) return
          if (!open) prepareFloatingMenu(rootRef.current, updatePosition, 240)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="flex min-h-8 w-full cursor-text items-center gap-1 rounded-lg border bg-transparent px-2 py-1 text-sm outline-none focus:border-black dark:focus:border-white"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {value.length === 0 ? (
            <span className="px-1 text-gray-400">{placeholder}</span>
          ) : (
            value.map((option) => (
              <span
                key={option.value}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800"
              >
                <span className="truncate">{option.label}</span>
                <button
                  type="button"
                  aria-label={t('clear')}
                  className="shrink-0 rounded hover:text-red-600"
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange(
                      value.filter((item) => item.value !== option.value),
                    )
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronDown
          size={15}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            className="fixed z-[100] flex flex-col overflow-hidden rounded-lg border shadow-lg"
            dir={document.documentElement.dir || 'rtl'}
            style={{
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
              background: 'var(--bg)',
              borderColor: 'var(--border)',
              ...(position.openAbove
                ? { bottom: window.innerHeight - position.top }
                : { top: position.top }),
            }}
          >
            <div
              className="relative border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <Search
                size={14}
                className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchInList')}
                className="w-full bg-transparent py-2 ps-9 pe-3 text-sm outline-none"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-5 text-sm text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  {t('loading')}
                </div>
              ) : options.length === 0 ? (
                <div className="px-3 py-5 text-center text-sm text-muted">
                  {t('noResults')}
                </div>
              ) : (
                options.map((option) => {
                  const selected = value.some(
                    (item) => item.value === option.value,
                  )
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => toggle(option)}
                      className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-start text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${selected ? 'font-semibold' : ''}`}
                    >
                      <span>{option.label}</span>
                      {selected && <Check size={14} />}
                    </button>
                  )
                })
              )}
            </div>
            {loadAllOptions && (
              <div
                className="flex items-center gap-2 border-t p-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <button
                  type="button"
                  className="btn-ghost flex-1 justify-center text-xs"
                  disabled={selectingAll}
                  onClick={() => void selectAll()}
                >
                  {selectingAll ? t('loading') : t('selectAll')}
                </button>
                <button
                  type="button"
                  className="btn-ghost flex-1 justify-center text-xs"
                  disabled={selectingAll || value.length === 0}
                  onClick={() => onChange([])}
                >
                  {t('deselectAll')}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
