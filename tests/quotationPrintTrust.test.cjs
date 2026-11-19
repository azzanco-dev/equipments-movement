const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// The quotation PDF (`QuotationPrintSheet` only; the supplier PO sheet is
// untouched).
//
// Owner 2026-11-17, «برضه نبغى نضيف موثوقية اكثر لمستند الـ PDF», «بدون
// توقيع وختم», no QR:
//   1. the company's official data, only the fields that hold a value
//      (`src/lib/companyProfile.ts`);
//   2. the closing line «هذا المستند صادر الكترونيا … ولا يحتاج توقيع او ختم»;
//   3. on every printed page the page number and the time the file was
//      issued, through CSS page-margin boxes (`src/lib/quotationPrint.ts`).
//
// Owner 2026-11-19, «تمام اعتمد الان» (the sheet drawn in Figma): three
// versions — Arabic, English, both —, the company's brand colours, the
// company data in the header opposite the logo, the quotation's facts on one
// line above the client's box, «تكاليف اضافية» beside «ساعات العمل».

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const HAMZA_ALIF = /[أإآ]/

/** Loads a TypeScript module of `src` with its `@/…` imports. */
const cache = new Map()
function load(request) {
  const file = path.join(ROOT, 'src', ...request.split('/')) + '.ts'
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const localRequire = (name) =>
    name.startsWith('@/') ? load(name.slice(2)) : require(name)
  new Function('module', 'exports', 'require', code)(
    mod,
    mod.exports,
    localRequire,
  )
  return mod.exports
}

const { translations } = load('i18n/translations')
const profileLib = load('lib/companyProfile')
const printLib = load('lib/quotationPrint')
const SHEET = read('src', 'components', 'sales', 'QuotationPrintSheet.tsx')
const PAGE = read('src', 'screens', 'sales', 'QuotationDetail.tsx')
/** The sheet without its comments. */
const CODE = SHEET.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** A profile with the names only: the base of the rule tests below. */
const emptyProfile = () => ({
  ...profileLib.COMPANY_PROFILE,
  unifiedNumber: '',
  vatNumber: '',
  address: '',
  addressEn: '',
  phone: '',
  email: '',
})

// --- The company's data --------------------------------------------------------

test('the profile: the name and the values the owner gave', () => {
  const profile = profileLib.COMPANY_PROFILE
  assert.equal(profile.nameAr, 'شركة عبدالله احمد العزاني للمقاولات')
  assert.equal(profile.nameAr, translations.ar.supplierPoPrintBuyerName)
  assert.equal(profile.nameEn, translations.en.supplierPoPrintBuyerName)
  assert.deepEqual(Object.keys(profile).sort(), [
    'address',
    'addressEn',
    'email',
    'nameAr',
    'nameEn',
    'phone',
    'unifiedNumber',
    'vatNumber',
  ])
  // The owner's values of 2026-11-18: the unified number, the VAT number
  // and the address — the city, the district and the street only («خذ
  // المدينة والحي والشارع فقط»), in Arabic and in English. The phone and the
  // email are not given yet, so they are not printed.
  assert.deepEqual(
    profileLib
      .companyProfileFacts()
      .map((fact) => [fact.key, fact.value, fact.valueEn]),
    [
      ['unifiedNumber', '7002399579', '7002399579'],
      ['vatNumber', '310524041500003', '310524041500003'],
      [
        'address',
        'الرياض، حي الفيصلية، الدائري الشرقي الفرعي',
        'Riyadh, Al Faisaliyah Dist., Eastern Ring Branch',
      ],
    ],
  )
  assert.match(profile.unifiedNumber, /^7[0-9]{9}$/)
  assert.match(profile.vatNumber, /^[0-9]{15}$/)
  assert.doesNotMatch(profile.address, HAMZA_ALIF)
  // No short address, building number or postal code, on his word.
  assert.ok(!('shortAddress' in profile))
  assert.doesNotMatch(profile.address + profile.addressEn, /REFA|8064|12894/)
  // With no value at all only the name is printed.
  assert.deepEqual(profileLib.companyProfileFacts(emptyProfile()), [])
})

