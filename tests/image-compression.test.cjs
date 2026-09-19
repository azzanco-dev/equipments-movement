const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads src/lib/imageCompression.ts (no imports of its own) and exercises only
// the pure parts: the target-size math, the size formatting, and the output
// type/name rules. The canvas/createImageBitmap half of compressImage needs a
// real browser and is NOT covered here; it is verified by hand on /ui-kit.
function loadImageCompression() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'imageCompression.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const {
  ALLOWED_MOVEMENT_PHOTO_TYPES,
  MAX_MOVEMENT_PHOTO_BYTES,
  assertSupportedImage,
  compressedFileName,
  formatByteSize,
  outputExtension,
  resolveOutputType,
  savedPercent,
  scaleToMaxDimension,
} = loadImageCompression()

test('a landscape photo is scaled so its longer side hits the target', () => {
  const scaled = scaleToMaxDimension(4000, 3000, 1600)
  assert.equal(scaled.width, 1600)
  assert.equal(scaled.height, 1200)
})

test('a portrait photo is scaled by its height, keeping the aspect ratio', () => {
  const scaled = scaleToMaxDimension(3000, 4000, 1600)
  assert.equal(scaled.width, 1200)
  assert.equal(scaled.height, 1600)
})

test('a photo smaller than the target is never upscaled', () => {
  const scaled = scaleToMaxDimension(900, 600, 1600)
  assert.equal(scaled.width, 900)
  assert.equal(scaled.height, 600)
  assert.equal(scaled.scale, 1)
})

test('an image exactly at the target keeps its dimensions', () => {
  const scaled = scaleToMaxDimension(1600, 1200, 1600)
  assert.equal(scaled.width, 1600)
  assert.equal(scaled.height, 1200)
})

test('dimensions are rounded and a very wide image keeps at least one pixel', () => {
  // 4001 x 2999 at 1280: 2999 * (1280/4001) = 959.43... -> 959
  const scaled = scaleToMaxDimension(4001, 2999, 1280)
  assert.equal(scaled.width, 1280)
  assert.equal(scaled.height, 959)
  assert.equal(Number.isInteger(scaled.height), true)

  // A 4000 x 3 banner must not collapse to a zero-pixel side.
  const banner = scaleToMaxDimension(4000, 3, 800)
  assert.equal(banner.width, 800)
  assert.equal(banner.height, 1)
})

test('invalid dimensions return an empty size instead of NaN', () => {
  assert.deepEqual(
    { ...scaleToMaxDimension(0, 0, 1600) },
    { width: 0, height: 0, scale: 1 },
  )
  assert.deepEqual(
    { ...scaleToMaxDimension(1000, 800, 0) },
    { width: 0, height: 0, scale: 1 },
  )
})

test('sizes are formatted with Latin digits in B, KB, and MB', () => {
  assert.equal(formatByteSize(0), '0 B')
  assert.equal(formatByteSize(900), '900 B')
  assert.equal(formatByteSize(1536), '1.5 KB')
  assert.equal(formatByteSize(820 * 1024), '820 KB')
  assert.equal(formatByteSize(1024 * 1024), '1.00 MB')
  assert.equal(formatByteSize(3.7 * 1024 * 1024), '3.70 MB')
  assert.equal(formatByteSize(-5), '0 KB')
})

test('saved percent is positive when smaller and negative when it grows', () => {
  assert.equal(savedPercent(1000, 250), 75)
  assert.equal(savedPercent(1000, 1000), 0)
  assert.equal(savedPercent(1000, 1200), -20)
  assert.equal(savedPercent(0, 100), 0)
  // One decimal only.
  assert.equal(savedPercent(3000, 1001), 66.6)
})

test('the output type defaults to JPEG and keeps PNG only when asked', () => {
  const png = { type: 'image/png', size: 100, name: 'a.png' }
  const jpeg = { type: 'image/jpeg', size: 100, name: 'a.jpg' }
  assert.equal(resolveOutputType(png, {}), 'image/jpeg')
  assert.equal(resolveOutputType(png, { keepPng: true }), 'image/png')
  assert.equal(resolveOutputType(jpeg, { keepPng: true }), 'image/jpeg')
  assert.equal(
    resolveOutputType(png, { mimeType: 'image/webp', keepPng: true }),
    'image/webp',
  )
})

test('the suggested file name follows the output type', () => {
  assert.equal(outputExtension('image/webp'), 'webp')
  assert.equal(outputExtension('image/png'), 'png')
  assert.equal(outputExtension('image/jpeg'), 'jpg')
  assert.equal(
    compressedFileName('IMG_0042.HEIC', 'image/jpeg'),
    'IMG_0042.jpg',
  )
  assert.equal(compressedFileName('photo.png', 'image/webp'), 'photo.webp')
  assert.equal(compressedFileName('', 'image/jpeg'), 'photo.jpg')
})

test('validation rejects unsupported types and oversized files', () => {
  assert.deepEqual(
    [...ALLOWED_MOVEMENT_PHOTO_TYPES],
    ['image/jpeg', 'image/png', 'image/webp'],
  )
  assert.equal(MAX_MOVEMENT_PHOTO_BYTES, 10 * 1024 * 1024)

  assert.throws(
    () => assertSupportedImage({ type: 'image/heic', size: 1000 }),
    (error) => error.message === 'image_type_not_supported',
  )
  assert.throws(
    () =>
      assertSupportedImage({
        type: 'image/jpeg',
        size: MAX_MOVEMENT_PHOTO_BYTES + 1,
      }),
    (error) => error.message === 'image_too_large',
  )
  // At the limit exactly, the file is accepted.
  assert.doesNotThrow(() =>
    assertSupportedImage({
      type: 'image/jpeg',
      size: MAX_MOVEMENT_PHOTO_BYTES,
    }),
  )
})
