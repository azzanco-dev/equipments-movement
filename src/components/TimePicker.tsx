import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  max?: string;
}

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

function to24Hour(hour: string, period: 'AM' | 'PM'): string {
  const numericHour = Number(hour) % 12 + (period === 'PM' ? 12 : 0);
  return String(numericHour).padStart(2, '0');
}

function formatTime(value: string, includeArabicPeriod: boolean): string {
  if (!value) return '';
  const [hours, minutes] = value.split(':');
  const numericHour = Number(hours);
  const period = numericHour >= 12 ? 'PM' : 'AM';
  const displayHour = String(numericHour % 12 || 12).padStart(2, '0');
  const arabicPeriod = period === 'AM' ? 'صباحًا' : 'مساءً';
  return `${displayHour}:${minutes} ${period}${includeArabicPeriod ? ` — ${arabicPeriod}` : ''}`;
}

export function TimePicker({ value, onChange, className = '', placeholder = '—', max }: TimePickerProps) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [selected24Hour = '00', selectedMinute = '00'] = value.split(':');
  const selectedPeriod: 'AM' | 'PM' = Number(selected24Hour) >= 12 ? 'PM' : 'AM';
  const selectedHour = String(Number(selected24Hour) % 12 || 12).padStart(2, '0');

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const isAfterMax = (hour24: string, minute: string) => Boolean(max && `${hour24}:${minute}` > max);

  const selectHour = (hour: string) => {
    const hour24 = to24Hour(hour, selectedPeriod);
    if (!isAfterMax(hour24, selectedMinute)) onChange(`${hour24}:${selectedMinute}`);
  };

  const selectMinute = (minute: string) => {
    if (isAfterMax(selected24Hour, minute)) return;
    onChange(`${selected24Hour}:${minute}`);
    setOpen(false);
  };

  const selectPeriod = (period: 'AM' | 'PM') => {
    const hour24 = to24Hour(selectedHour, period);
    if (!isAfterMax(hour24, selectedMinute)) onChange(`${hour24}:${selectedMinute}`);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-colors hover:bg-gray-100 focus:ring-2 focus:ring-gray-200 dark:hover:bg-gray-800 dark:focus:ring-gray-700"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="flex items-center gap-2">
          <Clock size={15} className="shrink-0 text-muted" />
          <span className={value ? '' : 'text-gray-400'} dir="ltr">
            {value ? formatTime(value, lang === 'ar') : placeholder}
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute end-0 z-50 mt-2 w-full min-w-[280px] overflow-hidden rounded-lg border shadow-md animate-fade-in"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        >
          <div className="grid grid-cols-3 border-b px-3 py-2 text-center text-xs font-medium text-muted" style={{ borderColor: 'var(--border)' }}>
            <span>{lang === 'ar' ? 'الساعة' : 'Hour'}</span>
            <span>{lang === 'ar' ? 'الدقيقة' : 'Minute'}</span>
            <span>{lang === 'ar' ? 'الفترة' : 'Period'}</span>
          </div>
          <div className="grid grid-cols-3" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <div className="max-h-52 overflow-y-auto p-1">
              {HOURS.map((hour) => {
                const disabled = isAfterMax(to24Hour(hour, selectedPeriod), selectedMinute);
                return (
                  <button
                    key={hour}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectHour(hour)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
                      disabled
                        ? 'cursor-not-allowed text-gray-300 dark:text-gray-700'
                        : hour === selectedHour
                          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span>{hour}</span>
                    {hour === selectedHour && <Check size={13} />}
                  </button>
                );
              })}
            </div>
            <div className="max-h-52 overflow-y-auto border-s p-1" style={{ borderColor: 'var(--border)' }}>
              {MINUTES.map((minute) => {
                const disabled = isAfterMax(selected24Hour, minute);
                return (
                  <button
                    key={minute}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectMinute(minute)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
                      disabled
                        ? 'cursor-not-allowed text-gray-300 dark:text-gray-700'
                        : minute === selectedMinute
                          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span>{minute}</span>
                    {minute === selectedMinute && <Check size={13} />}
                  </button>
                );
              })}
            </div>
            <div className="border-s p-1" style={{ borderColor: 'var(--border)' }}>
              {(['AM', 'PM'] as const).map((period) => {
                const disabled = isAfterMax(to24Hour(selectedHour, period), selectedMinute);
                const label = period === 'AM' ? 'AM صباحًا' : 'PM مساءً';
                return (
                  <button
                    key={period}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectPeriod(period)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-xs ${
                      disabled
                        ? 'cursor-not-allowed text-gray-300 dark:text-gray-700'
                        : period === selectedPeriod
                          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span>{label}</span>
                    {period === selectedPeriod && <Check size={13} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
