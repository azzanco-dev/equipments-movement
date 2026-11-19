import { translations, type TranslationKey } from '@/i18n/translations'

/**
 * The company's own official data, printed in the header of the quotation
 * PDF (owner 2026-11-17, «نبغى نضيف موثوقية اكثر لمستند الـ PDF»; in the
 * header since the sheet approved on 2026-11-19). ONE place to fill: no
 * table and no settings page. A field left empty is simply not printed, so
 * the sheet is correct before and after the owner gives the values.
 */
export interface CompanyProfile {
  nameAr: string
  nameEn: string
  /** «الرقم الوطني الموحد» (digits). */
  unifiedNumber: string
  /** «الرقم الضريبي» (the 15-digit VAT number). */
  vatNumber: string
  /** The address in Arabic: the city, the district and the street only
   *  (owner 2026-11-18, «خذ المدينة والحي والشارع فقط»). */
  address: string
  /** The same address in English, for the English and the mixed sheets. */
  addressEn: string
  phone: string
  email: string
}

export const COMPANY_PROFILE: CompanyProfile = {
  // The one spelling the printed sheets already use.
  nameAr: translations.ar.supplierPoPrintBuyerName,
  nameEn: translations.en.supplierPoPrintBuyerName,
  // Given by the owner on 2026-11-18 (he called the first one «السجل
  // التجاري»; it is the 10-digit unified number, printed under that label).
  unifiedNumber: '7002399579',
  vatNumber: '310524041500003',
  // From the company's national address proof (owner 2026-11-18): the city,
  // the district and the street. The short address, the building number and
  // the postal code are NOT printed, on his word.
  address: 'الرياض، حي الفيصلية، الدائري الشرقي الفرعي',
  addressEn: 'Riyadh, Al Faisaliyah Dist., Eastern Ring Branch',
  // Not given yet: the phone and the email.
  phone: '',
  email: '',
}

export type CompanyProfileFactKey =
  'unifiedNumber' | 'vatNumber' | 'address' | 'phone' | 'email'

export interface CompanyProfileFact {
  key: CompanyProfileFactKey
  /** The label of the sheet (Arabic and English through the translations). */
  label: TranslationKey
  /** The value an Arabic sheet prints. */
  value: string
  /** The value an English sheet prints (the same for numbers). */
  valueEn: string
  /** Numbers, the phone and the email read left to right. */
  dir: 'ltr' | 'auto'
}

const clean = (value: string | null | undefined) => (value ?? '').trim()

/**
 * The facts of the profile that hold a value, in print order: the unified
 * number, the VAT number, the address, the phone and the email. The address
 * has two wordings; a missing one falls back to the other. An empty profile
 * gives an empty list and the sheet prints the company's name alone.
 */
export function companyProfileFacts(
  profile: CompanyProfile = COMPANY_PROFILE,
): CompanyProfileFact[] {
  const same = (
    key: CompanyProfileFactKey,
    label: TranslationKey,
    raw: string,
  ): CompanyProfileFact => {
    const value = clean(raw)
    return { key, label, value, valueEn: value, dir: 'ltr' }
  }
  const address = clean(profile.address)
  const addressEn = clean(profile.addressEn)
  const all: CompanyProfileFact[] = [
    same('unifiedNumber', 'supplierPoPrintCrNumber', profile.unifiedNumber),
    same('vatNumber', 'supplierPoPrintVatNumber', profile.vatNumber),
    {
      key: 'address',
      label: 'quotationPrintAddress',
      value: address || addressEn,
      valueEn: addressEn || address,
      dir: 'auto',
    },
    same('phone', 'quotationPrintPhone', profile.phone),
    same('email', 'quotationPrintEmail', profile.email),
  ]
  return all.filter((fact) => fact.value !== '')
}
