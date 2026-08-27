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

export function normalizePlateNumber(value: string): string {
  const converted = convertArabicPlateText(value).toUpperCase()
  const letters = converted.match(/[A-Z]/g)?.join('') ?? ''
  const numbers = converted.match(/[0-9]/g)?.join('') ?? ''
  return [letters, numbers].filter(Boolean).join(' ')
}
