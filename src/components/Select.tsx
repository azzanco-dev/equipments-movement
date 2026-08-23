import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  compact?: boolean;
  searchable?: boolean;
}

export function Select({ value, onChange, options, placeholder, className = '', searchable = false }: SelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 });

  const updateMenuPosition = useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 4;
    const availableBelow = window.innerHeight - rect.bottom - gap;
    const availableAbove = rect.top - gap;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    const maxHeight = Math.max(100, Math.min(240, openAbove ? availableAbove : availableBelow));
    setMenuPosition({
      top: openAbove ? rect.top - gap : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
    if (open && searchable && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open, searchable]);

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected ? selected.label : (placeholder ?? '—');

  const filtered = searchable && query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { if (!open) updateMenuPosition(); setOpen(!open); }}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border bg-transparent outline-none transition-colors focus:border-black dark:focus:border-white ${
          'h-8 px-3 py-0 text-sm'
        }`}
        style={{ borderColor: 'var(--border)' }}
      >
        <span className={selected ? '' : 'text-gray-400'}>{displayLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[100] rounded-lg border shadow-lg animate-fade-in"
          dir={document.documentElement.dir || 'rtl'}
          style={{
            background: 'var(--bg)',
            borderColor: 'var(--border)',
            left: menuPosition.left,
            width: menuPosition.width,
            ...(menuPosition.top < (ref.current?.getBoundingClientRect().top ?? 0)
              ? { bottom: window.innerHeight - menuPosition.top }
              : { top: menuPosition.top }),
          }}
        >
          {searchable && (
            <div className="relative border-b" style={{ borderColor: 'var(--border)' }}>
              <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchInList')}
                className="w-full bg-transparent py-2 ps-9 pe-3 text-sm outline-none"
              />
            </div>
          )}
          <div className="overflow-auto" style={{ maxHeight: menuPosition.maxHeight }}>
            {filtered.length === 0 ? (
              <div className="px-3.5 py-2 text-sm text-muted">—</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 py-2 text-sm text-start transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    opt.value === value ? 'font-semibold' : ''
                  }`}
                >
                  <span className={opt.value === '' && !opt.label ? 'text-gray-400' : ''}>
                    {opt.label || '—'}
                  </span>
                  {opt.value === value && <Check size={14} className="shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
