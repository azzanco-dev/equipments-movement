import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';
import type { SelectOption } from '@/components/Select';

interface AsyncSearchSelectProps {
  value: string;
  selectedOption?: SelectOption | null;
  onChange: (value: string, option: SelectOption | null) => void;
  loadOptions: (query: string) => Promise<SelectOption[]>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  createLabel?: string;
  onCreate?: (query: string) => void;
}

export function AsyncSearchSelect({
  value,
  selectedOption,
  onChange,
  loadOptions,
  placeholder = '—',
  className = '',
  disabled = false,
  createLabel,
  onCreate,
}: AsyncSearchSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 260, maxHeight: 240, openAbove: false });

  const updateMenuPosition = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 4;
    const viewportPadding = 8;
    const availableBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const availableAbove = rect.top - gap - viewportPadding;
    const openAbove = availableBelow < 220 && availableAbove > availableBelow;
    const availableHeight = openAbove ? availableAbove : availableBelow;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - viewportPadding * 2);
    const isRtl = (document.documentElement.dir || 'rtl') === 'rtl';
    const preferredLeft = isRtl ? rect.right - width : rect.left;
    const left = Math.min(Math.max(viewportPadding, preferredLeft), window.innerWidth - width - viewportPadding);
    setMenuPosition({
      top: openAbove ? rect.top - gap : rect.bottom + gap,
      left,
      width,
      maxHeight: Math.max(120, Math.min(300, availableHeight)),
      openAbove,
    });
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const next = await loadOptions(query.trim());
        if (requestId === requestRef.current) setOptions(next.slice(0, 20));
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [open, query, loadOptions]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!open) updateMenuPosition(); setOpen((current) => !current); }}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-3 py-0 text-sm outline-none transition-colors focus:border-black disabled:cursor-not-allowed disabled:opacity-60 dark:focus:border-white"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className={selectedOption ? '' : 'text-gray-400'}>{selectedOption?.label ?? placeholder}</span>
        <span className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('clear')}
              onClick={(event) => { event.stopPropagation(); onChange('', null); }}
              onKeyDown={(event) => { if (event.key === 'Enter') onChange('', null); }}
              className="rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={16} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[100] overflow-hidden rounded-lg border shadow-lg"
          dir={document.documentElement.dir || 'rtl'}
          style={{
            background: 'var(--bg)',
            borderColor: 'var(--border)',
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
            ...(menuPosition.openAbove
              ? { bottom: window.innerHeight - menuPosition.top }
              : { top: menuPosition.top }),
          }}
        >
          <div className="relative border-b" style={{ borderColor: 'var(--border)' }}>
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchInList')}
              className="w-full bg-transparent py-2 ps-9 pe-3 text-sm outline-none"
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: Math.max(72, menuPosition.maxHeight - 82) }}>
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-5 text-sm text-muted"><Loader2 size={16} className="animate-spin" />{t('loading')}</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-5 text-center text-sm text-muted">{t('noResults')}</div>
            ) : options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value, option); setOpen(false); setQuery(''); }}
                className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-start text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${option.value === value ? 'font-semibold' : ''}`}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={14} />}
              </button>
            ))}
          </div>
          {onCreate && query.trim() && <button type="button" className="w-full border-t px-3.5 py-2 text-start text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800" style={{ borderColor: 'var(--border)' }} onClick={() => { onCreate(query.trim()); setOpen(false); }}>{createLabel ?? `+ ${query.trim()}`}</button>}
        </div>,
        document.body,
      )}
    </div>
  );
}
