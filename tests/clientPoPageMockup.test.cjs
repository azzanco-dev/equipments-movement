// /ui-kit «نموذج صفحة PO العميل الجديدة» (owner 2026-11-08, Notion EM-262):
// the client PO page inspired by /client-po-lab, on the project tokens, with
// the owner decisions of that day, registered for review.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const mockup = read('src', 'screens', 'ui-kit', 'ClientPoPageMockup.tsx')

test('the mockup is a /ui-kit section under review, listed first', () => {
  const kit = read('src', 'screens', 'UiKit.tsx')
  assert.match(
    kit,
    /import \{ ClientPoPageMockup \} from '@\/screens\/ui-kit\/ClientPoPageMockup'/,
  )
  assert.match(
    kit,
    /const SCREEN_SECTIONS: SectionDef\[\] = \[\r?\n  \{[\s\S]*?id: 'client-po-page',\r?\n    title: 'نموذج صفحة PO العميل الجديدة',[\s\S]*?status: 'review',[\s\S]*?element: <ClientPoPageMockup \/>/,
  )
})

test('no approval, four price units, quantity or «حسب العمل»', () => {
  assert.doesNotMatch(
    mockup,
    />\s*(مسودة|معتمد)\s*<|'(مسودة|معتمد)'|approval_status/,
  )
  for (const per of ['لكل شهر', 'لكل اسبوع', 'لكل يوم', 'لكل ساعة'])
    assert.ok(mockup.includes(per), per)
  for (const unit of ['month', 'week', 'day', 'hour'])
    assert.match(mockup, new RegExp(`unit: '${unit}'`))
  assert.match(mockup, /qty: null/)
  assert.ok(mockup.includes('حسب العمل'))
  assert.ok(mockup.includes('المتراكم حتى الان'))
  assert.ok(mockup.includes('بلا تاريخ انتهاء'))
})

test('the contract value sums price × quantity, VAT through the shared helpers', () => {
  assert.match(mockup, /import \{ vatOf, withVat \} from '@\/lib\/purchasing'/)
  assert.match(mockup, /line\.price !== null && line\.qty !== null/)
  assert.ok(mockup.includes('القيمة التعاقدية قبل الضريبة'))
})

test('static, no PDF or card end', () => {
  assert.doesNotMatch(mockup, /supabase|fetch\(/i)
  assert.doesNotMatch(
    mockup,
    /Printer|FileDown|window\.print|>\s*تصدير PDF\s*<|>\s*انهاء الكرت\s*</,
  )
})

test('tokens only, no hamza alif, no uppercase', () => {
  assert.doesNotMatch(
    mockup,
    /\b(gray|slate|zinc|neutral|stone|red|green|amber|yellow|blue|emerald|indigo|teal|rose)-\d{2,3}\b/,
  )
  assert.doesNotMatch(mockup, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(mockup, /rgba?\(/)
  assert.doesNotMatch(
    mockup,
    /bg-white|text-white|bg-black|text-black|gradient/,
  )
  assert.doesNotMatch(mockup, /[أإآ]/)
  assert.doesNotMatch(mockup, /uppercase/)
})
