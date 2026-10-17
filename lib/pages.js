/**
 * Page images: the overview a model reads for layout, plus the full-width bands
 * that carry the resolution handwriting needs.
 *
 * DSH normalizes any attachment above 4 MP (2048x2048 area) down to fit, so
 * attaching a whole 400 dpi page would throw the detail away. Cutting the page
 * into full-width bands keeps every band inside the cap, which is what makes the
 * small handwriting on a dense exam page readable at all.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bandCountFor, cropPng, decodePng } from './png.js'

export function sniffImageMediaType(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString('latin1', 0, 6))) return 'image/gif'
  return undefined
}

export function extensionForMediaType(mediaType) {
  switch (mediaType) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return '.bin'
  }
}

function pad(number, width = 4) {
  return String(number).padStart(width, '0')
}

/**
 * Save one page as durable attachments: a single overview plus the band slices.
 * Returns the page record stored in batch.json.
 */
export async function registerPageImages(ctx, options) {
  const { batchDir, pageNumber, rasterFile, overviewFile, maxPixels, relativeTo } = options
  const rasterBytes = await readFile(rasterFile)
  const decoded = decodePng(rasterBytes)

  const overviewBytes = overviewFile ? await readFile(overviewFile) : rasterBytes
  const overviewMedia = sniffImageMediaType(overviewBytes) ?? 'image/png'
  const overviewRef = await ctx.attachments.saveImage({
    data: overviewBytes,
    mediaType: overviewMedia,
    name: `page-${pad(pageNumber)}-overview${extensionForMediaType(overviewMedia)}`,
  })

  const bandTotal = bandCountFor(decoded.width, decoded.height, maxPixels)
  const bandDir = join(batchDir, 'bands')
  const bands = []
  if (bandTotal > 1) {
    await mkdir(bandDir, { recursive: true })
    const bandHeight = Math.floor(decoded.height / bandTotal)
    for (let index = 1; index <= bandTotal; index += 1) {
      const y = (index - 1) * bandHeight
      // The last band absorbs the remainder so the slices always cover the page.
      const height = index === bandTotal ? decoded.height - y : bandHeight
      if (height <= 0) break
      const crop = cropPng(rasterBytes, { x: 0, y, width: decoded.width, height })
      const file = join(bandDir, `page-${pad(pageNumber)}-band-${pad(index, 2)}.png`)
      await writeFile(file, crop.buffer)
      const ref = await ctx.attachments.saveImage({
        data: crop.buffer,
        mediaType: 'image/png',
        name: `page-${pad(pageNumber)}-band-${pad(index, 2)}.png`,
      })
      bands.push({
        index,
        y,
        height: crop.height,
        width: crop.width,
        bytes: crop.buffer.length,
        pixels: crop.width * crop.height,
        file: relativeTo ? relativeTo(file) : file,
        attachment: ref,
      })
    }
  }

  return {
    page: pageNumber,
    width: decoded.width,
    height: decoded.height,
    mediaType: 'image/png',
    overview: {
      width: overviewRef.width,
      height: overviewRef.height,
      bytes: overviewBytes.length,
      file: overviewFile && relativeTo ? relativeTo(overviewFile) : (relativeTo ? relativeTo(rasterFile) : rasterFile),
      attachment: overviewRef,
    },
    bands,
  }
}

/** Total images a page costs when delivered to a model. */
export function costOfPage(page) {
  return 1 + (page.bands?.length ?? 0)
}
