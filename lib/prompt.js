/**
 * Task briefs handed to the analysis session.
 *
 * The extraction brief is rendered from `templates/analysis.md`, so the user can
 * change how the model works without touching plugin code. The brief is assembled
 * in a fixed order — analysis body → background → taxonomy → custom sections →
 * system suffix — and the composition is visible/edited block by block in the
 * plugin's Settings page.
 */
import { parseReportedRefs } from './normalize.js'
import { renderTemplate } from './templates.js'

/**
 * System text appended after every brief: a per-batch tool cheat-sheet. It is not
 * user-editable and is shown read-only (collapsed) in the Settings page.
 */
export const SYSTEM_SUFFIX = `---

本批次工具调用速记（batchId 固定为 {{batchId}}）：

- 看整页：mistake_pages({ batchId: "{{batchId}}", page: N })
- 只看某条横带：mistake_pages({ batchId: "{{batchId}}", page: N, band: B })
- 某处读不准，索取原生分辨率重切：mistake_pages({ batchId: "{{batchId}}", page: N, band: B, cell: 1..9 })
- 提交候选错题：mistake_stage({ batchId: "{{batchId}}", candidates: [...] })
- 自定义板块内容：写进每道候选的 extraSections: [{ title: "板块标题", content: "正文" }]
- 提交最终决定：mistake_select({ batchId: "{{batchId}}", keep: ["8"], drop: [{ ref: "3", reason: "已掌握" }] })
`

/**
 * Prompt instructions for the enabled PDF/card sections, in the user's template
 * order. Fixed sections are described by their editable description; custom
 * sections are marked so the model knows to submit them through `extraSections`.
 */
export function sectionsPrompt(sectionList) {
  const list = (Array.isArray(sectionList) ? sectionList : [])
    .filter((entry) => entry !== null && typeof entry === 'object' && entry.enabled !== false)
    .filter((entry) => String(entry.label ?? entry.title ?? '').trim() !== '')
  if (list.length === 0) return ''
  const lines = [
    '## PDF 板块说明',
    '',
    '卡片与导出的 PDF 按以下顺序包含这些板块。固定板块按说明填写对应字段；标注「自定义板块」的，把该板块正文放进候选的 `extraSections`（`{ title, content }`，title 用板块标题）：',
    '',
  ]
  list.forEach((entry, index) => {
    const label = String(entry.label ?? entry.title).trim()
    const description = String(entry.description ?? '').trim()
    const custom = entry.kind === 'custom' ? '（自定义板块）' : ''
    lines.push(`${index + 1}. **${label}**${custom}${description === '' ? '' : `：${description}`}`)
  })
  return lines.join('\n')
}

/** Fallback for call sites that only pass the template files (no catalogue). */
function fallbackSections(templates) {
  return (Array.isArray(templates?.custom) ? templates.custom : [])
    .filter((item) => item !== null && typeof item === 'object' && item.enabled !== false)
    .filter((item) => String(item.title ?? '').trim() !== '')
    .map((item) => ({ kind: 'custom', label: String(item.title).trim(), description: item.description, enabled: true }))
}

/** Variables available to templates/analysis.md. */
export function briefVariables({ batch, config, templates, sections }) {
  const hint = typeof batch.hint === 'string' && batch.hint.trim() !== '' ? batch.hint.trim() : ''
  const reported = parseReportedRefs(hint)
  return {
    batchId: batch.id,
    subject: batch.subject ?? 'math',
    pages: batch.pages.length,
    bands: batch.pages[0]?.bands?.length ?? 0,
    cells: 9,
    pagesPerRequest: config.pagesPerRequest,
    hint: reported.length > 0
      ? `${reported.join('、')}（原始输入：${hint}）`
      : (hint === '' ? '（未提供，请先看卷面再询问用户）' : hint),
    background: templates.background,
    taxonomy: templates.errorTaxonomy,
    // 启用的 PDF/卡片板块按模板顺序拼成说明；没有板块时是空串。
    custom: sectionsPrompt(Array.isArray(sections) ? sections : fallbackSections(templates)),
  }
}

/**
 * Append a block when the user removed its placeholder from analysis.md.
 *
 * Before this fallback a deleted `{{background}}` / `{{taxonomy}}` silently
 * dropped the whole block from the prompt; the Settings page warns about missing
 * placeholders and this keeps the content from vanishing in the meantime.
 */
function withFallbackBlock(body, heading, block) {
  const text = String(block ?? '').trim()
  if (text === '' || body.includes(text)) return body
  return `${body.replace(/\s+$/, '')}\n\n## ${heading}\n\n${text}`
}

export function analysisBrief({ batch, config, templates, sections }) {
  const vars = briefVariables({ batch, config, templates, sections })
  let body = renderTemplate(templates.analysis, vars)
  body = withFallbackBlock(body, '难度标定背景', templates.background)
  body = withFallbackBlock(body, '错因分类', templates.errorTaxonomy)
  // The default template carries a {{custom}} placeholder; an older/edited one may
  // not, in which case the enabled custom sections are appended instead of lost.
  const custom = String(vars.custom ?? '').trim()
  if (custom !== '' && !body.includes(custom)) body = `${body.replace(/\s+$/, '')}\n\n${custom}`
  return `${body}\n${renderTemplate(SYSTEM_SUFFIX, { batchId: batch.id })}`
}