test('only the fields that hold a value are printed, in order', () => {
  const base = emptyProfile()
  const full = profileLib.companyProfileFacts({
    ...base,
    unifiedNumber: ' 7001234567 ',
    vatNumber: '300012345600003',
    address: 'جدة، حي الصناعية',
    addressEn: 'Jeddah, Industrial Dist.',
    phone: '+966 12 345 6789',
    email: 'info@example.com',
  })
  assert.deepEqual(
    full.map((fact) => [fact.key, fact.value, fact.valueEn, fact.dir]),
    [
      ['unifiedNumber', '7001234567', '7001234567', 'ltr'],
      ['vatNumber', '300012345600003', '300012345600003', 'ltr'],
      ['address', 'جدة، حي الصناعية', 'Jeddah, Industrial Dist.', 'auto'],
      ['phone', '+966 12 345 6789', '+966 12 345 6789', 'ltr'],
      ['email', 'info@example.com', 'info@example.com', 'ltr'],
    ],
  )
  // «العنوان» alone, not «العنوان الوطني» (owner 2026-11-18).
  assert.deepEqual(
    full.map((fact) => fact.label),
    [
      'supplierPoPrintCrNumber',
      'supplierPoPrintVatNumber',
      'quotationPrintAddress',
      'quotationPrintPhone',
      'quotationPrintEmail',
    ],
  )
  assert.equal(translations.ar.quotationPrintAddress, 'العنوان')
  assert.equal(translations.en.quotationPrintAddress, 'Address')
  assert.equal(translations.ar.quotationPrintPhone, 'رقم التواصل')
  // One field alone; blanks and spaces are empty.
  assert.deepEqual(
    profileLib
      .companyProfileFacts({
        ...base,
        vatNumber: '300012345600003',
        phone: '  ',
      })
      .map((fact) => fact.key),
    ['vatNumber'],
  )
  // An address in one language alone serves both sheets.
  const arOnly = profileLib.companyProfileFacts({
    ...base,
    address: ' جدة ',
  })[0]
  assert.deepEqual([arOnly.value, arOnly.valueEn], ['جدة', 'جدة'])
  const enOnly = profileLib.companyProfileFacts({
    ...base,
    addressEn: 'Jeddah',
  })[0]
  assert.deepEqual([enOnly.value, enOnly.valueEn], ['Jeddah', 'Jeddah'])
})

// --- The pure rules of the sheet -----------------------------------------------

test('three versions: Arabic, English, both', () => {
  assert.deepEqual([...printLib.QUOTATION_PRINT_VARIANTS], ['ar', 'en', 'both'])
  assert.deepEqual(printLib.QUOTATION_PRINT_VARIANT_KEYS, {
    ar: 'quotationPdfAr',
    en: 'quotationPdfEn',
    both: 'quotationPdfBoth',
  })
  assert.equal(printLib.quotationPrintDir('ar'), 'rtl')
  assert.equal(printLib.quotationPrintDir('both'), 'rtl')
  assert.equal(printLib.quotationPrintDir('en'), 'ltr')
  assert.equal(translations.ar.quotationPdfAr, 'PDF عربي')
  assert.equal(translations.ar.quotationPdfEn, 'PDF انجليزي')
  assert.equal(translations.ar.quotationPdfBoth, 'PDF عربي وانجليزي')
})

test('«ساعات العمل»: the standard month, three rows', () => {
  assert.deepEqual(printLib.QUOTATION_WORKING_HOURS, {
    dailyHours: 10,
    monthlyDays: 26,
    monthlyHours: 260,
  })
  assert.deepEqual(printLib.quotationHoursRows(), [
    { key: 'quotationPrintDailyHours', value: 10 },
    { key: 'quotationPrintMonthlyDays', value: 26 },
    { key: 'quotationPrintMonthlyHours', value: 260 },
  ])
  assert.deepEqual(
    printLib
      .quotationHoursRows({ dailyHours: 8, monthlyDays: 30, monthlyHours: 240 })
      .map((row) => row.value),
    [8, 30, 240],
  )
  assert.equal(translations.ar.quotationPrintHours, 'ساعات العمل')
  assert.equal(translations.ar.quotationPrintDailyHours, 'عدد الساعات اليومية')
  assert.equal(translations.ar.quotationPrintMonthlyDays, 'عدد الايام الشهرية')
  assert.equal(
    translations.ar.quotationPrintMonthlyHours,
    'عدد الساعات الشهرية',
  )
})

