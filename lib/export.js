/**
 * Export archived cards to PDF.
 *
 * Path: cards → OOXML (hand-written, see docx.js) → PDF via the bundled LibreOffice
 * engine (see raster.js). There is no headless browser here, so formulas are
 * transliterated to Unicode rather than typeset, and the original scan is embedded
 * as an image — the scan is what makes a printed mistake book worth having.
 *
 * This module is the orchestration only: pick the cards, turn each into printable
 * blocks (helpers live in `export-build.js`), write the DOCX, convert it, and write
 * the sidecar. Listing/deleting exports lives in `export-store.js`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { buildDocx } from './docx.js'
import { bodyLines, bodyRuns, sourceImageFor, splitSections } from './export-build.js'
import { normalizeExportSettings, orderedSections, readExportSettings, sectionCatalogue, sectionIncluded } from './export-settings.js'
import { collectCards } from './library.js'
import { messageOf, nowStamp, pathExists, toRelative, writeJson } from './paths.js'
import { convertOfficeToPdf } from './raster.js'
import { readCustomTemplates } from './templates.js'

// `splitSections` used to be exported from this module; keep it reachable here.
export { splitSections }
// Backwards-compatible re-export: the export-management endpoints (api/exports.js)
// now import the store directly, but the private export-collision check and older
// callers still take listExports/deleteExport from this module.
export { deleteExport, listExports } from './export-store.js'

/**
 * Build the printable document and convert it.
 *
 * @returns {{ file: string, absolute: string, cards: number, papers: number, pages: string[], missing: string[] }}
 */
export async function exportCardsToPdf(paths, options = {}) {
  // 板块目录 = 六个预设 + 用户自定义模板：每个启用的自定义模板就是卡片/PDF 里
  // 的一个新板块（标题即 `## 标题`），和预设板块共用同一份顺序与渲染逻辑。
  const custom = await readCustomTemplates(paths)
  const customIds = custom.map((item) => item.id)
  const customById = new Map(custom.map((item) => [item.id, item]))
  const enabledCustom = custom.filter((item) => item.enabled !== false)
  const catalogue = sectionCatalogue(custom)
  // 板块默认值来自归档根下的 export-settings.json（设置页可改），
  // 本次调用的显式参数优先——「设置」定默认，导出时的勾选定这一次。
  const saved = await readExportSettings(paths, customIds)
  const settings = normalizeExportSettings({
    sections: { ...saved.sections, ...(options.sections ?? {}) },
    order: saved.order,
    includeSource: options.includeSource === undefined ? saved.includeSource : options.includeSource,
    cropToQuestion: options.cropToQuestion === undefined ? saved.cropToQuestion : options.cropToQuestion,
  }, customIds)
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
      // Rebuild the path from segments instead of swapping `/` for `\`: the
      // archive-relative path is POSIX-style on every platform, and a backslash
      // name would not resolve on macOS/Linux.
      const raw = await readFile(join(paths.root, ...card.file.split('/')), 'utf8')
      const parsed = await import('./frontmatter.js').then((module) => module.parseFrontMatter(raw))
      const fields = card
      const sections = splitSections(parsed.body)

      blocks.push({ kind: 'subheading', text: `${card.id}　第 ${card.questionRef} 题　${card.difficulty}` })
      const meta = [card.paper]
      if ((card.knowledgePoints ?? []).length > 0) meta.push(card.knowledgePoints.join('；'))
      if ((card.errorTypes ?? []).length > 0) meta.push(`错因：${card.errorTypes.join('、')}`)
      blocks.push({ kind: 'text', text: meta.join('　｜　'), size: 18, color: '666666' })

      // Emit the known sections in the order configured in Settings. Presets are
      // matched by their fixed `## heading`; custom templates are extra sections
      // matched by their title, and only when the template itself is enabled.
      // Headings the catalogue does not know (hand-edited cards) keep their body
      // order at the end (they stay included, see sectionIncluded).
      const emitSectionBody = (section) => {
        if (section.text.trim() === '') return
        if (section.heading !== '') blocks.push({ kind: 'text', text: section.heading, bold: true, size: 22 })
        for (const line of bodyLines(section.text)) {
          const runs = bodyRuns(line)
          if (runs.length > 0) blocks.push({ kind: 'rich', runs })
        }
      }
      const byHeading = new Map(sections.map((section) => [section.heading, section]))
      const emitted = new Set()
      const registeredHeadings = new Set(catalogue.map((entry) => entry.heading))
      const emitPreset = (entry) => {
        const section = byHeading.get(entry.heading)
        if (section === undefined || emitted.has(section)) return
        emitted.add(section)
        if (!sectionIncluded(settings, section.heading)) return
        emitSectionBody(section)
      }
      const emitCustom = (entry) => {
        // 停用的模板、空标题的坏数据，以及卡片里没有该板块内容的，都跳过。
        if (entry.heading.trim() === '') return
        const template = customById.get(entry.id)
        if (template === undefined || template.enabled === false) return
        const section = byHeading.get(entry.heading)
        if (section === undefined || emitted.has(section)) return
        emitted.add(section)
        emitSectionBody(section)
      }
      for (const entry of orderedSections(settings, catalogue)) {
        if (entry.kind === 'custom') emitCustom(entry)
        else emitPreset(entry)
      }
      for (const section of sections) {
        if (emitted.has(section)) continue
        // 目录里登记过但被停用的自定义板块不再追加（它确实被用户关掉了）。
        if (section.heading !== '' && registeredHeadings.has(section.heading)) continue
        emitted.add(section)
        emitSectionBody(section)
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
  // Derive the sidecar name from the file that was ACTUALLY chosen: on a name
  // collision the docx/pdf pair is renamed to `... (1)`, and a sidecar still
  // written under the un-suffixed base would never be found by listExports.
  const stem = basename(docxPath, '.docx')

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
    await writeJson(join(exportsDir, `${stem}.json`), {
      file: toRelative(paths.root, pdfPath),
      title,
      cards: chosen.length,
      cardIds: chosen.map((card) => card.id),
      papers: papers.size,
      sections: settings.sections,
      order: settings.order,
      customSections: enabledCustom.map(({ id, title }) => ({ id, title })),
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
