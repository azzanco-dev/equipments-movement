const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Owner 2026-11-17, «برضه نبغى نضيف موثوقية اكثر لمستند الـ PDF» — the
// quotation PDF only («عروض الاسعار فقط»), «بدون توقيع وختم», no QR:
//   1. the company's official data at the end of the sheet, only the fields
//      that hold a value (`src/lib/companyProfile.ts`);
//   2. the closing line «هذا المستند صادر الكترونيا … ولا يحتاج توقيع او ختم»
//      in Arabic then English;
//   3. on every printed page the page number and the time the file was
//      issued, through CSS page-margin boxes (`src/lib/quotationPrint.ts`).

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

test('the profile: the known name, every other field empty for now', () => {
  const profile = profileLib.COMPANY_PROFILE
  assert.equal(profile.nameAr, 'شركة عبدالله احمد العزاني للمقاولات')
  assert.equal(profile.nameAr, translations.ar.supplierPoPrintBuyerName)
  assert.equal(profile.nameEn, translations.en.supplierPoPrintBuyerName)
  assert.deepEqual(Object.keys(profile).sort(), [
    'address',
    'email',
    'nameAr',
    'nameEn',
    'phone',
    'shortAddress',
    'unifiedNumber',
    'vatNumber',
  ])
  // Nothing is printed until the owner gives the values.
  assert.deepEqual(profileLib.companyProfileFacts(), [])
})

