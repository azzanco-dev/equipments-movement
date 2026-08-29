import { useEffect, useState } from 'react'
import { normalizePlateNumber } from '@/lib/plate'

interface PlateNumberInputProps {
  value: string
  onChange: (value: string) => void
}

interface PlateParts {
  englishLetters: string
  englishNumbers: string
}

const ENGLISH_TO_ARABIC_LETTER: Record<string, string> = {
  A: 'ا',
  B: 'ب',
  J: 'ح',
  D: 'د',
  R: 'ر',
  S: 'س',
  X: 'ص',
  T: 'ط',
  E: 'ع',
  G: 'ق',
  K: 'ك',
  L: 'ل',
  Z: 'م',
  N: 'ن',
  H: 'هـ',
  U: 'و',
  V: 'ى',
}

function parsePlate(value: string): PlateParts {
  const normalized = normalizePlateNumber(value)
  const letters = normalized.match(/[A-Z]+/)?.[0] ?? ''
  const numbers = normalized.match(/[0-9]+/)?.[0] ?? ''

  return {
    englishLetters: letters,
    englishNumbers: numbers,
  }
}

function getNormalizedValue(parts: PlateParts): string {
  return normalizePlateNumber(`${parts.englishLetters} ${parts.englishNumbers}`)
}

function cleanLetters(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .filter((letter) => letter in ENGLISH_TO_ARABIC_LETTER)
    .join('')
    .slice(0, 3)
}

function cleanNumbers(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 4)
}

function toArabicLetters(value: string): string {
  return value
    .split('')
    .reverse()
    .map((letter) => ENGLISH_TO_ARABIC_LETTER[letter])
    .join(' ')
}

export function PlateNumberInput({ value, onChange }: PlateNumberInputProps) {
  const [parts, setParts] = useState<PlateParts>(() => parsePlate(value))

  useEffect(() => {
    if (normalizePlateNumber(value) !== getNormalizedValue(parts)) {
      setParts(parsePlate(value))
    }
  }, [value, parts])

  function updatePart(key: keyof PlateParts, nextValue: string) {
    const nextParts = { ...parts, [key]: nextValue }
    setParts(nextParts)
    onChange(getNormalizedValue(nextParts))
  }

  const cellClass =
    'w-full bg-transparent text-center !text-xl font-medium leading-none outline-none placeholder:text-gray-300 dark:placeholder:text-gray-600'
  const derivedCellClass = 'w-full text-center text-xl font-medium leading-none'
  const arabicLetters = toArabicLetters(parts.englishLetters)
  const arabicNumbers = parts.englishNumbers

  return (
    <div className="space-y-2">
      <div
        className="overflow-hidden rounded-xl border-2"
        style={{
          borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
          background: 'var(--bg)',
        }}
      >
        <div className="flex min-h-[96px]">
          <div
            className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-e-2 bg-white px-1.5 text-center text-black"
            style={{
              borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
            }}
          >
            <div className="text-2xl leading-none">♛</div>
            <div className="text-[10px] font-bold">السعودية</div>
            <div className="text-[10px] leading-3 tracking-[0.25em]">
              K<br />S<br />A
            </div>
            <div className="h-2.5 w-2.5 rounded-full bg-black" />
          </div>

          <div className="grid flex-1 grid-cols-2 grid-rows-2">
            <div
              className="flex items-center justify-center border-b-2 border-e-2 p-2"
              style={{
                borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
              }}
            >
              <div
                aria-label="Arabic plate letters"
                dir="rtl"
                className={`${derivedCellClass} ${arabicLetters ? '' : 'text-gray-300 dark:text-gray-600'}`}
              >
                {arabicLetters || 'ا ب ح'}
              </div>
            </div>
            <div
              className="flex items-center justify-center border-b-2 p-2"
              style={{
                borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
              }}
            >
              <div
                aria-label="Arabic plate numbers"
                dir="ltr"
                className={`${derivedCellClass} ${arabicNumbers ? '' : 'text-gray-300 dark:text-gray-600'}`}
              >
                {arabicNumbers || '0 0 0 0'}
              </div>
            </div>
            <div
              className="flex items-center justify-center border-e-2 p-2"
              style={{
                borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
              }}
            >
              <input
                aria-label="English plate letters"
                dir="ltr"
                value={parts.englishLetters}
                onChange={(e) =>
                  updatePart('englishLetters', cleanLetters(e.target.value))
                }
                placeholder="A B J"
                className={cellClass}
                inputMode="text"
              />
            </div>
            <div className="flex items-center justify-center p-2">
              <input
                aria-label="English plate numbers"
                dir="ltr"
                value={parts.englishNumbers}
                onChange={(e) =>
                  updatePart('englishNumbers', cleanNumbers(e.target.value))
                }
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
  )
}
