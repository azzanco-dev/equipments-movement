/**
 * The Saudi banks' logos (owner 2026-11-05, «ابغاك تضيف شعارات البنوك، اول
 * سويها في ui-kit»; the files were downloaded with his OK from each bank's
 * own website into `public/banks/`; Banque Saudi Fransi's from bsf.sa and
 * Bank Aljazira's from aljazirabank.com.sa, their current sites). For review on /ui-kit only until he
 * approves: nothing outside the mockup reads this yet.
 *
 * Matched by the bank's name in the banks list (migration 0177), compared
 * without spaces; a bank without a file (any bank added in Settings) shows
 * its initials instead.
 */
export interface BankLogo {
  src: string
  /** A white logo made for a dark background (Alinma, SAIB): shown on a
   *  dark tile. */
  onDark?: boolean
}

export const BANK_LOGOS: Readonly<Record<string, BankLogo>> = {
  'البنك الاهلي السعودي': { src: '/banks/snb.svg' },
  'مصرف الراجحي': { src: '/banks/rajhi.svg' },
  'بنك الرياض': { src: '/banks/riyad.svg' },
  'البنك السعودي الاول': { src: '/banks/sab.svg' },
  'البنك السعودي الفرنسي': { src: '/banks/fransi.svg' },
  'البنك العربي الوطني': { src: '/banks/anb.png' },
  'بنك البلاد': { src: '/banks/bilad.png' },
  'بنك الجزيرة': { src: '/banks/jazira.webp' },
  'مصرف الانماء': { src: '/banks/alinma.svg', onDark: true },
  'البنك السعودي للاستثمار': { src: '/banks/saib.png', onDark: true },
  'بنك الخليج الدولي': { src: '/banks/gib.png' },
  'بنك STC': { src: '/banks/stc.svg' },
  'بنك دال 360': { src: '/banks/d360.png' },
}

const key = (name: string) => name.replace(/\s+/g, '').toLowerCase()
const BY_KEY = new Map(
  Object.entries(BANK_LOGOS).map(([name, logo]) => [key(name), logo]),
)

/** The logo of a bank by its name, or null (then its initials show). */
export function bankLogoOf(name: string | null | undefined): BankLogo | null {
  return name ? (BY_KEY.get(key(name)) ?? null) : null
}

/** The fallback: the first letters of the bank's two main words, skipping
 *  «البنك» / «بنك» / «مصرف» («مصرف الراجحي» → «ر», «البنك العربي الوطني»
 *  → «عو»). */
export function bankInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => !/^(ال)?(بنك|مصرف)$/.test(word))
  const letter = (word: string) => word.replace(/^ال/, '').charAt(0)
  return words.slice(0, 2).map(letter).join('')
}
