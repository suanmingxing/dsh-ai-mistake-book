/**
 * Task briefs handed to the analysis session.
 *
 * The extraction brief is rendered from `templates/analysis.md`, so the user can
 * change how the model works without touching plugin code. The brief is assembled
 * in a fixed order — analysis body → background → taxonomy → system suffix — and
 * the composition is visible/edited block by block in the plugin's Settings page.
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
- 提交最终决定：mistake_select({ batchId: "{{batchId}}", keep: ["8"], drop: [{ ref: "3", reason: "已掌握" }] })
`

/** Variables available to templates/analysis.md. */
export function briefVariables({ batch, config, templates }) {
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

export function analysisBrief({ batch, config, templates }) {
  const vars = briefVariables({ batch, config, templates })
  let body = renderTemplate(templates.analysis, vars)
  body = withFallbackBlock(body, '难度标定背景', templates.background)
  body = withFallbackBlock(body, '错因分类', templates.errorTaxonomy)
  return `${body}\n${renderTemplate(SYSTEM_SUFFIX, { batchId: batch.id })}`
}
