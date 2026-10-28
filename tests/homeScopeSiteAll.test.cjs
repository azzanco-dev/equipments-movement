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
  // «لما احط له حركات الورشة فقط، يرجع يجيب حركاته فقط» (2026-10-28).
  assert.equal(scopeOf([['home.foreman', 'own'], ['movements.read', 'workshop']]), 'workshop_all')
  // `companies` reads the rows of his companies (RLS): the embedded log too.
  assert.equal(scopeOf([['home.foreman', 'own'], ['movements.read', 'companies']]), 'site_all')
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

// The shell decides the field home's list too (App passes shell.homeScope):
// it must follow the same rule (2026-10-28, the first fix missed it).
test('the shell gives the foreman home the same list as homeScope', () => {
  const navSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'navPermissions.ts'),
    'utf8',
  )
  const navOut = ts.transpileModule(navSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const nav = { exports: {} }
  vm.runInNewContext(navOut, { module: nav, exports: nav.exports, require })
  for (const entries of [
    [['home.foreman', 'own'], ['movements.read', 'own']],
    [['home.foreman', 'own'], ['movements.read', 'site']],
    [['home.foreman', 'own'], ['movements.read', 'workshop']],
    [['home.foreman', 'all'], ['movements.read', 'all']],
    [['home.foreman', 'own'], ['movements.read', 'companies']],
    [['home.foreman', 'own']],
    [['home.workshop', 'all']],
    [['home.workshop', 'workshop']],
  ]) {
    const permissions = new Map(entries)
    const shell = nav.exports.planShell({ status: 'ready', permissions })
    assert.equal(shell.homeScope, scopeOf(entries), JSON.stringify(entries))
  }
})
