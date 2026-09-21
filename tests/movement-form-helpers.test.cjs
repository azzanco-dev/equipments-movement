const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      require(request) {
        const match =
          /^@\/lib\/(.+)$/.exec(request) ?? /^\.\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const {
  actualMovementDate,
  movementDateKey,
  toLocalDateTimeInput,
  withCurrentLocalTime,
} = loadLibModule('movementFormTime')
const { movementSaveErrorKey } = loadLibModule('movementSaveErrors')
const { galleryPhotoProgress, galleryPhotoStatus, stagedPhotosToGalleryItems } =
  loadLibModule('movementPhotoGallery')

// The movement form picks the DAY and stamps the current local time on save.
test('the picked day keeps the current local time of day', () => {
  const now = new Date(2026, 8, 19, 14, 37, 12)
  assert.equal(toLocalDateTimeInput(now), '2026-09-19T14:37')
  assert.equal(withCurrentLocalTime('2026-09-15', now), '2026-09-15T14:37')
  assert.equal(movementDateKey('2026-09-15T14:37'), '2026-09-15')

  const saved = actualMovementDate('2026-09-15', now)
  assert.equal(saved.getFullYear(), 2026)
  assert.equal(saved.getMonth(), 8)
  assert.equal(saved.getDate(), 15)
  assert.equal(saved.getHours(), 14)
  assert.equal(saved.getMinutes(), 37)
})

test('an empty or malformed day stays invalid so the form rejects it', () => {
  const now = new Date(2026, 8, 19, 9, 5, 0)
  assert.ok(Number.isNaN(actualMovementDate('', now).getTime()))
  assert.ok(Number.isNaN(actualMovementDate('not-a-date', now).getTime()))
})

test('save error codes map to their own message, never to raw database text', () => {
  assert.equal(
    movementSaveErrorKey('no_prior_entry', false),
    'noPriorEntryAtSelectedTime',
  )
  assert.equal(
    movementSaveErrorKey('exit_not_entry_owner', false),
    'siteExitNotEntryOwner',
  )
  assert.equal(
    movementSaveErrorKey('photo_required', true),
    'workshopPhotoRequired',
  )
  assert.equal(movementSaveErrorKey('unauthorized', true), 'authError')
  // The sequence conflict message depends on the movement type.
  assert.equal(
    movementSaveErrorKey('invalid_sequence', true),
    'entrySequenceConflict',
  )
  assert.equal(
    movementSaveErrorKey('invalid_sequence', false),
    'exitSequenceConflict',
  )
  assert.equal(
    movementSaveErrorKey(
      'duplicate key value violates unique constraint',
      true,
    ),
    'movementSaveFailed',
  )
})

test('staged photo states map onto the three gallery states', () => {
  assert.equal(galleryPhotoStatus('preparing'), 'uploading')
  assert.equal(galleryPhotoStatus('uploading'), 'uploading')
  assert.equal(galleryPhotoStatus('uploaded'), 'ready')
  assert.equal(galleryPhotoStatus('error'), 'error')

  // A percentage is only meaningful while the file is actually transferring.
  assert.equal(
    galleryPhotoProgress({ status: 'preparing', progress: 0 }),
    undefined,
  )
  assert.equal(galleryPhotoProgress({ status: 'uploading', progress: 42 }), 42)
  assert.equal(
    galleryPhotoProgress({ status: 'uploaded', progress: 100 }),
    undefined,
  )
  assert.equal(
    galleryPhotoProgress({ status: 'error', progress: 0 }),
    undefined,
  )
})

test('gallery items keep the staged order, preview url and file name', () => {
  const items = stagedPhotosToGalleryItems([
    {
      id: 'photo-1',
      name: 'first.jpg',
      previewUrl: 'blob:first',
      status: 'uploaded',
      progress: 100,
    },
    {
      id: 'photo-2',
      name: 'second.jpg',
      previewUrl: 'blob:second',
      status: 'uploading',
      progress: 55,
    },
    {
      id: 'photo-3',
      name: 'third.jpg',
      previewUrl: 'blob:third',
      status: 'error',
      progress: 0,
    },
  ])
  assert.deepEqual(
    items.map((item) => [
      item.id,
      item.src,
      item.alt,
      item.status,
      item.progress,
    ]),
    [
      ['photo-1', 'blob:first', 'first.jpg', 'ready', undefined],
      ['photo-2', 'blob:second', 'second.jpg', 'uploading', 55],
      ['photo-3', 'blob:third', 'third.jpg', 'error', undefined],
    ],
  )
})
