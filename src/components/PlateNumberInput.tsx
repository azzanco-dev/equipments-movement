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
  F: 'ف',
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

function arabicLetters(value: string): string {
  return value
    .split('')
    .map((letter) => ENGLISH_TO_ARABIC_LETTER[letter] ?? '')
    .reverse()
    .join(' ')
}

function arabicNumbers(value: string): string {
  return value.replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)])
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

  return (
    <div className="space-y-2">
      <div
        className="overflow-hidden rounded-xl border-2"
        style={{
          borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
          background: 'var(--bg)',
        }}
      >
        <div className="flex min-h-16">
          <div
            className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-e-2 bg-white px-1.5 text-center text-black"
            style={{
              borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
            }}
          >
            <div className="text-xl leading-none">♛</div>
            <div className="text-[10px] font-bold">السعودية</div>
            <div className="text-[10px] font-semibold leading-none tracking-wide">
              KSA
            </div>
            <div className="h-2 w-2 rounded-full bg-black" />
          </div>

          <div className="grid flex-1 grid-cols-2">
            <div
              className="flex items-center justify-center border-e-2 p-2"
              style={{
                borderColor: 'color-mix(in srgb, var(--fg) 68%, transparent)',
              }}
            >
              <div className="w-full space-y-1 text-center">
                <div className="min-h-5 text-lg" dir="rtl">
                  {arabicLetters(parts.englishLetters) || 'ا س ف'}
                </div>
                <input
                  aria-label="English plate letters"
                  dir="ltr"
                  value={parts.englishLetters}
                  onChange={(e) =>
                    updatePart('englishLetters', cleanLetters(e.target.value))
                  }
                  placeholder="F S A"
                  className={cellClass}
                  inputMode="text"
                />
              </div>
            </div>
            <div className="flex items-center justify-center p-2">
              <div className="w-full space-y-1 text-center">
                <div className="min-h-5 text-lg" dir="ltr">
                  {arabicNumbers(parts.englishNumbers) || '٨٨٨٨'}
                </div>
                <input
                  aria-label="English plate numbers"
                  dir="ltr"
                  value={parts.englishNumbers}
                  onChange={(e) =>
                    updatePart('englishNumbers', cleanNumbers(e.target.value))
                  }
                  placeholder="8888"
                  className={cellClass}
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted">الصيغة المعتمدة: 8888-FSA</p>
    </div>
  )
}
