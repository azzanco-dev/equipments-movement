// Normalises a stored mobile number to the international form the WhatsApp
// gateway needs (`+<country code><number>`, 8 to 15 digits). Pure: no I/O.
//
// Users are entered with Saudi local numbers most of the time, so the local
// forms are mapped to +966. Anything else must already carry its country code.

const ARABIC_INDIC_ZERO = 0x0660
const EASTERN_ARABIC_ZERO = 0x06f0

function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0)
    const zero =
      code >= EASTERN_ARABIC_ZERO ? EASTERN_ARABIC_ZERO : ARABIC_INDIC_ZERO
    return String(code - zero)
  })
}

/**
 * Returns `+<digits>` or `null` when the input cannot be a valid number.
 *
 *   05XXXXXXXX      -> +9665XXXXXXXX   (Saudi local)
 *   5XXXXXXXX       -> +9665XXXXXXXX   (Saudi local without the leading zero)
 *   9665XXXXXXXX    -> +9665XXXXXXXX
 *   96605XXXXXXXX   -> +9665XXXXXXXX   (country code typed before the local form)
 *   +…              -> kept
 *   00…             -> +…
 */
export function normalizeWhatsAppNumber(
  input: string | null | undefined,
): string | null {
  if (typeof input !== 'string') return null
  const compact = asciiDigits(input).replace(/[\s\-().]/g, '')
  if (!compact) return null

  let digits: string
  if (compact.startsWith('+')) digits = compact.slice(1)
  else if (compact.startsWith('00')) digits = compact.slice(2)
  else if (/^05\d{8}$/.test(compact)) digits = `966${compact.slice(1)}`
  else if (/^5\d{8}$/.test(compact)) digits = `966${compact}`
  else digits = compact

  // The country code typed in front of the local form: 966 05XXXXXXXX.
  if (/^96605\d{8}$/.test(digits)) digits = `966${digits.slice(4)}`

  // An international number never starts with 0, and is 8 to 15 digits.
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null
  return `+${digits}`
}

/**
 * A `wa.me` link that opens a chat with the number and the text pre-filled.
 * Used as the manual fallback when the gateway could not send. Returns `null`
 * when the number cannot be normalised.
 */
export function waMeUrl(
  number: string | null | undefined,
  text: string,
): string | null {
  const normalized = normalizeWhatsAppNumber(number)
  if (!normalized) return null
  return `https://wa.me/${normalized.slice(1)}?text=${encodeURIComponent(text)}`
}