test('the default costs have English names; a typed cost prints as it is', () => {
  const { DEFAULT_QUOTATION_COSTS } = load('lib/quotations')
  // Every default cost of a new quotation is translated.
  for (const cost of DEFAULT_QUOTATION_COSTS)
    assert.equal(typeof printLib.quotationCostNameEn(cost.name), 'string')
  assert.equal(printLib.quotationCostNameEn('الديزل'), 'Diesel')
  assert.equal(printLib.quotationCostNameEn(' المواصلات '), 'Transportation')
  assert.equal(
    printLib.quotationCostNameEn('المعيشة (الاكل والسكن)'),
    'Accommodation (food and housing)',
  )
  assert.equal(printLib.quotationCostNameEn('تامين المعدة'), null)
  // «سمي التكاليف تكاليف اضافية».
  assert.equal(translations.ar.quotationPrintCosts, 'تكاليف اضافية')
  assert.equal(translations.en.quotationPrintCosts, 'Additional Costs')
})

test('the issue time is the Saudi day and 12-hour clock', () => {
  assert.equal(
    printLib.printIssuedAtLabel(new Date('2026-11-17T19:24:00Z')),
    '17/11/2026 10:24 PM',
  )
  // 21:30 UTC is already the next Saudi day.
  assert.equal(
    printLib.printIssuedAtLabel(new Date('2026-11-17T21:30:00Z')),
    '18/11/2026 12:30 AM',
  )
  assert.equal(
    printLib.printIssuedAtLabel(new Date('2026-11-17T05:05:00Z')),
    '17/11/2026 8:05 AM',
  )
})

