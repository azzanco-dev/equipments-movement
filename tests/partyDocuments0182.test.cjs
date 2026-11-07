// Documents of suppliers and clients (owner 2026-11-07, migration 0182):
// the database rules, the pure helpers and the screens' wiring.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const migration = (() => {
  const file = fs
    .readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .find((name) => name.includes('_0182_'))
  assert.ok(file, '0182 exists')
  return read('supabase', 'migrations', file)
})()
const lib = (() => {
  const source = path.join(ROOT, 'src', 'lib', 'partyDocuments.ts')
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, Math, require: () => ({}) })
  return exports
})()
const plain = (value) => JSON.parse(JSON.stringify(value))

// --- Database -----------------------------------------------------------------

test('0182: a private bucket of 10 MB for PDF and three image types', () => {
  assert.match(
    migration,
    /INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\nVALUES \(\n  'party-documents',\n  'party-documents',\n  false,\n  10485760,\n  ARRAY\['application\/pdf', 'image\/jpeg', 'image\/png', 'image\/webp'\]\n\)/,
  )
  assert.match(migration, /ON CONFLICT \(id\) DO UPDATE\nSET public = false,/)
})

test('0182: one party per row, RESTRICT, the IBAN certificate for suppliers only', () => {
  assert.match(migration, /lessor_id uuid REFERENCES public\.lessors\(id\) ON DELETE RESTRICT/)
  assert.match(migration, /company_id uuid REFERENCES public\.companies\(id\) ON DELETE RESTRICT/)
  assert.match(migration, /CHECK \(\(lessor_id IS NULL\) <> \(company_id IS NULL\)\)/)
  assert.match(migration, /CHECK \(doc_type <> 'iban_certificate' OR lessor_id IS NOT NULL\)/)
  assert.match(migration, /doc_type = 'other' AND title IS NOT NULL AND char_length\(btrim\(title\)\) BETWEEN 1 AND 100/)
  assert.match(migration, /CHECK \(size_bytes BETWEEN 1 AND 10485760\)/)
  assert.doesNotMatch(migration, /expires|expiry_date/, 'no expiry column (owner)')
})

test('0182: one current file per fixed type, updated_at with its trigger', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS party_documents_lessor_type_unique\n  ON public\.party_documents \(lessor_id, doc_type\)\n  WHERE lessor_id IS NOT NULL AND doc_type <> 'other';/,
  )
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS party_documents_company_type_unique\n  ON public\.party_documents \(company_id, doc_type\)\n  WHERE company_id IS NOT NULL AND doc_type <> 'other';/,
  )
  assert.match(migration, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(migration, /BEFORE UPDATE ON public\.party_documents\nFOR EACH ROW EXECUTE FUNCTION public\.update_updated_at\(\);/)
})

test('0182: the row trigger sets the uploader and locks the path to the party folder', () => {
  assert.match(migration, /NEW\.uploaded_by := auth\.uid\(\);/)
  assert.match(migration, /RAISE EXCEPTION 'party_document_identity_locked'/)
  assert.match(migration, /'lessor\/' \|\| NEW\.lessor_id::text \|\| '\/'/)
  assert.match(migration, /RAISE EXCEPTION 'party_document_path_invalid'/)
})

test('0182: RLS reads by the read OR edit key, writes by the edit key', () => {
  assert.match(migration, /ALTER TABLE public\.party_documents ENABLE ROW LEVEL SECURITY;/)
  const select = /CREATE POLICY select_party_documents[\s\S]*?\);\n/.exec(migration)[0]
  for (const key of ['lessors.read', 'lessors.edit', 'companies_projects.read', 'companies_projects.edit'])
    assert.match(select, new RegExp(key.replace('.', '\\.')))
  for (const policy of ['insert_party_documents', 'update_party_documents', 'delete_party_documents']) {
    const body = new RegExp(`CREATE POLICY ${policy} [\\s\\S]*?\\);\\n`).exec(migration)[0]
    assert.match(body, /lessors\.edit/, policy)
    assert.match(body, /companies_projects\.edit/, policy)
    assert.doesNotMatch(body, /\.read'/, policy)
  }
  assert.doesNotMatch(migration, /USING \(true\)/)
})

test('0182: storage policies for this bucket only, no update policy, definer helpers locked down', () => {
  for (const [policy, helper, op] of [
    ['select_party_documents_objects', 'can_read_party_document_object', 'SELECT'],
    ['insert_party_documents_objects', 'can_upload_party_document_object', 'INSERT'],
    ['delete_party_documents_objects', 'can_delete_party_document_object', 'DELETE'],
  ]) {
    const body = new RegExp(`CREATE POLICY ${policy} ON storage\\.objects\\nFOR ${op} TO authenticated\\n[\\s\\S]*?\\);`).exec(migration)
    assert.ok(body, policy)
    assert.match(body[0], /bucket_id = 'party-documents'/)
    assert.match(body[0], new RegExp(`public\\.${helper}\\(name\\)`))
    const fn = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${helper}\\(p_name text\\)[\\s\\S]*?SECURITY DEFINER\\nSET search_path = public, pg_temp`).test(migration)
    assert.ok(fn, `${helper} is a definer with a fixed search_path`)
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\(text\\) FROM PUBLIC, anon;\\nGRANT EXECUTE ON FUNCTION public\\.${helper}\\(text\\) TO authenticated;`))
  }
  assert.doesNotMatch(migration, /FOR UPDATE TO authenticated\nUSING \(\n  bucket_id = 'party-documents'/)
  // A file is removed only once no row stores its path.
  assert.match(migration, /AND NOT EXISTS \(\n      SELECT 1 FROM public\.party_documents d WHERE d\.storage_path = p_name\n    \);/)
})

