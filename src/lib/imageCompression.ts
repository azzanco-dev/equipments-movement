// Standalone client-side image compression used by the /ui-kit compression
// lab so the product owner can compare quality/size settings before one is
// approved for the movement photo pipeline.
//
// This module has no imports on purpose: it stays a pure, testable unit and it
// must never reach Supabase, storage, or any upload path. The existing
// production pipeline (`prepareMovementPhotos`) is untouched.

// The limits mirror the movement photo limits in
// `src/components/useMovementPhotoStaging.ts`. They are restated here (rather
// than imported) because that module pulls in React and Supabase, which would
// make this one neither pure nor testable; keep the two in sync.

/** Largest accepted source image, matching the movement photo limit. */
export const MAX_MOVEMENT_PHOTO_BYTES = 10 * 1024 * 1024

/** Accepted source image types, matching the movement photo limit. */
export const ALLOWED_MOVEMENT_PHOTO_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

export type CompressImageMimeType = 'image/jpeg' | 'image/webp'

/**
 * The upload setting the owner approved on 2026-09-19 after comparing the
 * presets in the /ui-kit compression lab ("عالي"): longest side 2048 px,
 * JPEG quality 0.85. `prepareMovementPhotos` applies it to every photo.
 */
export const APPROVED_PHOTO_COMPRESSION = {
  maxDimension: 2048,
  quality: 0.85,
} as const

export type CompressImageErrorCode =
  | 'image_type_not_supported'
  | 'image_too_large'
  | 'image_decode_failed'
  | 'image_compression_failed'

export class CompressImageError extends Error {
  readonly code: CompressImageErrorCode
  constructor(code: CompressImageErrorCode) {
    super(code)
    this.name = 'CompressImageError'
    this.code = code
  }
}

export interface CompressImageOptions {
  /** Longest side of the output, in pixels. The image is never upscaled. */
  maxDimension: number
  /** Encoder quality, 0–1. Ignored when the output stays PNG. */
  quality: number
  /** Forces the output encoder; otherwise JPEG (or PNG, see `keepPng`). */
  mimeType?: CompressImageMimeType
  /**
   * Keeps a PNG source as PNG so transparency survives. Off by default: a
   * PNG photo is converted to JPEG over a white background.
   */
  keepPng?: boolean
}

export interface CompressImageResult {
  blob: Blob
  width: number
  height: number
  durationMs: number
  originalWidth: number
  originalHeight: number
  originalBytes: number
  outputType: string
  /** True when the encoded result was larger, so the original was kept. */
  usedOriginal: boolean
}

export interface ScaledDimensions {
  width: number
  height: number
  scale: number
}

/**
 * Scales so the longer side is at most `maxDimension`, never upscaling and
 * never producing a zero-pixel side.
 */
export function scaleToMaxDimension(
  width: number,
  height: number,
  maxDimension: number,
): ScaledDimensions {
  const longestSide = Math.max(width, height)
  if (
    !Number.isFinite(longestSide) ||
    longestSide <= 0 ||
    !Number.isFinite(maxDimension) ||
    maxDimension <= 0
  ) {
    return { width: 0, height: 0, scale: 1 }
  }
  // Only ever shrink: a 900 px photo asked for 1600 px stays 900 px.
  const scale = Math.min(1, maxDimension / longestSide)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

/** Human file size with Latin digits, for example `1.4 MB` or `820 KB`. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KB'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) {
    return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`
  }
  return `${(kilobytes / 1024).toFixed(2)} MB`
}

/**
 * Percentage of bytes saved, one decimal. Negative when the encoded result
 * would have been larger than the source.
 */
export function savedPercent(originalBytes: number, resultBytes: number) {
  if (!Number.isFinite(originalBytes) || originalBytes <= 0) return 0
  const saved = ((originalBytes - resultBytes) / originalBytes) * 100
  return Math.round(saved * 10) / 10
}

/** Extension for the encoded output, used for the suggested file name. */
export function outputExtension(mimeType: string) {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

export function compressedFileName(name: string, mimeType: string) {
  const baseName = name.replace(/\.[^.]+$/, '') || 'photo'
  return `${baseName}.${outputExtension(mimeType)}`
}

export function assertSupportedImage(file: File) {
  if (!ALLOWED_MOVEMENT_PHOTO_TYPES.includes(file.type)) {
    throw new CompressImageError('image_type_not_supported')
  }
  if (file.size > MAX_MOVEMENT_PHOTO_BYTES) {
    throw new CompressImageError('image_too_large')
  }
}

export function resolveOutputType(
  file: File,
  options: Pick<CompressImageOptions, 'mimeType' | 'keepPng'>,
): string {
  if (options.mimeType) return options.mimeType
  if (options.keepPng && file.type === 'image/png') return 'image/png'
  return 'image/jpeg'
}

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

async function decodeWithImageElement(file: File): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () =>
        reject(new CompressImageError('image_decode_failed'))
      element.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

// `createImageBitmap` applies the EXIF orientation, so a portrait phone photo
// is not drawn sideways. Older browsers fall back to an <img> element, which
// browsers already auto-orient for image sources.
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Fall through to the <img> path rather than failing the whole run.
    }
  }
  return decodeWithImageElement(file)
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new CompressImageError('image_compression_failed')),
      mimeType,
      quality,
    )
  })
}

/**
 * Decodes, scales, and re-encodes one image entirely in the browser. Nothing
 * is uploaded and no network call is made.
 */
export async function compressImage(
  file: File,
  options: CompressImageOptions,
): Promise<CompressImageResult> {
  assertSupportedImage(file)
  const startedAt =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const outputType = resolveOutputType(file, options)
  const decoded = await decodeImage(file)

  try {
    const { width, height } = scaleToMaxDimension(
      decoded.width,
      decoded.height,
      options.maxDimension,
    )
    if (!width || !height) {
      throw new CompressImageError('image_decode_failed')
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new CompressImageError('image_compression_failed')

    if (outputType !== 'image/png') {
      // JPEG has no alpha channel: paint white so transparent areas do not
      // come out black.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(decoded.source, 0, 0, width, height)

    const blob = await canvasToBlob(canvas, outputType, options.quality)
    const durationMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
      startedAt

    // A small or already-optimized photo can grow when re-encoded; keeping the
    // original is then strictly better.
    if (blob.size >= file.size) {
      return {
        blob: file,
        width: decoded.width,
        height: decoded.height,
        durationMs,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
        originalBytes: file.size,
        outputType: file.type,
        usedOriginal: true,
      }
    }

    return {
      blob,
      width,
      height,
      durationMs,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      originalBytes: file.size,
      outputType,
      usedOriginal: false,
    }
  } finally {
    decoded.release()
  }
}
