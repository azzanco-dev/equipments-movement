import { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatDate } from '@/lib/dateFormat';

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  max?: string;
}

const MONTH_NAMES_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isRTL(): boolean {
  return document.documentElement.dir === 'rtl';
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISODate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function formatDateDisplay(s: string): string {
  const d = parseISODate(s);
  if (!d) return '';
  return formatDate(s);
}

export function DatePicker({ value, onChange, className = '', placeholder = '—', max }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseISODate(value) ?? new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const d = parseISODate(value);
      setViewDate(d ?? new Date());
    }
  }, [open, value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const rtl = isRTL();
  const monthNames = rtl ? MONTH_NAMES_AR : MONTH_NAMES_EN;
  const dayNames = rtl ? DAY_NAMES_AR : DAY_NAMES_EN;

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const daysInMonth = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(new Date(year, month, d));
    return cells;
  }, [year, month]);

  const selectedDate = parseISODate(value);
  const maxDate = max ? parseISODate(max) : null;

  function prevMonth() {
    setViewDate(new Date(year, month - 1, 1));
  }
  function nextMonth() {
    setViewDate(new Date(year, month + 1, 1));
  }
  function selectDay(d: Date) {
    if (maxDate && d > maxDate) return;
    onChange(toISODate(d));
    setOpen(false);
  }
  function clearDate() {
    onChange('');
    setOpen(false);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-0 text-sm outline-none transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="flex items-center gap-2">
          <Calendar size={15} className="shrink-0 text-muted" />
          <span className={value ? '' : 'text-gray-400'}>{value ? formatDateDisplay(value) : placeholder}</span>
        </span>
        {value && (
          <X
            size={14}
            className="shrink-0 text-muted hover:text-fg"
            onClick={(e) => { e.stopPropagation(); clearDate(); }}
          />
        )}
      </button>

      {open && (
        <div
          className="absolute z-50 mt-2 w-[280px] rounded-lg border shadow-md animate-fade-in"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <button type="button" onClick={rtl ? nextMonth : prevMonth} className="inline-flex items-center justify-center rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium">{monthNames[month]} {year}</span>
            <button type="button" onClick={rtl ? prevMonth : nextMonth} className="inline-flex items-center justify-center rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 gap-0 px-3 pt-3">
            {dayNames.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium text-muted py-1">{d}</div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-0 p-3 pt-1">
            {daysInMonth.map((d, i) => {
              if (!d) return <div key={i} className="h-9" />;
              const isSelected = selectedDate && toISODate(d) === toISODate(selectedDate);
              const isToday = toISODate(d) === toISODate(today);
              const isDisabled = Boolean(maxDate && d > maxDate);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(d)}
                  disabled={isDisabled}
                  className={`h-9 w-9 mx-auto rounded-md text-sm transition-colors flex items-center justify-center ${
                    isDisabled
                      ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
                      : isSelected
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 font-medium'
                      : isToday
                        ? 'bg-gray-100 dark:bg-gray-800 font-medium'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-3 pt-0 border-t" style={{ borderColor: 'var(--border)' }}>
            <button type="button" onClick={clearDate} className="text-xs text-muted hover:text-fg transition-colors">
              {rtl ? 'مسح' : 'Clear'}
            </button>
            <button
              type="button"
              onClick={() => selectDay(today)}
              className="text-xs font-medium px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {rtl ? 'اليوم' : 'Today'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