// --- Pure helpers --------------------------------------------------------------

test('the types per party: the clients have no IBAN certificate', () => {
  assert.deepEqual(plain(lib.PARTY_DOCUMENT_TYPES.lessor), [
    'commercial_register',
    'tax_certificate',
    'iban_certificate',
    'national_address',
  ])
  assert.deepEqual(plain(lib.PARTY_DOCUMENT_TYPES.company), [
    'commercial_register',
    'tax_certificate',
    'national_address',
  ])
})

test('the file rules mirror the bucket', () => {
  const mb = 1024 * 1024
  assert.equal(lib.partyDocumentFileError({ type: 'application/pdf', size: mb }), null)
  // 0183: 5 MB.
  assert.equal(lib.partyDocumentFileError({ type: 'image/webp', size: 5 * mb }), null)
  assert.equal(lib.partyDocumentFileError({ type: 'image/png', size: 5 * mb + 1 }), 'partyDocFileTooLarge')
  assert.equal(lib.partyDocumentFileError({ type: 'image/heic', size: mb }), 'partyDocFileTypeInvalid')
  assert.equal(lib.partyDocumentFileError({ type: 'application/pdf', size: 0 }), 'partyDocFileEmpty')
  assert.equal(lib.PARTY_DOCUMENT_ACCEPT, 'application/pdf,image/jpeg,image/png,image/webp')
})

test('the storage path is the one the policies accept', () => {
  assert.equal(
    lib.partyDocumentPath('lessor', 'p-1', 'application/pdf', 'f-1'),
    'lessor/p-1/f-1.pdf',
  )
  assert.equal(lib.partyDocumentPath('company', 'c-1', 'image/jpeg', 'f-2'), 'company/c-1/f-2.jpg')
  assert.equal(lib.storedFileName('  '), 'document')
  assert.equal(lib.storedFileName('x'.repeat(300) + '.pdf').length, 255)
})

test('grouping: the current file per fixed type, the others by time', () => {
  const doc = (id, doc_type, created_at) => ({ id, doc_type, created_at, mime_type: 'application/pdf' })
  const grouped = lib.groupPartyDocuments('company', [
    doc('a', 'other', '2026-11-07T10:00:00Z'),
    doc('b', 'tax_certificate', '2026-11-06T10:00:00Z'),
    doc('c', 'other', '2026-11-05T10:00:00Z'),
  ])
  assert.deepEqual(plain(grouped.fixed.map((slot) => [slot.type, slot.document?.id ?? null])), [
    ['commercial_register', null],
    ['tax_certificate', 'b'],
    ['national_address', null],
  ])
  assert.deepEqual(plain(grouped.others.map((item) => item.id)), ['c', 'a'])
})

test('errors map to safe messages, never the raw text', () => {
  assert.equal(
    lib.partyDocumentErrorKey({ message: 'duplicate key value violates unique constraint "party_documents_lessor_type_unique"' }),
    'partyDocAlreadyExists',
  )
  assert.equal(lib.partyDocumentErrorKey({ message: 'new row violates row-level security policy' }), 'partyDocNotAllowed')
  assert.equal(lib.partyDocumentErrorKey({ message: 'The object exceeded the maximum allowed size' }), 'partyDocFileTooLarge')
  assert.equal(lib.partyDocumentErrorKey({ message: 'boom' }), 'partyDocSaveFailed')
  assert.equal(
    lib.blockedByPartyDocuments({
      message: 'update or delete on table "lessors" violates foreign key constraint "party_documents_lessor_id_fkey" on table "party_documents"',
    }),
    true,
  )
  assert.equal(lib.blockedByPartyDocuments({ message: 'violates foreign key constraint "equipment_lessor_id_fkey"' }), false)
})

// --- Screens ---------------------------------------------------------------------

test('the data module uploads first, removes the new file when the row is refused', () => {
  const data = read('src', 'lib', 'partyDocumentsData.ts')
  const upload = data.indexOf('.upload(path, file, { contentType: file.type, upsert: false })')
  const row = data.indexOf(".from('party_documents')\n        .update(facts)")
  const rollback = data.indexOf('await removeObject(path)')
  const oldFile = data.indexOf('if (replacing) await removeObject(replacing.storage_path)')
  for (const at of [upload, row, rollback, oldFile]) assert.ok(at > 0)
  assert.ok(upload < row && row < rollback && rollback < oldFile)
  // The row first, then its file.
  assert.ok(
    data.indexOf(".delete()\n    .eq('id', document.id)") < data.indexOf('await removeObject(document.storage_path)'),
  )
  assert.match(data, /createSignedUrl\(document\.storage_path, 300\)/)
  assert.doesNotMatch(data, /getPublicUrl/)
})

