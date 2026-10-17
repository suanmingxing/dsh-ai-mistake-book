/**
 * Export archived cards to PDF.
 *
 * Path: cards → OOXML (hand-written, see docx.js) → PDF via the bundled LibreOffice
 * engine (see raster.js). There is no headless browser here, so formulas are
 * transliterated to Unicode rather than typeset, and the original scan is embedded
 * as an image — the scan is what makes a printed mistake book worth having.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectCards, resolveSourceImage } from './archive.js'
import { buildDocx } from './docx.js'
import { normalizeExportSettings, readExportSettings, sectionIncluded } from './export-settings.js'
import { CELLS_PER_BAND, cellRectangle } from './grid.js'
import { mathSegments, mathToText } from './latex.js'
import { latexToOmml } from './omml.js'
import { messageOf, nowStamp, pathExists, readJson, toRelative, writeJson } from './paths.js'
import { cropPng, decodePng } from './png.js'
import { convertOfficeToPdf } from './raster.js'
import { moveToBin } from './trash.js'

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

function bodyLines(text) {
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
function bodyRuns(line) {
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
async function sourceImageFor(paths, fields, cardFile, cropToQuestion) {
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

/**
 * Build the printable document and convert it.
 *
 * @returns {{ file: string, absolute: string, cards: number, papers: number, pages: string[], missing: string[] }}
 */
