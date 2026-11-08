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
    assert.match(source, /\{\.\.\.\(justCreated \? createdDocumentsNotice\(createdUploads, t\) : \{\}\)\}/)
    const screen = read(...list)
    assert.match(screen, /canEditDocuments=\{canEdit\}/)
    assert.match(screen, /onSaved=\{\(createdId, uploads\) => void saved\(createdId, uploads\)\}/)
    assert.match(screen, /setJustCreated\(\{ uploads \}\)/)
    assert.match(screen, /createdUploads=\{justCreated\?\.uploads\}/)
    assert.match(screen, /blockedByPartyDocuments\(error\)\n\s+\? 'partyDeleteHasDocuments'/)
  }
  for (const form of [
    ['src', 'screens', 'lessors', 'LessorFormDialog.tsx'],
    ['src', 'screens', 'companies', 'CompanyFormDialog.tsx'],
  ])
    assert.match(
      read(...form),
      /const createdId = \w+ \? undefined : \(result\.data\?\.\[0\]\?\.id[^\n]*\n[\s\S]*?onSaved\(createdId, uploads\)/,
    )
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
  const icons = [
    ['commercial_register', 'ScrollText', 3],
    ['tax_certificate', 'ReceiptText', 2],
    ['iban_certificate', 'Landmark', 1],
    ['national_address', 'MapPin', 5],
    ['other', 'Files', 6],
  ]
  // «الوان وحياة» (owner 2026-11-07, approved on /ui-kit): an icon and a
  // light chart shade per type, defined for both themes in src/index.css,
  // the same in the real section and the mockup.
  for (const source of [section, mockup]) {
    for (const [type, icon, tone] of icons)
      assert.match(source, new RegExp(`  ${type}: \\{ icon: ${icon}, tone: ${tone} \\},`))
    assert.match(source, /backgroundColor: `var\(--chart-\$\{tone\}\)`,\n  color: `var\(--chart-stroke-\$\{tone\}\)`,/)
    assert.match(source, /motion-safe:hover:-translate-y-0\.5/)
    assert.match(source, /<FolderOpen size=\{15\} \/>/)
    assert.match(source, /onDrop=\{drop\}/)
    assert.match(source, /role="progressbar"/)
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,6}\b/)
  }
  // The bar uses the completeness ring's colours.
  assert.match(section, /'var\(--progress-high\)'[\s\S]*?'var\(--progress-mid\)'[\s\S]*?'var\(--progress-low\)'/)
})