test('both details dialogs show the section with the edit key; new records open on it', () => {
  for (const [dialog, list, kind] of [
    [['src', 'screens', 'lessors', 'LessorDetailsDialog.tsx'], ['src', 'screens', 'lessors', 'LessorsListScreen.tsx'], 'lessor'],
    [['src', 'screens', 'companies', 'CompanyDetailsDialog.tsx'], ['src', 'screens', 'companies', 'CompaniesListScreen.tsx'], 'company'],
  ]) {
    const source = read(...dialog)
    assert.match(source, new RegExp(`<PartyDocumentsSection\\n\\s+key=\\{\\w+\\.id\\}\\n\\s+kind="${kind}"`))
    assert.match(source, /canEdit=\{canEditDocuments\}/)
    assert.match(source, /notice=\{justCreated \? t\('partyDocCreatedNotice'\) : undefined\}/)
    const screen = read(...list)
    assert.match(screen, /canEditDocuments=\{canEdit\}/)
    assert.match(screen, /onSaved=\{\(createdId\) => void saved\(createdId\)\}/)
    assert.match(screen, /setJustCreated\(true\)/)
    assert.match(screen, /blockedByPartyDocuments\(error\)\n\s+\? 'partyDeleteHasDocuments'/)
  }
  for (const form of [
    ['src', 'screens', 'lessors', 'LessorFormDialog.tsx'],
    ['src', 'screens', 'companies', 'CompanyFormDialog.tsx'],
  ])
    assert.match(read(...form), /onSaved\(\w+ \? undefined : result\.data\?\.\[0\]\?\.id\)/)
})

test('the section shows no expiry, upload date or uploader; images are never cropped', () => {
  const section = read('src', 'components', 'parties', 'PartyDocumentsSection.tsx')
  assert.doesNotMatch(section, /expir|uploaded_by|created_at\)|object-cover/)
  assert.match(section, /<ErrorState description=\{t\(loadError\)\} onRetry=/)
  assert.match(section, /<Lightbox/)
})

test('every new key in both languages, Arabic without alif with hamza', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [...source.matchAll(/\/\/ party-documents \(0182\) — start\n([\s\S]*?)\/\/ party-documents \(0182\) — end/g)]
  assert.equal(blocks.length, 2)
  const keys = (block) => [...block.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(blocks[0][1]), keys(blocks[1][1]))
  assert.ok(keys(blocks[0][1]).length >= 30)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  const used = new Set(
    [
      read('src', 'components', 'parties', 'PartyDocumentsSection.tsx'),
      read('src', 'lib', 'partyDocuments.ts'),
      read('src', 'lib', 'partyDocumentsData.ts'),
    ]
      .join('\n')
      .match(/'partyDo\w+'|'partyDelete\w+'/g)
      .map((key) => key.slice(1, -1)),
  )
  for (const key of used) assert.ok(keys(blocks[0][1]).includes(key), key)
})

// --- 0183 and the icons (owner 2026-11-07) ----------------------------------------

test('0183: 5 MB for new files, earlier rows kept (NOT VALID)', () => {
  const file = fs
    .readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .find((name) => name.includes('_0183_'))
  assert.ok(file, '0183 exists')
  const sql = read('supabase', 'migrations', file)
  assert.match(sql, /UPDATE storage\.buckets\nSET file_size_limit = 5242880\nWHERE id = 'party-documents';/)
  assert.match(sql, /CHECK \(size_bytes BETWEEN 1 AND 5242880\) NOT VALID;/)
  assert.equal(lib.PARTY_DOCUMENT_MAX_BYTES, 5 * 1024 * 1024)
  const tr = read('src', 'i18n', 'translations.ts')
  assert.match(tr, /partyDocLimits: 'PDF او صورة \(JPG، PNG، WEBP\) حتى 5 ميغا',/)
  assert.match(tr, /partyDocFileTooLarge: 'The file is larger than 5 MB',/)
  assert.doesNotMatch(tr, /partyDoc\w+: '[^']*10 (ميغا|MB)/)
})

test('an icon per document type, beside its name, in the section and the mockup', () => {
  const section = read('src', 'components', 'parties', 'PartyDocumentsSection.tsx')
  const mockup = read('src', 'screens', 'ui-kit', 'PartyDocumentsMockup.tsx')
  for (const source of [section, mockup]) {
    for (const [type, icon] of [
      ['commercial_register', 'ScrollText'],
      ['tax_certificate', 'ReceiptText'],
      ['iban_certificate', 'Landmark'],
      ['national_address', 'MapPin'],
      ['other', 'Files'],
    ])
      assert.match(source, new RegExp(`  ${type}: ${icon},\n`))
    assert.match(source, /<Icon size=\{15\} className="shrink-0 text-muted" aria-hidden="true" \/>/)
    assert.match(source, /<FolderOpen size=\{15\}/)
  }
  assert.equal(section.match(/<TileTitle icon=\{icon\} title=\{title\} \/>/g).length, 2)
})