test('the page rule: a bottom margin with the page number and the time', () => {
  const css = printLib.quotationPageCss('17/11/2026 10:24 PM')
  assert.equal(css, printLib.quotationPageCss('17/11/2026 10:24 PM', 'both'))
  assert.match(css, /^@page \{ size: A4 portrait; margin: 0 0 12mm 0; /)
  assert.equal(printLib.QUOTATION_PAGE_FOOTER_MM, 12)
  // «صفحة 1 من 2 / Page 1 of 2» from the real page counters.
  assert.ok(
    css.includes(
      '@bottom-right { content: "صفحة " counter(page) " من " counter(pages) " / Page " counter(page) " of " counter(pages);',
    ),
  )
  assert.ok(
    css.includes(
      '@bottom-left { content: "اصدار الملف / File issued: 17/11/2026 10:24 PM";',
    ),
  )
  // The app's font and the muted token, no hardcoded colour.
  assert.equal(
    (css.match(/font-family: var\(--font-primary\)/g) || []).length,
    2,
  )
  assert.equal((css.match(/color: var\(--muted\)/g) || []).length, 2)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(css, HAMZA_ALIF)
  // A value can never break out of its CSS string.
  assert.equal(printLib.cssString('a"b\\c\nd'), '"a\\"b\\\\c d"')
  const odd = printLib.quotationPageCss('x"; } body { display: none')
  assert.ok(odd.includes('File issued: x\\"; } body { display: none";'))
})

test('the page rule follows the version: language and side', () => {
  // Arabic: the page number at the right, Arabic words only.
  const ar = printLib.quotationPageCss('17/11/2026 10:24 PM', 'ar')
  assert.ok(
    ar.includes(
      '@bottom-right { content: "صفحة " counter(page) " من " counter(pages); direction: rtl;',
    ),
  )
  assert.ok(
    ar.includes('@bottom-left { content: "اصدار الملف: 17/11/2026 10:24 PM";'),
  )
  assert.doesNotMatch(ar, /Page|File issued/)
  // English: mirrored, the page number at the left.
  const en = printLib.quotationPageCss('17/11/2026 10:24 PM', 'en')
  assert.ok(
    en.includes(
      '@bottom-left { content: "Page " counter(page) " of " counter(pages); direction: ltr;',
    ),
  )
  assert.ok(
    en.includes('@bottom-right { content: "File issued: 17/11/2026 10:24 PM";'),
  )
  assert.doesNotMatch(en, /صفحة|اصدار/)
  for (const css of [ar, en])
    assert.match(css, /^@page \{ size: A4 portrait; margin: 0 0 12mm 0; /)
})

// --- The sheet -----------------------------------------------------------------

test('the sheet: its version, the page rule and the print flow', () => {
  assert.match(
    SHEET,
    /import \{\s+COMPANY_PROFILE,\s+companyProfileFacts,\s+type CompanyProfile,\s+\} from '@\/lib\/companyProfile'/,
  )
  assert.match(SHEET, /variant: QuotationPrintVariant\n/)
  // The issue time is taken once per print and feeds the page rule.
  assert.match(
    SHEET,
    /const \[issuedAt\] = useState\(\(\) => printIssuedAtLabel\(new Date\(\)\)\)/,
  )
  assert.match(
    SHEET,
    /<style>\{quotationPageCss\(issuedAt, variant\)\}<\/style>/,
  )
  assert.doesNotMatch(SHEET, /@page \{ size: A4 portrait; margin: 0; \}/)
  // The sheet's bottom padding gave way to the page's bottom margin.
  assert.match(SHEET, /px-\[10mm\] pb-\[2mm\] pt-\[12mm\]/)
  // The direction and the language follow the version.
  assert.match(SHEET, /const dir = quotationPrintDir\(variant\)/)
  assert.match(SHEET, /dir=\{dir\}\s+lang=\{main\}/)
  assert.match(SHEET, /const main: Lang = variant === 'en' \? 'en' : 'ar'/)
  assert.match(SHEET, /profile = COMPANY_PROFILE,/)
  assert.match(SHEET, /hours = QUOTATION_WORKING_HOURS,/)
  // The page: a menu of the three versions; the version reaches the sheet.
  assert.match(PAGE, /useState<QuotationPrintVariant \| null>\(null\)/)
  const usage = PAGE.slice(PAGE.indexOf('<QuotationPrintSheet'))
  const props = usage.slice(0, usage.indexOf('/>'))
  assert.match(props, /variant=\{printing\}/)
  assert.match(props, /contact=\{company\}/)
  assert.match(props, /onDone=\{\(\) => setPrinting\(null\)\}/)
  assert.doesNotMatch(props, /project=/)
})

test('the header: company data, title, logo; the logo at the end side', () => {
  const header = CODE.slice(CODE.indexOf('<header'), CODE.indexOf('</header>'))
  assert.ok(header.length > 0)
  const companyAt = header.indexOf('companyFacts.map')
  const titleAt = header.indexOf('<h1')
  const logoAt = header.indexOf('<img')
  // In reading order: so the logo is at the left of an Arabic sheet and at
  // the right of the English one («غير مكان اللوقو حسب اللغة»).
  assert.ok(companyAt > 0 && titleAt > companyAt && logoAt > titleAt)
  assert.match(header, /justify-self-start/)
  assert.match(header, /className="h-\[18mm\] w-auto justify-self-end/)
  // The company's name, then the facts that hold a value, one a line.
  assert.match(SHEET, /const companyFacts = companyProfileFacts\(profile\)/)
  assert.match(header, /\{main === 'en' \? profile\.nameEn : profile\.nameAr\}/)
  assert.match(header, /\{companyFacts\.length > 0 && \(/)
  assert.match(header, /<Label v=\{variant\} k=\{fact\.label\} \/>/)
  assert.match(header, /\{main === 'en' \? fact\.valueEn : fact\.value\}/)
  // The title in the brand charcoal over the short amber rule.
  assert.match(header, /text-\[30px\] font-bold leading-\[38px\]/)
  assert.match(header, /h-1 w-14 rounded-sm bg-\[var\(--brand-amber\)\]/)
  // No project and no «مقدم العرض» box anywhere on the sheet.
  assert.doesNotMatch(CODE, /project|quotationPrintFrom/)
  assert.ok(!('quotationPrintFrom' in translations.ar))
})

test('the quotation facts on one line above the client alone in its box', () => {
  const factsAt = CODE.indexOf('{quoteFacts.map')
  const boxAt = CODE.indexOf('k="quotationPrintTo"')
  const pricesAt = CODE.indexOf('quotationPrintDescription')
  assert.ok(factsAt > CODE.indexOf('</header>'))
  assert.ok(boxAt > factsAt && pricesAt > boxAt)
  // A visible border, never a light fill («الرمادي الخفيف مايظهر في
  // الطباعة»).
  assert.match(
    CODE,
    /<section className="mb-\[18px\] break-inside-avoid rounded-md border border-\[color-mix\(in_srgb,var\(--brand-charcoal\)_35%,transparent\)\] p-3">/,
  )
  // «عناية», the mobile and the email of the client's company record, each
  // only when it holds a value.
  assert.match(
    CODE,
    /\['quotationPrintAttention', contact\?\.contact_person, 'auto'\],\s+\['quotationPrintMobile', contact\?\.contact_number, 'ltr'\],\s+\['quotationPrintEmail', contact\?\.email, 'ltr'\],/,
  )
  assert.match(CODE, /\{clientContact\.length > 0 && \(/)
  assert.match(
    read('src', 'lib', 'quotationsData.ts'),
    /export const QUOTATION_COMPANY_SELECT =\s+'id,contact_person,contact_number,email'/,
  )
  assert.equal(translations.ar.quotationPrintAttention, 'عناية')
  assert.equal(translations.en.quotationPrintAttention, 'Attention')
})

test('the tables: the brand head under an amber rule; costs beside hours', () => {
  assert.match(
    SHEET,
    /const HEAD = `\$\{CELL\} border-\[var\(--brand-charcoal\)\] bg-\[var\(--brand-charcoal\)\] font-medium text-bg \[&_bdi\]:text-bg \[&_bdi\]:opacity-80`/,
  )
  assert.match(
    SHEET,
    /const TABLE =\s+'w-full table-fixed border-collapse border-t-\[3px\] border-t-\[var\(--brand-amber\)\]'/,
  )
  assert.equal((CODE.match(/<table className=\{TABLE\}>/g) ?? []).length, 3)
  // The two small tables share one row; the hours are always printed.
  const row = CODE.slice(
    CODE.indexOf('grid grid-cols-2 items-start gap-4'),
    CODE.indexOf('{quotation.notes && ('),
  )
  const costsAt = row.indexOf('k="quotationPrintCosts"')
  const hoursAt = row.indexOf('k="quotationPrintHours"')
  assert.ok(costsAt > 0 && hoursAt > costsAt)
  assert.match(row, /\{costs\.length > 0 && \(/)
  assert.match(row, /\{quotationHoursRows\(hours\)\.map\(\(row\) => \(/)
  assert.match(row, /\{costName\(cost\.name\)\}/)
  // The brand colours are tokens, never a hex in the sheet.
  assert.doesNotMatch(SHEET, /#[0-9a-fA-F]{6}\b/)
  const css = read('src', 'index.css')
  assert.match(css, /--brand-amber: #f8ab1b;/)
  assert.match(css, /--brand-charcoal: #30302f;/)
  assert.match(SHEET, /\[print-color-adjust:exact\]/)
})

test('the terms and the closing line follow the version', () => {
  // The mixed sheet: the Arabic list alone, then the English list (owner
  // 2026-11-17, «خلي الشروط العربية لحالها, وتحتها الشروط الانجليزية»).
  assert.match(
    SHEET,
    /const termLists: Lang\[\] = both \? \['ar', 'en'\] : \[main\]/,
  )
  assert.match(
    CODE,
    /termLists\.map\(\(lang, listIndex\) => \([\s\S]*?dir=\{lang === 'en' \? 'ltr' : 'rtl'\}\s+lang=\{lang\}/,
  )
  assert.match(CODE, /\{word\(lang, 'quotationPrintTerms'\)\}/)
  assert.match(CODE, /\{lang === 'en' \? term\.body_en : term\.body_ar\}/)
  // The closing line is the last thing of the sheet, always printed.
  const footer = CODE.slice(CODE.indexOf('<footer'), CODE.indexOf('</footer>'))
  assert.ok(footer.length > 0)
  assert.ok(CODE.indexOf('<footer') > CODE.indexOf('quotationPrintTerms'))
  assert.match(footer, /break-inside-avoid/)
  assert.match(footer, /\{electronic\(lang\)\}/)
  assert.match(
    SHEET,
    /word\(lang, 'quotationPrintElectronic'\)\.replace\(\s+'\{company\}',\s+lang === 'ar' \? profile\.nameAr : profile\.nameEn,/,
  )
  // The company's data is in the header now, not in the footer.
  assert.doesNotMatch(footer, /companyFacts/)
})

test('not built: signature, stamp, QR, version or check code, prepared-by', () => {
  const lower = (
    SHEET +
    read('src', 'lib', 'companyProfile.ts') +
    read('src', 'lib', 'quotationPrint.ts')
  ).toLowerCase()
  for (const word of [
    'qrcode',
    'qr code',
    'stamp block',
    'signature block',
    'prepared by',
    'checksum',
    'verification',
  ]) {
    assert.ok(!lower.includes(word), word)
  }
  assert.doesNotMatch(
    SHEET,
    /quotationPrint(Signature|Stamp|Qr|Version|PreparedBy)/,
  )
})

test('the translations: both languages, the owner’s sentence, plain alif', () => {
  const keys = [
    'quotationPdfAr',
    'quotationPdfEn',
    'quotationPdfBoth',
    'quotationPrintAttention',
    'quotationPrintMobile',
    'quotationPrintAddress',
    'quotationPrintPhone',
    'quotationPrintEmail',
    'quotationPrintHours',
    'quotationPrintHoursItem',
    'quotationPrintHoursCount',
    'quotationPrintDailyHours',
    'quotationPrintMonthlyDays',
    'quotationPrintMonthlyHours',
    'quotationPrintElectronic',
    'quotationPrintPage',
    'quotationPrintPageOf',
    'quotationPrintFileIssued',
  ]
  for (const key of keys) {
    assert.equal(typeof translations.ar[key], 'string', `ar.${key}`)
    assert.equal(typeof translations.en[key], 'string', `en.${key}`)
    assert.doesNotMatch(translations.ar[key], HAMZA_ALIF, key)
  }
  assert.ok(!('quotationPrintNationalAddress' in translations.ar))
  assert.equal(
    translations.ar.quotationPrintElectronic.replace(
      '{company}',
      profileLib.COMPANY_PROFILE.nameAr,
    ),
    'هذا المستند صادر الكترونيا من نظام شركة عبدالله احمد العزاني للمقاولات ولا يحتاج توقيع او ختم.',
  )
  assert.equal(
    translations.en.quotationPrintElectronic,
    'This document is issued electronically by the system of {company} and needs no signature or stamp.',
  )
  assert.equal(translations.ar.quotationPrintPage, 'صفحة')
  assert.equal(translations.en.quotationPrintPage, 'Page')
})

test('the supplier PO sheet is untouched', () => {
  const po = read('src', 'components', 'purchasing', 'SupplierPoPrintSheet.tsx')
  assert.match(po, /@page \{ size: A4 portrait; margin: 0; \}/)
  assert.doesNotMatch(po, /companyProfile|quotationPrint|quotationPageCss/)
  assert.doesNotMatch(po, /--brand-/)
})

// --- Weights and the price columns --------------------------------------------

test('the sheet is light: one bold title, the rest medium or regular', () => {
  // «قلل من البولد في ملف الPDF»: the title alone is bold (the approved
  // sheet); the names, the table heads and the section titles are medium.
  assert.equal((CODE.match(/font-bold/g) ?? []).length, 1)
  assert.doesNotMatch(CODE, /font-semibold/)
  assert.match(CODE, /<h1\s+className=\{`text-\[30px\] font-bold/)
  assert.match(SHEET, /const SECTION_TITLE = `mb-1\.5 font-medium \$\{BRAND\}`/)
  assert.match(CODE, /<p className="font-medium">\{line\.equipment_type\}<\/p>/)
  // The values of the small fact rows are regular, the quotation's own
  // three in the brand charcoal.
  assert.match(
    CODE,
    /strong \? 'm-0 font-medium text-\[var\(--brand-charcoal\)\]' : 'm-0'/,
  )
})

test('the three price columns are centred, head over amount', () => {
  // «واضبط محاذاة الاعمدة حق يومي شهري النقل».
  assert.match(SHEET, /const CELL = 'border px-2 py-1\.5 align-middle'/)
  assert.match(
    CODE,
    /<th key=\{key\} scope="col" className=\{`\$\{HEAD\} text-center`\}>/,
  )
  for (const field of ['daily_price', 'monthly_price', 'mob_demob_price'])
    assert.match(
      CODE,
      new RegExp(
        `<td className=\\{\`\\$\\{CELL\\} text-center\`\\}>\\s+\\{price\\(line\\.${field}\\)\\}\\s+</td>`,
      ),
    )
})
