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
const {
  LEGACY_PHOTO_ID,
  MOVEMENT_DETAIL_GALLERY_WIDTH_CLASS,
  canRemoveSavedPhoto,
  detailPhotosToGalleryItems,
  galleryPhotoProgress,
  galleryPhotoStatus,
  stagedPhotosToGalleryItems,
} = loadLibModule('movementPhotoGallery')

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

// --- Movement detail page gallery -----------------------------------------

const readSource = (file) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

const SAVED = [
  { id: 'a', url: 'https://signed/a', uploaded_by: 'user-1' },
  { id: 'b', url: 'https://signed/b', uploaded_by: 'user-2' },
]
// Copied into an array of this realm: the module runs in a `vm` context, and
// `deepEqual` compares prototypes.
const detailItems = (overrides) =>
  Array.from(
    detailPhotosToGalleryItems({
      saved: SAVED,
      legacyUrl: null,
      pending: [],
      viewer: { userId: 'user-1', role: 'supervisor' },
      busy: false,
      alt: 'Photo',
      ...overrides,
    }),
  )

test('only the uploader or an admin may remove a saved photo, never monitor', () => {
  const photo = { uploaded_by: 'user-1' }
  assert.equal(
    canRemoveSavedPhoto(photo, { userId: 'user-1', role: 'supervisor' }),
    true,
  )
  assert.equal(
    canRemoveSavedPhoto(photo, { userId: 'user-2', role: 'workshop_manager' }),
    false,
  )
  assert.equal(
    canRemoveSavedPhoto(photo, { userId: 'user-2', role: 'admin' }),
    true,
  )
  assert.equal(
    canRemoveSavedPhoto(photo, { userId: 'user-1', role: 'monitor' }),
    false,
  )
  assert.equal(
    canRemoveSavedPhoto(photo, { userId: undefined, role: undefined }),
    false,
  )
})

test('detail gallery items: saved photos keep order and a per-photo remove switch', () => {
  assert.deepEqual(
    detailItems().map((item) => [
      item.id,
      item.src,
      item.alt,
      item.status,
      item.removable,
    ]),
    [
      ['a', 'https://signed/a', 'Photo 1', 'ready', true],
      ['b', 'https://signed/b', 'Photo 2', 'ready', false],
    ],
  )
  // No photo can be removed while a photo request is running.
  assert.deepEqual(
    detailItems({ busy: true }).map((item) => item.removable),
    [false, false],
  )
  assert.deepEqual(
    detailItems({ viewer: { userId: 'x', role: 'admin' } }).map(
      (item) => item.removable,
    ),
    [true, true],
  )
})

test('detail gallery items: the legacy photo_url photo is a non-removable fallback', () => {
  assert.equal(detailItems({ saved: [] }).length, 0)
  const legacy = detailItems({
    saved: [],
    legacyUrl: 'https://signed/legacy',
    viewer: { userId: 'x', role: 'admin' },
  })
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].id, LEGACY_PHOTO_ID)
  assert.equal(legacy[0].src, 'https://signed/legacy')
  assert.equal(legacy[0].status, 'ready')
  assert.equal(legacy[0].removable, false)
  // Photo rows win over the legacy photo, as before.
  assert.deepEqual(
    detailItems({ legacyUrl: 'https://signed/legacy' }).map((item) => item.id),
    ['a', 'b'],
  )
})

test('detail gallery items: files being uploaded follow the saved photos', () => {
  const pending = [
    {
      id: 'pending-0',
      name: 'new.jpg',
      previewUrl: 'blob:new',
      status: 'preparing',
      progress: 0,
    },
  ]
  const items = detailItems({ saved: [SAVED[0]], pending })
  assert.deepEqual(
    items.map((item) => [item.id, item.src, item.status, item.progress]),
    [
      ['a', 'https://signed/a', 'ready', undefined],
      ['pending-0', 'blob:new', 'uploading', undefined],
    ],
  )
  // With no photo rows yet the previews replace the legacy fallback, so the
  // row never holds more than three squares.
  assert.deepEqual(
    detailItems({ saved: [], legacyUrl: 'https://signed/legacy', pending }).map(
      (item) => item.id,
    ),
    ['pending-0'],
  )
})

test('PhotoGallery hides the remove button of a non-removable photo only', () => {
  const source = readSource('src/components/ui/PhotoGallery.tsx')
  assert.match(source, /removable\?: boolean/)
  assert.match(
    source,
    /onRemove && item\.removable !== false && item\.status !== 'uploading'/,
  )
})

test('the movement detail page shows its photos in the shared PhotoGallery', () => {
  const source = readSource('src/screens/MovementDetail.tsx')
  assert.equal(MOVEMENT_DETAIL_GALLERY_WIDTH_CLASS, 'w-full max-w-md')
  // The old carousel box and its palette-coloured overlay buttons are gone.
  for (const gone of [
    /photoCarouselIndex/,
    /bg-black/,
    /text-white/,
    /320px/,
    /Maximize2|ChevronLeft|ChevronRight|Trash2/,
    /t\('noPhoto'\)/,
  ])
    assert.doesNotMatch(source, gone)
  // Add square only for those who may add; per-photo delete with the
  // existing confirm flow; the main image opens the shared lightbox on the
  // same items and index.
  assert.match(
    source,
    /onAdd=\{\s+canAddPhotos \? \(\) => photoInputRef\.current\?\.click\(\) : undefined\s+\}/,
  )
  assert.match(source, /onRemove=\{\(id\) => void deletePhoto\(id\)\}/)
  assert.match(source, /readOnly=\{photosReadOnly\}/)
  assert.match(
    source,
    /onOpen=\{\(id\) => \{\s+selectPhoto\(id\)\s+setLightboxOpen\(true\)\s+\}\}/,
  )
  assert.match(
    source,
    /items=\{galleryItems\}\s+index=\{selectedPhotoIndex\}\s+onIndexChange=\{setPhotoIndex\}/,
  )
  // No retry path exists on this page, so none is offered.
  assert.doesNotMatch(source, /onRetry/)
  // The upload and delete paths are the existing ones.
  assert.match(source, /uploadMovementPhotosDirectly\(/)
  assert.match(source, /`\/api\/movements\/\$\{movementId\}\/photos`/)
  assert.match(source, /title: t\('confirmDeletePhoto'\)/)
})
