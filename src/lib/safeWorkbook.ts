// The one place the app reads a workbook (tests/safeWorkbook.test.cjs pins
// that every other `read` of the xlsx libraries under src/ and app/ is gone).
//
// Why: xlsx 0.18.5 (the last SheetJS community build on npm; no fixed npm
// release exists) attaches cell comments by their `ref` string. In
// `sheet_insert_comments` (node_modules/xlsx/xlsx.mjs, lines 11734-11766)
// a SPARSE sheet is a plain object and the lookup is
// `cell = sheet[comment.ref]`, followed by `if (!cell.c) cell.c = []`. A
// comment whose ref is "__proto__" resolves to Object.prototype, so the
// write puts `c` on Object.prototype in the browser tab of whoever imports
// the file (prototype pollution); xlsx-js-style, the export library, would
// then carry that comment on every cell it writes afterwards.
//
// Verified in that source: the function switches on `Array.isArray(sheet)`.
// A DENSE sheet (option `dense: true`; `parse_ws_xml` line 14617 builds
// `opts.dense ? [] : {}`) is indexed as `sheet[r.r][r.c]` after
// `decode_cell(comment.ref)` (lines 4180-4188), which only reads digits and
// capital letters and returns {c: -1, r: -1} for "__proto__", "constructor"
// or any other lowercase name. The string ref is never used as a key on a
// dense sheet: the write lands on `sheet[-1][-1]`, a fresh `{t: 'z'}` cell,
// and Object.prototype is never reached. Dense mode alone blocks the write
// (tests/safeWorkbook.test.cjs proves it against the real library), and
// `sheet_to_json` (line 24180, `Array.isArray(sheet)`) reads both shapes the
// same, which is all the importers do with a sheet. That stray cell also
// widens `!ref` to column -1, on which `sheet_to_json` throws "invalid
// column -1"; the helper looks for such a cell after the read and refuses
// the file as unsafe instead, since Excel never writes a comment whose ref
// is not a cell address.
//
// Independently of that, the helper snapshots the own keys of
// Object.prototype and Array.prototype before the read and compares after
// it: any key the read added, by this path or any other, is deleted and the
// import stops with `UnsafeWorkbookError`, which the importers show as the
// `unsafeWorkbookFile` message.
//
// The helper takes the xlsx module from the caller instead of importing it,
// so the lib modules keep their static import and AdminSettings keeps its
// lazy `import('xlsx')` (bundle size); only types are imported here.
import type * as XLSX from 'xlsx'
import type { TranslationKey } from '@/i18n/translations'

/** The part of the xlsx module the helper needs (`import * as XLSX`). */
export type WorkbookReader = Pick<typeof XLSX, 'read'>

/** Thrown when a read polluted a guarded prototype or placed a comment outside the grid. */
export class UnsafeWorkbookError extends Error {
  /** What was found, as `Object.prototype.c` (already removed) or `Sheet1[-1]`. */
  readonly findings: readonly string[]

  constructor(findings: readonly string[]) {
    super('unsafe_workbook')
    this.name = 'UnsafeWorkbookError'
    this.findings = findings
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isUnsafeWorkbookError(
  error: unknown,
): error is UnsafeWorkbookError {
  return (
    error instanceof UnsafeWorkbookError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'UnsafeWorkbookError')
  )
}

/** The message key an importer shows for a failed read. */
export function workbookReadErrorKey(
  error: unknown,
  fallback: TranslationKey,
): TranslationKey {
  return isUnsafeWorkbookError(error) ? 'unsafeWorkbookFile' : fallback
}

const GUARDED_PROTOTYPES: ReadonlyArray<readonly [string, object]> = [
  ['Object.prototype', Object.prototype],
  ['Array.prototype', Array.prototype],
]

function snapshotOwnKeys(): Set<PropertyKey>[] {
  return GUARDED_PROTOTYPES.map(
    ([, target]) => new Set(Reflect.ownKeys(target)),
  )
}

/** Removes every own key added since `before`; returns their names. */
function removeAddedKeys(before: Set<PropertyKey>[]): string[] {
  const added: string[] = []
  GUARDED_PROTOTYPES.forEach(([label, target], index) => {
    for (const key of Reflect.ownKeys(target)) {
      if (before[index].has(key)) continue
      added.push(`${label}.${String(key)}`)
      Reflect.deleteProperty(target, key)
    }
  })
  return added
}

const hasOwn = (target: object, key: string) =>
  Object.prototype.hasOwnProperty.call(target, key)

/**
 * A dense sheet gets a row or column -1 only from a comment whose ref names
 * no row or column (`decode_cell` of "__proto__" or any such string).
 */
function hasStrayComment(sheet: unknown): boolean {
  if (!Array.isArray(sheet)) return false
  if (hasOwn(sheet, '-1')) return true
  return sheet.some((row) => Array.isArray(row) && hasOwn(row, '-1'))
}

/**
 * Reads a workbook with the caller's options plus `dense: true` (never
 * negotiable, see above) and refuses the file if the read touched a guarded
 * prototype or placed a comment outside the grid. `type` defaults to
 * `'array'`.
 */
export function readWorkbookSafely(
  xlsx: WorkbookReader,
  data: ArrayBuffer | Uint8Array,
  opts: XLSX.ParsingOptions = {},
): XLSX.WorkBook {
  const before = snapshotOwnKeys()
  let workbook: XLSX.WorkBook | undefined
  let failure: unknown
  let failed = false
  try {
    workbook = xlsx.read(data, { type: 'array', ...opts, dense: true })
  } catch (error) {
    failed = true
    failure = error
  }
  const findings = removeAddedKeys(before)
  if (findings.length) throw new UnsafeWorkbookError(findings)
  if (failed || workbook === undefined) throw failure
  for (const name of workbook.SheetNames)
    if (hasStrayComment(workbook.Sheets[name]))
      throw new UnsafeWorkbookError([`${name}[-1]`])
  return workbook
}
