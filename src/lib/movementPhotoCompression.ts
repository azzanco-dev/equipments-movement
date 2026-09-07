const MAX_TOTAL_PHOTO_BYTES = 4 * 1024 * 1024
const TARGET_TOTAL_PHOTO_BYTES = Math.floor(3.7 * 1024 * 1024)
const MAX_IMAGE_DIMENSION = 2560
const MIN_IMAGE_DIMENSION = 320
const INITIAL_JPEG_QUALITY = 0.86
const MIN_JPEG_QUALITY = 0.5

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('photo_decode_failed'))
    }
    image.src = objectUrl
  })
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('photo_compression_failed')),
      'image/jpeg',
      quality,
    )
  })
}

function compressedFileName(name: string) {
  const baseName = name.replace(/\.[^.]+$/, '') || 'photo'
  return `${baseName}.jpg`
}

async function compressPhoto(file: File, targetBytes: number): Promise<File> {
  const image = await loadImage(file)
  const originalMaxDimension = Math.max(image.naturalWidth, image.naturalHeight)
  let maxDimension = Math.min(originalMaxDimension, MAX_IMAGE_DIMENSION)
  let quality = INITIAL_JPEG_QUALITY

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const scale = Math.min(1, maxDimension / originalMaxDimension)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('photo_compression_failed')

    // JPEG has no transparency; use white instead of producing black areas.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const blob = await canvasToJpeg(canvas, quality)
    if (blob.size <= targetBytes) {
      return new File([blob], compressedFileName(file.name), {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      })
    }

    if (quality > MIN_JPEG_QUALITY) {
      quality = Math.max(MIN_JPEG_QUALITY, quality - 0.08)
    } else {
      const sizeRatio = Math.sqrt(targetBytes / blob.size) * 0.95
      maxDimension = Math.max(
        MIN_IMAGE_DIMENSION,
        Math.floor(maxDimension * Math.min(0.85, sizeRatio)),
      )
    }
  }

  throw new Error('photo_compression_failed')
}

export async function prepareMovementPhotos(files: File[]): Promise<File[]> {
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  if (totalBytes <= MAX_TOTAL_PHOTO_BYTES) return files

  const targetBytesPerPhoto = Math.floor(
    TARGET_TOTAL_PHOTO_BYTES / files.length,
  )
  const compressed: File[] = []

  // Process sequentially to avoid holding several decoded camera images in
  // memory at once on lower-end mobile devices.
  for (const file of files) {
    compressed.push(await compressPhoto(file, targetBytesPerPhoto))
  }

  return compressed
}
