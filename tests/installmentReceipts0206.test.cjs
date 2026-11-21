const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «ملف الحوالة» (migration 0206, owner 2026-11-19): the transfer receipt of
// an installment payment — a private bucket, one file per payment, attached
// after the payment is saved, opened through a signed URL — and the polish of
// the installments lists onto the unified list system.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

const SQL = read(
  'supabase',
  'migrations',
  '20261119140000_0206_installment_payment_receipts.sql',
)
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
const SQL_CODE = code(SQL)

function loadLib(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    out,
    {
      exports,
      Math,
      Number,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLib(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const fnBody = (name) => {
  const match = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`,
  ).exec(SQL_CODE)
  assert.ok(match, name)
  return match[1]
}

test('0206: a private bucket of 5 MB for PDF and images', () => {
  assert.match(
    SQL_CODE,
    /INSERT INTO storage\.buckets[\s\S]*?'installment-receipts',\s*'installment-receipts',\s*false,\s*5242880,\s*ARRAY\['application\/pdf', 'image\/jpeg', 'image\/png', 'image\/webp'\]/,
  )
  assert.match(SQL_CODE, /ON CONFLICT \(id\) DO UPDATE\s*SET public = false/)
})

test('0206: one receipt per payment, read by installments.view, no write policy', () => {
  assert.match(SQL_CODE, /CREATE TABLE public\.installment_payment_receipts \(/)
  assert.match(SQL_CODE, /UNIQUE \(payment_id\)/)
  assert.match(SQL_CODE, /UNIQUE \(storage_path\)/)
  assert.match(SQL_CODE, /CHECK \(size_bytes BETWEEN 1 AND 5242880\)/)
  assert.match(SQL_CODE, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(SQL_CODE, /installment_payment_receipts_updated_at[\s\S]*?update_updated_at\(\)/)
  assert.match(SQL_CODE, /ALTER TABLE public\.installment_payment_receipts ENABLE ROW LEVEL SECURITY/)
  assert.match(
    SQL_CODE,
    /CREATE POLICY select_installment_payment_receipts[\s\S]*?FOR SELECT TO authenticated[\s\S]*?has_permission\('installments\.view'\)/,
  )
  assert.doesNotMatch(
    SQL_CODE,
    /CREATE POLICY \w+\s+ON public\.installment_payment_receipts\s+FOR (INSERT|UPDATE|DELETE|ALL)/,
  )
  assert.match(
    SQL_CODE,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.installment_payment_receipts\s+FROM authenticated/,
  )
})

test('0206: the writers check the key, a posted payment, its folder and the stored file', () => {
  const set = fnBody('set_installment_payment_receipt')
  assert.match(set, /PERFORM public\.assert_installments_manage\(\)/)
  assert.match(set, /FOR UPDATE/)
  assert.match(set, /status <> 'posted'[\s\S]*?payment_already_voided/)
  assert.match(set, /split_part\(p_storage_path, '\/', 1\) <> v_payment\.contract_id::text/)
  assert.match(set, /split_part\(p_storage_path, '\/', 2\) <> v_payment\.id::text/)
  assert.match(set, /'invalid_receipt'/)
  assert.match(
    set,
    /FROM storage\.objects o\s*WHERE o\.bucket_id = 'installment-receipts' AND o\.name = p_storage_path[\s\S]*?receipt_file_missing/,
  )
  assert.match(set, /ON CONFLICT \(payment_id\) DO UPDATE/)
  assert.match(set, /RETURN v_old;/)
  const remove = fnBody('remove_installment_payment_receipt')
  assert.match(remove, /PERFORM public\.assert_installments_manage\(\)/)
  assert.match(remove, /payment_already_voided/)
  assert.match(remove, /receipt_not_found/)
  assert.match(remove, /RETURNING storage_path INTO v_path/)
  for (const name of [
    'set_installment_payment_receipt',
    'remove_installment_payment_receipt',
    'can_read_installment_receipt_object',
    'can_upload_installment_receipt_object',
    'can_delete_installment_receipt_object',
  ]) {
    const header = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$`,
    ).exec(SQL_CODE)
    assert.ok(header, name)
    assert.match(header[0], /SECURITY DEFINER/, name)
    assert.match(header[0], /SET search_path = public, pg_temp/, name)
    assert.match(
      SQL_CODE,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\)\\s+FROM PUBLIC, anon;`),
      name,
    )
    assert.match(
      SQL_CODE,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO authenticated;`),
      name,
    )
  }
})

