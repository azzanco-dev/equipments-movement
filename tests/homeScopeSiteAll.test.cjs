// Owner 2026-10-28 («سويت دور رئيس الفورمين وعطيته عرض جميع الحركات، لكن
// لسى مايعرض الا حركاتي»): a foreman home lists the user's own rows only
// while his movements.read scope is `own`; `all` or `site` embeds the log.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'lib', 'homeScope.ts'),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const mod = { exports: {} }
vm.runInNewContext(outputText, { module: mod, exports: mod.exports, require })
const scopeOf = (entries) =>
  mod.exports.homeMovementsScopeFromPermissions(new Map(entries))

test('a foreman home follows the movements.read scope', () => {
  assert.equal(scopeOf([['home.foreman', 'own'], ['movements.read', 'own']]), 'own_site')
  assert.equal(scopeOf([['home.foreman', 'own']]), 'own_site')
  assert.equal(scopeOf([['home.foreman', 'all'], ['movements.read', 'site']]), 'site_all')
  assert.equal(scopeOf([['home.foreman', 'own'], ['movements.read', 'all']]), 'site_all')
  assert.equal(scopeOf([['home.foreman', 'own'], ['movements.read', 'workshop']]), 'own_site')
})

test('the workshop homes and the fallback are unchanged', () => {
  assert.equal(scopeOf([['home.workshop', 'all'], ['movements.read', 'all']]), 'all_contexts')
  assert.equal(scopeOf([['home.workshop', 'workshop']]), 'workshop')
  assert.equal(scopeOf([]), 'own_site')
  assert.equal(
    mod.exports.resolveHomeMovementsScope({
      status: 'loading',
      permissions: new Map([['home.foreman', 'all'], ['movements.read', 'all']]),
    }),
    'own_site',
  )
})
