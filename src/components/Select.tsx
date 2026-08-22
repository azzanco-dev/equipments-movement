import { useState, useRef, useEffect } from 'react';
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

export function Select({ value, onChange, options, placeholder, className = '', compact = false, searchable = false }: SelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border bg-transparent outline-none transition-colors focus:border-black dark:focus:border-white ${
          compact ? 'h-[34px] px-3 py-0 text-sm' : 'px-3.5 py-2.5 text-sm'
        }`}
        style={{ borderColor: 'var(--border)' }}
      >
        <span className={selected ? '' : 'text-gray-400'}>{displayLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border shadow-lg animate-fade-in"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
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
          <div className="max-h-60 overflow-auto">
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
        </div>
      )}
    </div>
  );
}