test('0206: the storage policies of this bucket only, through the helpers', () => {
  for (const [kind, helper] of [
    ['SELECT', 'can_read_installment_receipt_object'],
    ['INSERT', 'can_upload_installment_receipt_object'],
    ['DELETE', 'can_delete_installment_receipt_object'],
  ])
    assert.match(
      SQL_CODE,
      new RegExp(
        `ON storage\\.objects\\s+FOR ${kind} TO authenticated\\s+(USING|WITH CHECK) \\(\\s*bucket_id = 'installment-receipts'\\s+AND public\\.${helper}\\(name\\)`,
      ),
      kind,
    )
  assert.doesNotMatch(SQL_CODE, /FOR UPDATE TO authenticated/)
  assert.match(fnBody('can_read_installment_receipt_object'), /has_permission\('installments\.view'\)/)
  const upload = fnBody('can_upload_installment_receipt_object')
  assert.match(upload, /has_permission\('installments\.manage'\)/)
  assert.match(upload, /p\.contract_id = v_contract AND p\.status = 'posted'/)
  const del = fnBody('can_delete_installment_receipt_object')
  assert.match(del, /has_permission\('installments\.manage'\)/)
  assert.match(del, /NOT EXISTS[\s\S]*?installment_payment_receipts r WHERE r\.storage_path = p_name/)
})

test('0206: the payments list keeps its columns and appends the receipt', () => {
  const view = /CREATE OR REPLACE VIEW public\.installment_payment_list\s+WITH \(security_invoker = true\) AS([\s\S]*?);/.exec(SQL_CODE)
  assert.ok(view)
  const body = view[1]
  const order = [
    'p.id',
    'p.contract_id',
    'p.paid_on',
    'p.amount',
    'p.method',
    'p.reference',
    'p.note',
    'p.status',
    'p.voided_at',
    'p.voided_by',
    'voided_by_name',
    'p.void_reason',
    'p.created_by',
    'created_by_name',
    'p.created_at',
    'receipt_id',
    'receipt_path',
    'receipt_file_name',
    'receipt_mime_type',
    'receipt_size_bytes',
  ]
  let at = -1
  for (const column of order) {
    const next = body.indexOf(column, at + 1)
    assert.ok(next > at, column)
    at = next
  }
  assert.match(body, /LEFT JOIN public\.installment_payment_receipts r ON r\.payment_id = p\.id/)
  // Nothing of the reminder or the payment functions is touched.
  assert.doesNotMatch(
    SQL_CODE,
    /record_installment_payment|void_installment_payment|installment_reminder/,
  )
})

test('the receipt rules: the type, the size, the path and a safe message', () => {
  const lib = loadLib('installmentReceipts')
  assert.equal(lib.INSTALLMENT_RECEIPTS_BUCKET, 'installment-receipts')
  assert.equal(lib.INSTALLMENT_RECEIPT_MAX_BYTES, 5 * 1024 * 1024)
  assert.equal(lib.receiptFileError({ type: 'application/pdf', size: 10 }), null)
  assert.equal(lib.receiptFileError({ type: 'image/gif', size: 10 }), 'instReceiptTypeInvalid')
  assert.equal(lib.receiptFileError({ type: 'image/png', size: 0 }), 'instReceiptEmpty')
  assert.equal(
    lib.receiptFileError({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }),
    'instReceiptTooLarge',
  )
  assert.equal(lib.receiptPath('c1', 'p1', 'image/jpeg', 'f1'), 'c1/p1/f1.jpg')
  assert.equal(lib.receiptPath('c1', 'p1', 'application/pdf', 'f1'), 'c1/p1/f1.pdf')
  assert.equal(lib.receiptFileName('  '), 'receipt')
  assert.equal(lib.receiptFileName('x'.repeat(300)).length, 255)
  assert.equal(lib.receiptOf({ receipt_id: null }), null)
  const receipt = lib.receiptOf({
    receipt_id: 'r1',
    receipt_path: 'c1/p1/f1.png',
    receipt_file_name: 'حوالة.png',
    receipt_mime_type: 'image/png',
    receipt_size_bytes: 2048,
  })
  assert.equal(receipt.fileName, 'حوالة.png')
  assert.equal(lib.isImageReceipt(receipt), true)
  assert.equal(lib.receiptErrorKey({ message: 'payment_already_voided' }), 'instReceiptVoided')
  assert.equal(lib.receiptErrorKey({ message: 'receipt_not_found' }), 'instReceiptNotFound')
  assert.equal(
    lib.receiptErrorKey({ code: '42501', message: 'installments_manage_required' }),
    'instReceiptNotAllowed',
  )
  assert.equal(lib.receiptErrorKey({ message: 'boom' }), 'instReceiptSaveFailed')
})