test('the edit forms show the documents too, saved apart from the form (owner 2026-11-08)', () => {
  // «ليش ماتضيف اضافة المستندات لdialog التعديل الشركات والموردين؟» — «نعم، نفذ»
  for (const [file, kind, record] of [
    [['src', 'screens', 'lessors', 'LessorFormDialog.tsx'], 'lessor', 'lessor'],
    [['src', 'screens', 'companies', 'CompanyFormDialog.tsx'], 'company', 'company'],
  ]) {
    const form = read(...file)
    assert.match(form, /import \{ PartyDocumentsSection \} from '@\/components\/parties\/PartyDocumentsSection'/)
    // Only while editing a record (a new one has no id), with the edit key,
    // and the line that says the files never wait for «حفظ».
    assert.match(
      form,
      new RegExp(
        `\\{${record} && \\(\\n\\s*<PartyDocumentsSection\\n\\s*key=\\{${record}\\.id\\}\\n\\s*kind="${kind}"\\n\\s*partyId=\\{${record}\\.id\\}\\n\\s*canEdit=\\{canSave\\}\\n\\s*hint=\\{t\\('partyDocSavedDirectly'\\)\\}`,
      ),
    )
    // The uploads are not form fields: the unsaved count stays the form's.
    assert.match(form, /changedFields\(initial, form\)/)
    assert.doesNotMatch(form, /documents.*changedSet|changedSet.*documents/)
  }
  const section = read('src', 'components', 'parties', 'PartyDocumentsSection.tsx')
  assert.match(section, /  hint\?: ReactNode\n/)
  assert.match(section, /\{hint && \(\n\s*<p className="[^"]*bg-\[var\(--info-soft\)\][^"]*text-\[var\(--info\)\]">/)
  const translations = read('src', 'i18n', 'translations.ts')
  assert.equal(translations.split("    partyDocSavedDirectly: '").length, 3)
  assert.match(translations, /partyDocSavedDirectly: 'المستندات تحفظ مباشرة عند الرفع، بدون زر الحفظ\.'/)
})

// --- Files picked in the add form (owner 2026-11-08) --------------------------
// «المورد ينحفظ, وبعده ترتفع الملفات مباشرة»

const draftOf = (id, type, extra = {}) => ({
  id,
  type,
  file: { name: `${id}.pdf`, type: 'application/pdf', size: 2048 },
  created_at: `2026-11-08T10:00:0${id.length}Z`,
  ...extra,
})

test('a picked file is drawn as a row; a fixed type keeps one file', () => {
  const row = lib.draftDocumentRow(draftOf('a', 'other', { title: 'عقد' }))
  assert.deepEqual(plain(row), {
    id: 'a',
    doc_type: 'other',
    title: 'عقد',
    storage_path: '',
    file_name: 'a.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    created_at: '2026-11-08T10:00:01Z',
  })
  let drafts = lib.withDraftDocument([], draftOf('r1', 'commercial_register'))
  drafts = lib.withDraftDocument(drafts, draftOf('t1', 'tax_certificate'))
  drafts = lib.withDraftDocument(drafts, draftOf('r2', 'commercial_register'))
  assert.deepEqual(plain(drafts.map((d) => d.id)), ['t1', 'r2'])
  drafts = lib.withDraftDocument(drafts, draftOf('o1', 'other', { title: 'x' }))
  drafts = lib.withDraftDocument(drafts, draftOf('o2', 'other', { title: 'y' }))
  assert.deepEqual(plain(drafts.map((d) => d.id)), ['t1', 'r2', 'o1', 'o2'])
  // Replacing an «other» document swaps that one only.
  drafts = lib.withDraftDocument(drafts, draftOf('o3', 'other', { title: 'z' }), 'o1')
  assert.deepEqual(plain(drafts.map((d) => d.id)), ['t1', 'r2', 'o2', 'o3'])
})

test('the picked files go up in the section order: fixed types, then the others', () => {
  const drafts = [
    draftOf('o', 'other', { title: 'x' }),
    draftOf('na', 'national_address'),
    draftOf('cr', 'commercial_register'),
    draftOf('ib', 'iban_certificate'),
  ]
  assert.deepEqual(
    plain(lib.draftUploadOrder('lessor', drafts).map((d) => d.id)),
    ['cr', 'ib', 'na', 'o'],
  )
})

test('the details of a new record say what became of its files', () => {
  const t = (key) => key
  assert.deepEqual(plain(lib.createdDocumentsNotice(undefined, t)), { notice: 'partyDocCreatedNotice' })
  assert.deepEqual(plain(lib.createdDocumentsNotice({ uploaded: 0, failed: [] }, t)), {
    notice: 'partyDocCreatedNotice',
  })
  assert.deepEqual(plain(lib.createdDocumentsNotice({ uploaded: 2, failed: [] }, t)), {
    notice: 'partyDocCreatedUploadedNotice',
  })
  const ar = (key) =>
    key === 'partyDocUploadFailedNotice' ? 'تعذر رفع {count}: {names}' : key
  assert.deepEqual(plain(lib.createdDocumentsNotice({ uploaded: 1, failed: ['السجل', 'عقد'] }, ar)), {
    warning: 'تعذر رفع 2: السجل، عقد',
  })
  assert.equal(lib.partyDocumentLabel('other', '  ', t), 'partyDocOtherOne')
  assert.equal(lib.partyDocumentLabel('other', 'عقد', t), 'عقد')
})

test('the add forms pick files and upload them right after the save', () => {
  const data = read('src', 'lib', 'partyDocumentsData.ts')
  // One by one through the usual upload; a failure is reported, never thrown.
  assert.match(
    data,
    /export async function uploadDraftDocuments\([\s\S]*?for \(const \[index, draft\] of ordered\.entries\(\)\) \{\n\s*try \{\n\s*await uploadPartyDocument\(\{[\s\S]*?\} catch \{\n\s*failed\.push\(draft\)/,
  )
  for (const [file, kind, record] of [
    [['src', 'screens', 'lessors', 'LessorFormDialog.tsx'], 'lessor', 'lessor'],
    [['src', 'screens', 'companies', 'CompanyFormDialog.tsx'], 'company', 'company'],
  ]) {
    const form = read(...file)
    // The section in pick-only mode, for a new record with the edit key.
    assert.match(
      form,
      new RegExp(
        `\\{!${record} && canSave && \\(\\n\\s*<PartyDocumentsSection\\n\\s*key="new"\\n\\s*kind="${kind}"\\n\\s*draft=\\{\\{ items: drafts, onChange: setDrafts \\}\\}`,
      ),
    )
    // The record is inserted first; the files go up only after it is saved.
    const save = form.slice(form.indexOf('const save = async'), form.indexOf('const shownError'))
    assert.ok(save.indexOf(".insert(payload)") < save.indexOf('uploadDraftDocuments('))
    assert.match(save, new RegExp(`uploadDraftDocuments\\('${kind}', createdId, drafts`))
    assert.ok(save.indexOf('uploadDraftDocuments(') < save.indexOf('onOpenChange(false)'))
    // No closing while saving; picked files ask before they are dropped.
    assert.match(form, /if \(saving \|\| uploading\) return/)
    assert.match(form, new RegExp(`\\(dirty \\|\\| \\(!${record} && drafts\\.length > 0\\)\\) &&`))
    assert.match(form, /t\('partyDocUploadingProgress'\)/)
  }
  const section = read('src', 'components', 'parties', 'PartyDocumentsSection.tsx')
  // Nothing is stored in pick-only mode: no load, no upload, no delete.
  assert.match(section, /\/\/ The add form has nothing stored yet\.\n\s*if \(!partyId\) return/)
  assert.match(section, /if \(onPick\) \{\n\s*onPick\(target\.type, file, other \? trimmed : undefined, target\.replacing\)\n\s*return\n\s*\}/)
  assert.match(section, /if \(draft\) \{\n\s*draft\.onChange\(draft\.items\.filter/)
  // A picked file opens from the browser and its object URL is released.
  assert.match(section, /URL\.createObjectURL\(picked\.file as File\)/)
  assert.match(section, /URL\.revokeObjectURL\(objectUrlRef\.current\)/)
  assert.match(section, /\{t\('partyDocPending'\)\}/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'partyDocDraftHint',
    'partyDocPending',
    'partyDocPickConfirm',
    'partyDocUploadingProgress',
    'partyDocCreatedUploadedNotice',
    'partyDocUploadFailedNotice',
  ])
    assert.equal(translations.split(`    ${key}: '`).length, 3, key)
  const arabic = translations.slice(0, translations.indexOf('partyDocSavedDirectly: \'Documents'))
  const added = arabic.slice(arabic.indexOf('    partyDocDraftHint:'), arabic.indexOf('    partyDocUploadFailedNotice:') + 120)
  assert.doesNotMatch(added, /[أإآ]/)
})
