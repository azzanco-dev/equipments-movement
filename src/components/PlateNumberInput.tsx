import { useEffect, useState } from 'react';
import { normalizePlateNumber } from '@/lib/plate';

interface PlateNumberInputProps {
  value: string;
  onChange: (value: string) => void;
}

interface PlateParts {
  arabicLetters: string;
  arabicNumbers: string;
  englishLetters: string;
  englishNumbers: string;
}

function parsePlate(value: string): PlateParts {
  const normalized = normalizePlateNumber(value);
  const letters = normalized.match(/[A-Z]+/)?.[0] ?? '';
  const numbers = normalized.match(/[0-9]+/)?.[0] ?? '';

  return {
    arabicLetters: '',
    arabicNumbers: '',
    englishLetters: letters,
    englishNumbers: numbers,
  };
}

function getNormalizedValue(parts: PlateParts): string {
  const letters = parts.englishLetters || parts.arabicLetters;
  const numbers = parts.englishNumbers || parts.arabicNumbers;
  return normalizePlateNumber(`${letters} ${numbers}`);
}

function cleanLetters(value: string): string {
  return value.replace(/[^ء-يA-Za-z]/g, '').slice(0, 3);
}

function cleanNumbers(value: string): string {
  return value.replace(/[^0-9٠-٩]/g, '').slice(0, 4);
}

export function PlateNumberInput({ value, onChange }: PlateNumberInputProps) {
  const [parts, setParts] = useState<PlateParts>(() => parsePlate(value));

  useEffect(() => {
    if (normalizePlateNumber(value) !== getNormalizedValue(parts)) {
      setParts(parsePlate(value));
    }
  }, [value, parts]);

  function updatePart(key: keyof PlateParts, nextValue: string) {
    const nextParts = { ...parts, [key]: nextValue };
    setParts(nextParts);
    onChange(getNormalizedValue(nextParts));
  }

  const cellClass = 'w-full bg-transparent text-center text-2xl font-medium outline-none placeholder:text-gray-300 dark:placeholder:text-gray-600';

  return (
    <div className="space-y-2">
      <div
        className="overflow-hidden rounded-2xl border-[3px]"
        style={{ borderColor: 'var(--fg)', background: 'var(--bg)' }}
      >
        <div className="flex min-h-[150px]">
          <div
            className="flex w-[68px] shrink-0 flex-col items-center justify-center gap-1 border-e-[3px] bg-white px-2 text-center text-black"
            style={{ borderColor: 'var(--fg)' }}
          >
            <div className="text-[30px] leading-none">♛</div>
            <div className="text-[11px] font-bold">السعودية</div>
            <div className="text-xs leading-4 tracking-[0.3em]">K<br />S<br />A</div>
            <div className="h-3 w-3 rounded-full bg-black" />
          </div>

          <div className="grid flex-1 grid-cols-2 grid-rows-2">
            <div className="flex items-center justify-center border-b-[3px] border-e-[3px] p-3" style={{ borderColor: 'var(--fg)' }}>
              <input
                aria-label="Arabic plate letters"
                dir="rtl"
                value={parts.arabicLetters}
                onChange={(e) => updatePart('arabicLetters', cleanLetters(e.target.value))}
                placeholder="أ ب ج"
                className={cellClass}
                inputMode="text"
              />
            </div>
            <div className="flex items-center justify-center border-b-[3px] p-3" style={{ borderColor: 'var(--fg)' }}>
              <input
                aria-label="Arabic plate numbers"
                dir="ltr"
                value={parts.arabicNumbers}
                onChange={(e) => updatePart('arabicNumbers', cleanNumbers(e.target.value))}
                placeholder="٠ ٠ ٠ ٠"
                className={cellClass}
                inputMode="numeric"
              />
            </div>
            <div className="flex items-center justify-center border-e-[3px] p-3" style={{ borderColor: 'var(--fg)' }}>
              <input
                aria-label="English plate letters"
                dir="ltr"
                value={parts.englishLetters}
                onChange={(e) => updatePart('englishLetters', cleanLetters(e.target.value).toUpperCase())}
                placeholder="A B C"
                className={cellClass}
                inputMode="text"
              />
            </div>
            <div className="flex items-center justify-center p-3">
              <input
                aria-label="English plate numbers"
                dir="ltr"
                value={parts.englishNumbers}
                onChange={(e) => updatePart('englishNumbers', cleanNumbers(e.target.value))}
                placeholder="0 0 0 0"
                className={cellClass}
                inputMode="numeric"
              />
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted">أدخل رقم اللوحة بنفس ترتيب لوحتك</p>
    </div>
  );
}