test('the order: upload, attach (removing the file on refusal), remove the replaced file', () => {
  const data = code(read('src', 'lib', 'installmentReceiptsData.ts'))
  const upload = data.indexOf('.upload(path, file')
  const attach = data.indexOf("rpc('set_installment_payment_receipt'")
  assert.ok(upload > 0 && attach > upload)
  assert.match(data, /upsert: false/)
  assert.match(data, /if \(error\) \{\s*await removeObject\(path\)/)
  assert.match(data, /await removeObject\(typeof data === 'string' \? data : null\)/)
  assert.match(data, /rpc\('remove_installment_payment_receipt'/)
  assert.match(data, /createSignedUrl\(receipt\.path, 300\)/)
  assert.doesNotMatch(data, /getPublicUrl/)
  // Never written directly: the table has no write policy.
  assert.doesNotMatch(data, /from\('installment_payment_receipts'\)/)
})

test('the payment dialog uploads the receipt only after the payment is saved', () => {
  const dialog = code(
    read('src', 'components', 'installments', 'InstallmentPaymentDialog.tsx'),
  )
  assert.match(dialog, /<ReceiptPicker/)
  const record = dialog.indexOf('await recordInstallmentPayment(')
  const attach = dialog.indexOf('await attachInstallmentReceipt(')
  assert.ok(record > 0 && attach > record)
  assert.match(dialog, /onSaved\(\{ receiptError: failed \}\)/)
  for (const screen of ['InstallmentContractDetail.tsx', 'InstallmentsScreen.tsx']) {
    const source = read('src', 'screens', 'installments', screen)
    assert.match(source, /onSaved=\{paymentSaved\}/, screen)
    assert.match(source, /instToastPaymentRecordedNoReceipt/, screen)
    assert.match(source, /tone: 'warning'/, screen)
  }
  const detail = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  assert.match(detail, /<PaymentReceiptLine/)
  assert.match(detail, /canManage=\{canManageReceipt && !voided\}/)
  const line = read('src', 'components', 'installments', 'InstallmentReceipt.tsx')
  assert.match(line, /<Lightbox/)
  assert.match(line, /useConfirm\(\)/)
  assert.match(line, /window\.open\('', '_blank'\)/)
})

test('the lists: the shared toolbar, the page sizes and the main table look', () => {
  for (const file of ['InstallmentsContractsTab.tsx', 'InstallmentsDuesTab.tsx']) {
    const source = read('src', 'components', 'installments', file)
    assert.match(source, /<DataListToolbar/, file)
    assert.match(source, /onPageSize=\{list\.setPageSize\}/, file)
    assert.match(source, /cellTextClassName="text-\[13px\]"/, file)
    assert.match(source, /cellClassName="py-3"/, file)
    assert.match(source, /size="sm"/, file)
    assert.doesNotMatch(source, /<Select\b|<SearchInput\b|<Checkbox\b/, file)
  }
  for (const file of ['InstallmentsDashboardTab.tsx', 'InstallmentsFinanciersTab.tsx'])
    assert.match(
      read('src', 'components', 'installments', file),
      /cellTextClassName="text-\[13px\]"/,
      file,
    )
  const contracts = read('src', 'components', 'installments', 'InstallmentsContractsTab.tsx')
  // «اخر تعديل» is the last column.
  const keys = [...contracts.matchAll(/key: '([a-z_]+)',\n\s+header/g)].map((m) => m[1])
  assert.equal(keys.at(-1), 'updated_at')
  const configs = read('src', 'lib', 'listConfigs.ts')
  assert.match(configs, /export const installmentContractsListConfig: DataListConfig/)
  assert.match(configs, /export const installmentDuesListConfig: DataListConfig/)
  assert.match(configs, /defaultSort: 'updated_at',\s*defaultDirection: 'desc'/)
})

test('the receipt copy exists in both languages, without hamza in Arabic', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...source.matchAll(
      /\/\/ installment-receipts \(0206\)\n([\s\S]*?)\/\/ end installment-receipts \(0206\)/g,
    ),
  ].map((match) => match[1])
  assert.equal(blocks.length, 2)
  const keysOf = (block) => [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keysOf(blocks[0]), keysOf(blocks[1]))
  assert.doesNotMatch(blocks[0], /[أإآ]/)
})