test('only the fields that hold a value are printed, in order', () => {
  const base = profileLib.COMPANY_PROFILE
  const full = profileLib.companyProfileFacts({
    ...base,
    unifiedNumber: ' 7001234567 ',
    vatNumber: '300012345600003',
    address: 'حي الصناعية، جدة 23456',
    shortAddress: 'rrrd2929',
    phone: '+966 12 345 6789',
    email: 'info@example.com',
  })
  assert.deepEqual(
    full.map((fact) => [fact.key, fact.value, fact.dir]),
    [
      ['unifiedNumber', '7001234567', 'ltr'],
      ['vatNumber', '300012345600003', 'ltr'],
      ['nationalAddress', 'حي الصناعية، جدة 23456 — RRRD 2929', 'auto'],
      ['phone', '+966 12 345 6789', 'ltr'],
      ['email', 'info@example.com', 'ltr'],
    ],
  )
  assert.deepEqual(
    full.map((fact) => fact.label),
    [
      'supplierPoPrintCrNumber',
      'supplierPoPrintVatNumber',
      'quotationPrintNationalAddress',
      'quotationPrintPhone',
      'quotationPrintEmail',
    ],
  )
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
  // The national address prints with the full address or the short one alone.
  assert.equal(
    profileLib.companyProfileFacts({ ...base, shortAddress: 'RRRD2929' })[0]
      .value,
    'RRRD 2929',
  )
  assert.equal(
    profileLib.companyProfileFacts({ ...base, address: ' جدة ' })[0].value,
    'جدة',
  )
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

test('the sheet: the page rule, the company data and the closing line', () => {
  assert.match(
    SHEET,
    /import \{\s+COMPANY_PROFILE,\s+companyProfileFacts,\s+type CompanyProfile,\s+\} from '@\/lib\/companyProfile'/,
  )
  assert.match(
    SHEET,
    /import \{ printIssuedAtLabel, quotationPageCss \} from '@\/lib\/quotationPrint'/,
  )
  // The issue time is taken once per print and feeds the page rule.
  assert.match(
    SHEET,
    /const \[issuedAt\] = useState\(\(\) => printIssuedAtLabel\(new Date\(\)\)\)/,
  )
  assert.match(SHEET, /<style>\{quotationPageCss\(issuedAt\)\}<\/style>/)
  assert.doesNotMatch(SHEET, /@page \{ size: A4 portrait; margin: 0; \}/)
  // The sheet's bottom padding gave way to the page's bottom margin.
  assert.match(SHEET, /px-\[10mm\] pb-\[2mm\] pt-\[12mm\]/)

  const footer = SHEET.slice(
    SHEET.indexOf('<footer'),
    SHEET.indexOf('</footer>'),
  )
  assert.ok(footer.length > 0, 'the sheet ends with a footer')
  // After the terms, the last thing of the sheet.
  assert.ok(SHEET.indexOf('<footer') > SHEET.indexOf('quotationPrintTerms'))
  assert.match(footer, /break-inside-avoid/)
  // The empty-field rule: no company block without a value.
  assert.match(SHEET, /const companyFacts = companyProfileFacts\(profile\)/)
  assert.match(footer, /\{companyFacts\.length > 0 && \(/)
  assert.match(footer, /companyFacts\.map\(\(fact\) => \(/)
  assert.match(footer, /<Inline k=\{fact\.label\} \/>/)
  assert.match(footer, /<bdi dir=\{fact\.dir\}/)
  // The closing line, Arabic then English, always printed.
  const arLine = footer.indexOf("ar('quotationPrintElectronic')")
  const enLine = footer.indexOf("en('quotationPrintElectronic')")
  assert.ok(arLine > 0 && enLine > arLine)
  assert.ok(arLine > footer.indexOf('companyFacts.length > 0'))
  assert.match(SHEET, /profile = COMPANY_PROFILE,/)
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
    'quotationPrintNationalAddress',
    'quotationPrintPhone',
    'quotationPrintEmail',
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
})

// --- Weights and the price columns (owner 2026-11-17) ------------------------

test('the sheet is light: one semibold title, the rest medium or regular', () => {
  // «قلل من البولد في ملف الPDF».
  assert.doesNotMatch(SHEET, /font-bold/)
  assert.equal((SHEET.match(/font-semibold/g) ?? []).length, 1)
  assert.match(SHEET, /<h1 className="text-xl font-semibold leading-tight">/)
  // The table heads, the two names, the type and the section titles: medium.
  // … on a dark bar with white text (owner 2026-11-17, «خلي الHEADERS بلون
  // خلفية سوداء», then «خلي الاسود افتح»): a charcoal mixed from the sheet's
  // own near-black and white tokens, never a hex.
  assert.match(
    SHEET,
    /const HEAD_TONE =\s+'border-\[color-mix\(in_srgb,var\(--fg\)_75%,var\(--bg\)\)\] bg-\[color-mix\(in_srgb,var\(--fg\)_75%,var\(--bg\)\)\]'/,
  )
  assert.match(
    SHEET,
    /const head = `\$\{cell\} \$\{HEAD_TONE\} font-medium text-bg \[&_bdi\]:text-bg \[&_bdi\]:opacity-80`/,
  )
  assert.doesNotMatch(SHEET, /#[0-9a-fA-F]{6}\b/)
  assert.match(SHEET, /\[print-color-adjust:exact\]/)
  // The costs, the notes and the two term lists.
  assert.equal(
    (SHEET.match(/<h2 className="mb-1 font-medium">/g) ?? []).length,
    4,
  )
  // The terms: the Arabic list alone, then the English list under it (owner
  // 2026-11-17, «خلي الشروط العربية لحالها, وتحتها الشروط الانجليزية»).
  const arTerms = SHEET.indexOf("{ar('quotationPrintTerms')}</h2>")
  const enTerms = SHEET.indexOf("{en('quotationPrintTerms')}</h2>")
  const arBody = SHEET.indexOf('{term.body_ar}')
  const enBody = SHEET.indexOf('{term.body_en}')
  assert.ok(
    arTerms > 0 && arBody > arTerms && enTerms > arBody && enBody > enTerms,
  )
  assert.equal((SHEET.match(/\{term\.body_(ar|en)\}/g) ?? []).length, 2)
  assert.match(
    SHEET,
    /<section className="mt-3 text-start" dir="ltr" lang="en">\s+<h2 className="mb-1 font-medium">\{en\('quotationPrintTerms'\)\}<\/h2>/,
  )
  assert.match(
    SHEET,
    /<p className="font-medium">\{line\.equipment_type\}<\/p>/,
  )
  // The values (the header facts, the client's numbers, the prices): regular.
  assert.match(SHEET, /<dd className="m-0">\{fact\.value\}<\/dd>/)
})

test('the three price columns are centred, head over amount', () => {
  // «واضبط محاذاة الاعمدة حق يومي شهري النقل».
  assert.match(
    SHEET,
    /const priceCell = 'border px-2 py-1\.5 align-middle text-center'/,
  )
  assert.match(
    SHEET,
    /<th key=\{key\} scope="col" className=\{`\$\{head\} text-center`\}>/,
  )
  for (const field of ['daily_price', 'monthly_price', 'mob_demob_price'])
    assert.match(
      SHEET,
      new RegExp(
        `<td className=\\{priceCell\\}>\\{price\\(line\\.${field}\\)\\}</td>`,
      ),
    )
  assert.doesNotMatch(SHEET, /text-end/)
})
