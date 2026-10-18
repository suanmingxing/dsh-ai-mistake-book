/**
 * Card → printable blocks: section splitting, text/formula runs, and the scan crop.
 *
 * Kept separate from the export orchestration (`export.js`) because this is the
 * part that turns one card's Markdown into the pieces the DOCX writer consumes; it
 * does no file-system layout or conversion work itself.
 */
import { readFile } from 'node:fs/promises'
import { CELLS_PER_BAND, cellRectangle } from './grid.js'
import { mathSegments, mathToText } from './latex.js'
import { resolveSourceImage } from './library.js'
import { latexToOmml } from './omml.js'
import { cropPng, decodePng } from './png.js'

/** Split a card body into `## heading` sections so pieces can be selected. */
export function splitSections(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  let current = { heading: '', lines: [] }
  for (const line of lines) {
    const match = /^##\s+(.*)$/.exec(line)
    if (match !== null) {
      if (current.heading !== '' || current.lines.some((entry) => entry.trim() !== '')) sections.push(current)
      current = { heading: match[1].trim(), lines: [] }
      continue
    }
    if (/^#\s+/.test(line)) continue
    current.lines.push(line)
  }
  if (current.heading !== '' || current.lines.some((entry) => entry.trim() !== '')) sections.push(current)
  return sections.map((section) => ({ heading: section.heading, text: section.lines.join('\n').trim() }))
}

export function bodyLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '· ').trim())
    .filter((line) => line !== '')
}

/**
 * 公式首尾若是孤立的二元运算符，就把它挪回正文。
 *
 * LibreOffice Math 会把「以运算符结尾」的公式当成缺右操作数，自动补一个 `¿`
 * 占位符——`则 \tan\theta =` 就会渲染成 `tanθ =¿`。把运算符拆出去当普通文字，
 * 既不缺操作数，排版也不会变形。
 */
const OPERATOR_LEAD = /^(\\[a-zA-Z]+|[-=+,<>])/
const OPERATOR_TAIL = /(\\[a-zA-Z]+|[-=+,<>])$/
const OPERATOR_TEXT = {
  '=': '=', '+': '+', '-': '−', ',': ',', '<': '<', '>': '>',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  pm: '±', mp: '∓', cdot: '·', times: '×',
}

function stripEdgeOperators(tex) {
  let body = String(tex ?? '').trim()
  let prefix = ''
  let suffix = ''
  for (let guard = 0; guard < 8; guard += 1) {
    const tail = OPERATOR_TAIL.exec(body)
    if (tail !== null) {
      const key = tail[1].startsWith('\\') ? tail[1].slice(1) : tail[1]
      if (OPERATOR_TEXT[key] !== undefined) {
        suffix = OPERATOR_TEXT[key] + suffix
        body = body.slice(0, tail.index).trimEnd()
        continue
      }
    }
    const lead = OPERATOR_LEAD.exec(body)
    if (lead !== null) {
      const key = lead[1].startsWith('\\') ? lead[1].slice(1) : lead[1]
      if (OPERATOR_TEXT[key] !== undefined) {
        prefix += OPERATOR_TEXT[key]
        body = body.slice(lead[1].length).trimStart()
        continue
      }
    }
    break
  }
  return { body, prefix, suffix }
}

/**
 * 把一行拆成「文字 + Word 原生公式」的 runs。
 *
 * 公式走 OMML（`lib/omml.js`）由 LibreOffice 排版成真正的数学式；某个片段
 * 解析失败时退回 Unicode 转写，保证内容不会整段消失。
 */
export function bodyRuns(line) {
  const runs = []
  for (const segment of mathSegments(line)) {
    if (segment.kind === 'text') {
      if (segment.text !== '') runs.push({ text: segment.text })
      continue
    }
    const { body, prefix, suffix } = stripEdgeOperators(segment.text)
    if (prefix !== '') runs.push({ text: prefix })
    const omml = body === '' ? undefined : latexToOmml(body)
    if (body === '') runs.push({ text: suffix })
    else if (omml === undefined) runs.push({ text: mathToText(`$${segment.text}$`) })
    else {
      runs.push({ omml })
      if (suffix !== '') runs.push({ text: suffix })
    }
  }
  return runs
}

/**
 * Crop the scan around the cell the analysis actually read.
 *
 * The cell is a 1/3 × 1/3 square, but a question stem is a wide line of text, so
 * only the cell's VERTICAL extent is used and the full band width is kept —
 * otherwise the crop slices the question off mid-sentence. This is a locator: it
 * helps a reader find the question on the original paper, while the transcription
 * above it carries the text.
 */
export async function sourceImageFor(paths, fields, cardFile, cropToQuestion) {
  const resolved = await resolveSourceImage(paths, fields, cardFile)
  if (resolved === undefined) return undefined
  const bytes = await readFile(resolved.absolute)
  const cell = fields?.source?.cell
  if (!cropToQuestion || !Number.isFinite(cell) || cell < 1 || cell > CELLS_PER_BAND) {
    return { data: bytes, note: '原卷切片（完整横带）' }
  }
  try {
    const decoded = decodePng(bytes)
    const square = cellRectangle({ width: decoded.width, height: decoded.height }, cell)
    const row = { x: 0, y: square.y, width: decoded.width, height: square.height }
    const cropped = cropPng(bytes, row)
    return { data: cropped.buffer, note: `原卷切片（第 ${cell} 格所在的高度，整幅宽度）` }
  } catch {
    return { data: bytes, note: '原卷切片（完整横带）' }
  }
}
