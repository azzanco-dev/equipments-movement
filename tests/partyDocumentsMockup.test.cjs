// /ui-kit «مستندات الموردين والشركات» (owner 2026-11-07, «ابدا»): the mockup
// is registered for review, uses tokens only and new Arabic copy without
// alif with hamza or madda.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const mockup = read('src', 'screens', 'ui-kit', 'PartyDocumentsMockup.tsx')

test('the mockup is a /ui-kit section, the colourful look approved', () => {
  const kit = read('src', 'screens', 'UiKit.tsx')
  assert.match(kit, /import \{ PartyDocumentsMockup \} from '@\/screens\/ui-kit\/PartyDocumentsMockup'/)
  assert.match(
    kit,
    /id: 'party-documents',\n    title: 'مستندات الموردين والشركات',[\s\S]*?status: 'approved',[\s\S]*?element: <PartyDocumentsMockup \/>/,
  )
})

test('the document types: the IBAN certificate for suppliers only', () => {
  const lessor = /lessor: \[([\s\S]*?)\],/.exec(mockup)[1]
  const company = /company: \['([^\]]*)\],/.exec(mockup)[1]
  for (const type of ['commercial_register', 'tax_certificate', 'iban_certificate', 'national_address'])
    assert.match(lessor, new RegExp(`'${type}'`))
  assert.doesNotMatch(company, /iban_certificate/)
})

test('PDF or an image up to 5 MB, nothing leaves the browser', () => {
  assert.match(mockup, /const MAX_MB = 5\n/)
  assert.match(mockup, /const ACCEPT = 'application\/pdf,image\/jpeg,image\/png,image\/webp'/)
  assert.doesNotMatch(mockup, /supabase|fetch\(|storage/i)
  // Evidence is never cropped.
  assert.match(mockup, /object-contain/)
  assert.doesNotMatch(mockup, /object-cover/)
})

test('no expiry date, upload date or uploader (owner 2026-11-07)', () => {
  // «بدون تاريخ الانتهاء ماعلينا منهم وبدون تاريخ الرفع ومين رفعه»
  assert.doesNotMatch(mockup, /expires|SOON_DAYS|uploadedBy|uploadedAt/)
  assert.doesNotMatch(mockup, /'(منتهي|ينتهي قريبا|ساري)'|>(منتهي|ينتهي قريبا|ساري)<|رفعه |تاريخ الانتهاء \(/)
})

test('tokens only, no hamza alif, no letter-spacing', () => {
  assert.doesNotMatch(mockup, /\b(gray|slate|zinc|red|green|amber|blue|emerald)-\d{2,3}\b/)
  assert.doesNotMatch(mockup, /#[0-9a-fA-F]{3,6}\b/)
  assert.doesNotMatch(mockup, /[أإآ]/)
  assert.doesNotMatch(mockup, /tracking-|uppercase/)
})
