const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 0177 (owner 2026-11-05, «سوي قائمة للبنوك السعودية المعروفة, بحيث يكون
// اختيار منها, ويكون الاضافة او الحذف او التعديل من الاعدادات»): the banks
// list the supplier's bank is picked from. Static checks only.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const files = fs.readdirSync(MIGRATIONS).sort()
const file = files.find((name) => /_0177_/.test(name))
const code = fs
  .readFileSync(path.join(MIGRATIONS, file), 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

test('0177 comes after 0175 and 0176', () => {
  assert.equal(files.filter((name) => /_0177_/.test(name)).length, 1)
  assert.ok(files.indexOf(file) > files.findIndex((n) => /_0175_/.test(n)))
  assert.match(files[files.indexOf(file) - 1], /_0176_/)
})

test('the banks table: unique name, 1–100 characters, updated_at trigger', () => {
  assert.match(code, /CREATE TABLE IF NOT EXISTS public\.banks/)
  assert.match(code, /name text NOT NULL UNIQUE/)
  assert.match(code, /btrim\(name\) <> '' AND char_length\(name\) <= 100/)
  assert.match(code, /banks_name_lower_key\s+ON public\.banks \(lower\(btrim\(name\)\)\)/)
  assert.match(code, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(code, /BEFORE UPDATE ON public\.banks\s+FOR EACH ROW EXECUTE FUNCTION public\.update_updated_at\(\)/)
})

test('seeded with the known Saudi banks, no hamza on the alif', () => {
  const seed = /INSERT INTO public\.banks \(name\) VALUES([\s\S]*?)ON CONFLICT DO NOTHING/.exec(code)[1]
  const names = [...seed.matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.ok(names.length >= 10)
  for (const bank of ['مصرف الراجحي', 'البنك الاهلي السعودي', 'بنك الرياض', 'مصرف الانماء'])
    assert.ok(names.includes(bank), bank)
  for (const name of names) assert.doesNotMatch(name, /[أإآ]/, name)
})

test('stored 0175 bank names join the list before the foreign key', () => {
  const join = code.indexOf('FROM public.lessors AS l')
  const fk = code.indexOf('ADD CONSTRAINT lessors_bank_name_fkey')
  assert.ok(join > 0 && fk > join)
  assert.match(
    code,
    /FOREIGN KEY \(bank_name\) REFERENCES public\.banks\(name\)\s+ON UPDATE CASCADE ON DELETE RESTRICT/,
  )
})

test('everyone signed in reads; lessors.edit writes', () => {
  assert.match(code, /ALTER TABLE public\.banks ENABLE ROW LEVEL SECURITY/)
  assert.match(code, /CREATE POLICY select_banks ON public\.banks\s+FOR SELECT TO authenticated\s+USING \(true\)/)
  for (const verb of ['insert', 'update', 'delete'])
    assert.match(
      code,
      new RegExp(`CREATE POLICY ${verb}_banks ON public\\.banks[\\s\\S]*?has_permission\\('lessors\\.edit'\\)`),
    )
  assert.doesNotMatch(code, /\bGRANT\b/)
})

test('the supplier form picks the bank from the list; the dialog is wide', () => {
  const form = read('src', 'screens', 'lessors', 'LessorFormDialog.tsx')
  assert.match(form, /bankOptionLoader\(supabase\)/)
  assert.match(form, /<AsyncSearchSelect[\s\S]*?value=\{form\.bank_name\}/)
  assert.doesNotMatch(form, /field: 'bank_name'/)
  assert.match(form, /size="lg"/)
  const rules = read('src', 'lib', 'lessorForm.ts')
  assert.match(rules, /on: 'foreignKey',\s+match: 'lessors_bank_name_fkey',\s+field: 'bank_name',\s+key: 'bankNotInList'/)
  const loader = read('src', 'lib', 'banks.ts')
  assert.match(loader, /\.from\('banks'\)\s+\.select\('name'\)\s+\.order\('name'\)\s+\.limit\(BANK_OPTION_LIMIT\)/)
  assert.match(loader, /BANK_OPTION_LIMIT = 20/)
})

test('the import accepts only a bank of the list, in the list\'s spelling', () => {
  const dialog = read('src', 'screens', 'lessors', 'LessorImportDialog.tsx')
  assert.match(dialog, /matchImportBanks\(\s*parsed,\s*await fetchBankNames\(supabase\),\s*t\('bankNotInList'\)/)
})

test('Settings › «البنوك»: its own page, gated on lessors.edit, writes read back', () => {
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.match(settings, /const showBanks = pathname === '\/settings\/banks'/)
  assert.match(settings, /\{opens\('settings\/banks'\) && \(/)
  assert.match(settings, /<BanksSettings \/>/)
  const nav = read('src', 'lib', 'navPermissions.ts')
  assert.match(nav, /'settings\/banks': \[\{ key: 'lessors\.edit' \}\]/)
  const page = read('src', 'components', 'banks', 'BanksSettings.tsx')
  assert.match(page, /select\('id,name,updated_at,lessors\(count\)', \{ count: 'exact' \}\)/)
  assert.match(page, /\.range\(/)
  assert.match(page, /buildSearchFilter\(NAME_SEARCH_FIELDS, search\)/)
  assert.match(page, /lessorsActions\(usePermissions\(\)\)\.edit/)
  assert.equal(page.match(/\.select\('id'\)/g)?.length, 3)
  assert.match(page, /bankInUse\(result\.error\)/)
  assert.match(page, /<ErrorState description=\{loadError\} onRetry=\{fetchRows\} \/>/)
})

test('the new Arabic copy has no hamza on the alif', () => {
  const tr = read('src', 'i18n', 'translations.ts')
  const block = /\/\/ banks — start[\s\S]*?\/\/ banks — end/.exec(tr)[0]
  assert.doesNotMatch(block, /[أإآ]/)
  assert.equal(tr.match(/\/\/ banks — start/g).length, 2)
})
