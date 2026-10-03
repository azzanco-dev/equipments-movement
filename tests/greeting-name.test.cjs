const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const file = path.join(__dirname, '..', 'src', 'lib', 'greetingName.ts')
const mod = {}
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: mod },
)
const plain = (v) => JSON.parse(JSON.stringify(v))

test('greetingName keeps the first name only, compound names whole', () => {
  assert.equal(mod.greetingName('  محمد   احمد علي الغامدي '), 'محمد')
  assert.equal(mod.greetingName('Sara'), 'Sara')
  assert.equal(mod.greetingName('John Michael Smith'), 'John')
  assert.equal(mod.greetingName('عبد الله سالم العزاني'), 'عبد الله')
  assert.equal(mod.greetingName('ابو بكر احمد'), 'ابو بكر')
  assert.equal(mod.greetingName('عبدالله سالم'), 'عبدالله')
})

test('greetingName is empty for a missing or blank name', () => {
  assert.equal(mod.greetingName(undefined), '')
  assert.equal(mod.greetingName(null), '')
  assert.equal(mod.greetingName('   '), '')
})

test('greetingParts splits around the placeholder', () => {
  assert.deepEqual(plain(mod.greetingParts('Welcome, {name}!', true)), {
    before: 'Welcome, ',
    after: '!',
  })
  assert.equal(mod.greetingParts('Welcome, {name}', false), null)
  assert.equal(mod.greetingParts('Welcome', true), null)
})

test('homeGreeting exists in both languages with a placeholder', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'i18n', 'translations.ts'),
    'utf8',
  )
  assert.match(src, /homeGreeting: 'اهلاً، \{name\}'/)
  assert.match(src, /homeGreeting: 'Welcome, \{name\}'/)
  assert.doesNotMatch(src.match(/homeGreeting: '[^']*'/)[0], /[أإآ]/)
})
