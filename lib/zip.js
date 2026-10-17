/**
 * Minimal ZIP writer.
 *
 * Needed because the PDF route goes through the bundled LibreOffice engine, whose
 * only text inputs are Office formats — and a DOCX is a ZIP of XML parts. Only the
 * subset that Office readers require is implemented: stored or deflated entries,
 * a central directory, and the end-of-central-directory record.
 */
import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

export function crc32(buffer) {
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

/** MS-DOS packed date and time, which is what a ZIP header stores. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * Build a ZIP archive from `{ name, data, store? }` entries.
 *
 * `store: true` skips compression, which matters for the `mimetype` member some
 * containers require to be uncompressed and first.
 */
export function createZip(entries, options = {}) {
  const now = options.date ?? new Date()
  const stamp = dosDateTime(now)
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    const store = entry.store === true
    const body = store ? raw : deflateRawSync(raw, { level: 9 })
    const method = store ? 0 : 8
    const checksum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)            // version needed
    local.writeUInt16LE(0x0800, 6)        // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)            // no extra field

    chunks.push(local, name, body)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)           // version made by
    header.writeUInt16LE(20, 6)           // version needed
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt16LE(stamp.time, 12)
    header.writeUInt16LE(stamp.date, 14)
    header.writeUInt32LE(checksum, 16)
    header.writeUInt32LE(body.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(entry.name.endsWith('/') ? 0x10 : 0, 38) // directory flag
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + body.length
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...chunks, ...central, end])
}
