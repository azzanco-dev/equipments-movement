const ARABIC_LETTER_MAP: Record<string, string> = {
  ا: 'A',
  أ: 'A',
  إ: 'A',
  آ: 'A',
  ب: 'B',
  ح: 'J',
  د: 'D',
  ر: 'R',
  س: 'S',
  ص: 'X',
  ف: 'F',
  ط: 'T',
  ع: 'E',
  ق: 'G',
  ك: 'K',
  ل: 'L',
  م: 'Z',
  ن: 'N',
  ه: 'H',
  ة: 'H',
  و: 'U',
  ي: 'V',
  ى: 'V',
}

const ARABIC_NUMBER_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
}

export function convertArabicPlateText(value: string): string {
  return Array.from(value)
    .map((character) => {
      if (ARABIC_LETTER_MAP[character]) return ARABIC_LETTER_MAP[character]
      if (ARABIC_NUMBER_MAP[character]) return ARABIC_NUMBER_MAP[character]
      return character
    })
    .join('')
}

export interface PlateSearchParts {
  digits: string
  letters: string
}

// Extracts the digit and Latin-letter parts a plate search term resolves to,
// in the same canonical order stored in `plate_digits` / `plate_letters_en`.
// Handles Arabic letters/digits, Latin letters/digits, with or without
// separators, and the visual right-to-left order of Arabic plate letters.
export function extractPlateSearchParts(value: string): PlateSearchParts {
  const converted = convertArabicPlateText(value).toUpperCase()
  const hasArabicLetters = /[ء-ي]/.test(value)
  const hasEnglishLetters = /[A-Za-z]/.test(value)
  const letterParts = converted.match(/[A-Z]/g) ?? []
  const letters = (
    hasArabicLetters && !hasEnglishLetters ? letterParts.reverse() : letterParts
  ).join('')
  const digits = converted.match(/[0-9]/g)?.join('') ?? ''
  return { digits, letters }
}

export function normalizePlateNumber(value: string): string {
  const { digits, letters } = extractPlateSearchParts(value)
  if (letters && digits) return `${digits}-${letters}`
  return digits || letters
}
