import { translations, type TranslationKey } from '@/i18n/translations'
import { formatShortAddress } from '@/lib/partyFields'

/**
 * The company's own official data, printed in the footer of the quotation
 * PDF (owner 2026-11-17, «نبغى نضيف موثوقية اكثر لمستند الـ PDF»). ONE
 * place to fill: no table and no settings page. A field left empty is simply
 * not printed, so the sheet is correct before and after the owner gives the
 * values.
 */
export interface CompanyProfile {
  nameAr: string
  nameEn: string
  /** «الرقم الوطني الموحد» (digits). */
  unifiedNumber: string
  /** «الرقم الضريبي» (the 15-digit VAT number). */
  vatNumber: string
  /** The full national address (district, street, building, city, postal code). */
  address: string
  /** The short national address: four letters and four digits («RRRD2929»). */
  shortAddress: string
  phone: string
  email: string
}

export const COMPANY_PROFILE: CompanyProfile = {
  // The one spelling the printed sheets already use.
  nameAr: translations.ar.supplierPoPrintBuyerName,
  nameEn: translations.en.supplierPoPrintBuyerName,
  // Not given yet (asked from the owner on 2026-11-17): fill these in.
  unifiedNumber: '',
  vatNumber: '',
  address: '',
  shortAddress: '',
  phone: '',
  email: '',
}

export type CompanyProfileFactKey =
  'unifiedNumber' | 'vatNumber' | 'nationalAddress' | 'phone' | 'email'

export interface CompanyProfileFact {
  key: CompanyProfileFactKey
  /** The bilingual label of the sheet. */
  label: TranslationKey
  value: string
  /** Numbers, the phone and the email read left to right. */
  dir: 'ltr' | 'auto'
}

const clean = (value: string | null | undefined) => (value ?? '').trim()

/**
 * The facts of the profile that hold a value, in print order: the unified
 * number, the VAT number, the national address (the full address and the
 * short one, whichever is set), the phone and the email. An empty profile
 * gives an empty list and the sheet prints no company data block.
 */
export function companyProfileFacts(
  profile: CompanyProfile = COMPANY_PROFILE,
): CompanyProfileFact[] {
  const short = clean(profile.shortAddress)
  const nationalAddress = [
    clean(profile.address),
    short ? formatShortAddress(short) : '',
  ]
    .filter(Boolean)
    .join(' — ')
  const all: CompanyProfileFact[] = [
    {
      key: 'unifiedNumber',
      label: 'supplierPoPrintCrNumber',
      value: clean(profile.unifiedNumber),
      dir: 'ltr',
    },
    {
      key: 'vatNumber',
      label: 'supplierPoPrintVatNumber',
      value: clean(profile.vatNumber),
      dir: 'ltr',
    },
    {
      key: 'nationalAddress',
      label: 'quotationPrintNationalAddress',
      value: nationalAddress,
      dir: 'auto',
    },
    {
      key: 'phone',
      label: 'quotationPrintPhone',
      value: clean(profile.phone),
      dir: 'ltr',
    },
    {
      key: 'email',
      label: 'quotationPrintEmail',
      value: clean(profile.email),
      dir: 'ltr',
    },
  ]
  return all.filter((fact) => fact.value !== '')
}