export async function exportCardsToPdf(paths, options = {}) {
  // 板块默认值来自归档根下的 export-settings.json（设置页可改），
  // 本次调用的显式参数优先——「设置」定默认，导出时的勾选定这一次。
  const saved = await readExportSettings(paths)
  const settings = normalizeExportSettings({
    sections: { ...saved.sections, ...(options.sections ?? {}) },
    includeSource: options.includeSource === undefined ? saved.includeSource : options.includeSource,
    cropToQuestion: options.cropToQuestion === undefined ? saved.cropToQuestion : options.cropToQuestion,
  })
  const includeSource = settings.includeSource
  const cropToQuestion = settings.cropToQuestion
  // `files` absent means "export everything"; `files: []` means the user selected
  // nothing, which must refuse rather than quietly export the whole library.
  const hasFilter = Array.isArray(options.files)
  const wanted = hasFilter ? options.files.map((file) => String(file)) : undefined
  if (hasFilter && wanted.length === 0) throw new Error('没有选择要导出的卡片')
  const title = typeof options.title === 'string' && options.title.trim() !== '' ? options.title.trim() : '错题集'

  const collected = await collectCards(paths)
  const chosen = wanted === undefined ? collected.cards : collected.cards.filter((card) => wanted.includes(card.file))
  const missing = wanted === undefined ? [] : wanted.filter((file) => !collected.cards.some((card) => card.file === file))
  if (chosen.length === 0) throw new Error('没有可导出的卡片')

  // Group by paper so the printed booklet follows the order of the archive.
  const papers = new Map()
  for (const card of chosen) {
    const key = `${card.subject}/${card.paperDir}`
    if (!papers.has(key)) papers.set(key, { subject: card.subject, paperDir: card.paperDir, paper: card.paper, cards: [] })
    papers.get(key).cards.push(card)
  }

  const blocks = []
  let first = true
  for (const group of papers.values()) {
    if (!first) blocks.push({ kind: 'pagebreak' })
    first = false
    blocks.push({ kind: 'heading', text: `${group.paper}（${group.subject}）` })

    for (const card of group.cards) {
      const raw = await readFile(join(paths.root, card.file.replace(/\//g, '\\')), 'utf8')
      const parsed = await import('./frontmatter.js').then((module) => module.parseFrontMatter(raw))
      const fields = card
      const sections = splitSections(parsed.body)

      blocks.push({ kind: 'subheading', text: `${card.id}　第 ${card.questionRef} 题　${card.difficulty}` })
      const meta = [card.paper]
      if ((card.knowledgePoints ?? []).length > 0) meta.push(card.knowledgePoints.join('；'))
      if ((card.errorTypes ?? []).length > 0) meta.push(`错因：${card.errorTypes.join('、')}`)
      blocks.push({ kind: 'text', text: meta.join('　｜　'), size: 18, color: '666666' })

      for (const section of sections) {
        if (!sectionIncluded(settings, section.heading)) continue
        if (section.text.trim() === '') continue
        if (section.heading !== '') blocks.push({ kind: 'text', text: section.heading, bold: true, size: 22 })
        for (const line of bodyLines(section.text)) {
          const runs = bodyRuns(line)
          if (runs.length > 0) blocks.push({ kind: 'rich', runs })
        }
      }

      if (includeSource) {
        const image = await sourceImageFor(paths, fields, card.file, cropToQuestion)
        if (image !== undefined) {
          blocks.push({ kind: 'text', text: '原卷', bold: true, size: 22 })
          blocks.push({ kind: 'image', data: image.data, caption: image.note })
        }
      }
      blocks.push({ kind: 'rule' })
    }
  }

  const document = buildDocx({ title, blocks })
  const exportsDir = join(paths.root, 'exports')
  // writeFile does not create parents.
  await mkdir(exportsDir, { recursive: true })
  const base = `错题集-${nowStamp()}`
  let docxPath = join(exportsDir, `${base}.docx`)
  let index = 1
  while (await pathExists(docxPath)) {
    docxPath = join(exportsDir, `${base} (${index}).docx`)
    index += 1
  }
  await writeFile(docxPath, document)
  const pdfPath = docxPath.replace(/\.docx$/, '.pdf')

  let report
  try {
    report = await convertOfficeToPdf(docxPath, pdfPath, { signal: options.signal })
  } catch (error) {
    // Keep the DOCX so the work is not lost, and say where it is.
    throw new Error(`PDF 转换失败：${messageOf(error)}（中间文档已保留：${toRelative(paths.root, docxPath)}）`)
  }

  // 与 PDF 同名的 sidecar：导出管理界面靠它显示"几张卡、几份卷子、按什么设置导的"。
  // 写失败不影响导出本身——PDF 才是交付物。
  try {
    await writeJson(join(exportsDir, `${base}.json`), {
      file: toRelative(paths.root, pdfPath),
      title,
      cards: chosen.length,
      cardIds: chosen.map((card) => card.id),
      papers: papers.size,
      sections: settings.sections,
      includeSource: settings.includeSource,
      cropToQuestion: settings.cropToQuestion,
      backend: report?.backend ?? 'unknown',
      missingFonts: Array.isArray(report?.missingFonts) ? report.missingFonts : [],
      createdAt: new Date().toISOString(),
    })
  } catch {
    /* 元信息是辅助信息，丢了也能用 */
  }

  return {
    file: toRelative(paths.root, pdfPath),
    // 绝对路径给"在系统里打开"用：宿主 host.openPath 只接受主机可解析的路径，
    // 而 file 是相对归档根的（给 /mistake/asset 链接和展示用）。
    absolute: pdfPath,
    docx: toRelative(paths.root, docxPath),
    cards: chosen.length,
    papers: papers.size,
    missing,
    backend: report?.backend ?? 'unknown',
    missingFonts: Array.isArray(report?.missingFonts) ? report.missingFonts : [],
  }
}

const EXPORT_DIR = 'exports'

/**
 * 导出目录里的 PDF 清单（新的在前），并附上同名的 sidecar 元信息。
 * sidecar 缺失时 `meta` 为 null——老导出文件仍然要能列出来、能删。
 */
export async function listExports(paths) {
  const dir = join(paths.root, EXPORT_DIR)
  const names = await readdir(dir).catch(() => [])
  const files = []
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith('.pdf'))) {
    const target = join(dir, name)
    const info = await stat(target).catch(() => null)
    if (info === null || !info.isFile()) continue
    const base = name.replace(/\.pdf$/i, '')
    const meta = await readJson(join(dir, `${base}.json`), null)
    files.push({
      file: `${EXPORT_DIR}/${name}`,
      absolute: target,
      name,
      bytes: info.size,
      at: info.mtime.toISOString(),
      hasDocx: await pathExists(join(dir, `${base}.docx`)),
      meta: meta === null || typeof meta !== 'object' ? null : meta,
    })
  }
  // 按修改时间倒序：导出名默认带时间戳，但用户改过标题时文件名就不一定有序了。
  files.sort((left, right) => String(right.at).localeCompare(String(left.at)))
  return files
}

/**
 * 删除一份导出：PDF、中间 DOCX 与 sidecar 一起处理。
 * 默认进回收站（和删卡片同一套机制），`permanent` 才真的销毁。
 */
export async function deleteExport(paths, relativeFile, options = {}) {
  const rel = String(relativeFile ?? '').replace(/\\/g, '/')
  if (!rel.startsWith(`${EXPORT_DIR}/`) || !rel.toLowerCase().endsWith('.pdf')) {
    throw new Error(`不是导出文件：${relativeFile}`)
  }
  const base = rel.replace(/\.pdf$/i, '')
  const result = await moveToBin(paths, [rel, `${base}.docx`, `${base}.json`], {
    permanent: options.permanent === true,
    note: '删除导出文件',
  })
  return { ...result, files: await listExports(paths) }
}
