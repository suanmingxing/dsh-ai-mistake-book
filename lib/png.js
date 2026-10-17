/**
 * Minimal, dependency-free PNG crop/split for 8-bit non-interlaced images.
 *
 * Why this exists: DSH normalizes any attached image larger than 4 MP (2048x2048 area)
 * down to fit, so rendering a PDF page at high dpi and attaching it whole gains nothing.
 * Splitting the high-dpi raster into full-width bands keeps every band under that cap,
 * which multiplies the effective resolution the vision model receives.
 *
 * Only the subset PDFium (libreoffice-kit) emits is supported: bit depth 8,
 * colour types 0/2/4/6, no interlacing. Anything else throws.
 */
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes) {
  let c = -1
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function channelsFor(colorType) {
  switch (colorType) {
    case 0: return 1
    case 2: return 3
    case 4: return 2
    case 6: return 4
    default: throw new Error(`png: unsupported colour type ${colorType}`)
  }
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** Decode a PNG into its raw (unfiltered) pixel buffer. */
export function decodePng(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('png: bad signature')
  let offset = 8
  let header
  const idat = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        compression: body[10],
        filter: body[11],
        interlace: body[12],
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (header === undefined) throw new Error('png: missing IHDR')
  if (header.bitDepth !== 8) throw new Error(`png: unsupported bit depth ${header.bitDepth}`)
  if (header.interlace !== 0) throw new Error('png: interlaced images are not supported')
  const channels = channelsFor(header.colorType)
  const rowBytes = header.width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const expected = header.height * (rowBytes + 1)
  if (raw.length < expected) throw new Error(`png: truncated data (${raw.length} < ${expected})`)
  const pixels = Buffer.alloc(header.height * rowBytes)
  let prev = Buffer.alloc(rowBytes)
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (rowBytes + 1)]
    const src = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1))
    const out = pixels.subarray(y * rowBytes, (y + 1) * rowBytes)
    switch (filter) {
      case 0:
        src.copy(out)
        break
      case 1:
        for (let i = 0; i < rowBytes; i += 1) out[i] = (src[i] + (i >= channels ? out[i - channels] : 0)) & 0xff
        break
      case 2:
        for (let i = 0; i < rowBytes; i += 1) out[i] = (src[i] + prev[i]) & 0xff
        break
      case 3:
        for (let i = 0; i < rowBytes; i += 1) {
          const left = i >= channels ? out[i - channels] : 0
          out[i] = (src[i] + ((left + prev[i]) >> 1)) & 0xff
        }
        break
      case 4:
        for (let i = 0; i < rowBytes; i += 1) {
          const a = i >= channels ? out[i - channels] : 0
          const b = prev[i]
          const c = i >= channels ? prev[i - channels] : 0
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          out[i] = (src[i] + pred) & 0xff
        }
        break
      default:
        throw new Error(`png: unknown filter ${filter} on row ${y}`)
    }
    prev = out
  }
  return { width: header.width, height: header.height, colorType: header.colorType, pixels }
}

/** Encode a raw pixel buffer as a PNG (filter 0 on every row). */
export function encodePng({ width, height, colorType, pixels }) {
  const channels = channelsFor(colorType)
  const rowBytes = width * channels
  if (pixels.length !== height * rowBytes) throw new Error('png: pixel buffer size mismatch')
  const raw = Buffer.alloc(height * (rowBytes + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (rowBytes + 1)] = 0
    pixels.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Crop an axis-aligned rectangle out of a PNG and return a new PNG. */
export function cropPng(bytes, box) {
  const image = decodePng(bytes)
  const channels = channelsFor(image.colorType)
  const srcRow = image.width * channels
  const x = Math.max(0, Math.min(box.x, image.width - 1))
  const y = Math.max(0, Math.min(box.y, image.height - 1))
  const width = Math.max(1, Math.min(box.width, image.width - x))
  const height = Math.max(1, Math.min(box.height, image.height - y))
  const outRow = width * channels
  const pixels = Buffer.alloc(height * outRow)
  for (let row = 0; row < height; row += 1) {
    image.pixels.copy(
      pixels,
      row * outRow,
      (y + row) * srcRow + x * channels,
      (y + row) * srcRow + x * channels + outRow,
    )
  }
  return { buffer: encodePng({ width, height, colorType: image.colorType, pixels }), width, height, colorType: image.colorType }
}

/**
 * Cut one PNG into `bands` full-width horizontal strips.
 * Full-width bands keep each text line intact, unlike a quadrant split.
 */
export function splitIntoBands(bytes, bands, maxPixels = 4194304) {
  const image = decodePng(bytes)
  if (bands <= 1) return [{ index: 1, y: 0, height: image.height }]
  const bandHeight = Math.max(1, Math.floor(image.height / bands))
  const result = []
  for (let i = 0; i < bands; i += 1) {
    const y = i * bandHeight
    const height = i === bands - 1 ? image.height - y : bandHeight
    if (height <= 0) break
    result.push({ index: i + 1, y, height })
  }
  // If a band would still exceed the cap, ask for more bands instead of shipping a re-compressed image.
  const widest = image.width * Math.max(...result.map((band) => band.height))
  if (widest > maxPixels) throw new Error(`png: band ${widest}px exceeds cap ${maxPixels}; increase band count`)
  return result
}

export function bandCountFor(width, height, maxPixels = 4194304) {
  let bands = 1
  while (bands < 64 && (width * Math.ceil(height / bands)) > maxPixels) bands += 1
  return bands
}
