/**
 * Task briefs handed to the analysis session.
 *
 * The extraction brief is rendered from `templates/analysis.md`, so the user can
 * change how the model works without touching plugin code.
 */
import { parseReportedRefs } from './normalize.js'
import { renderCustomSection, renderTemplate } from './templates.js'

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
    // 用户自定义模板拼成的一节；没有启用项时是空串。
    custom: renderCustomSection(templates.custom),
  }
}

export function analysisBrief({ batch, config, templates }) {
  const vars = briefVariables({ batch, config, templates })
  const body = renderTemplate(templates.analysis, vars)
  // 模板里写了 {{custom}} 就落在用户选定的位置；老模板没有这个占位符时
  // 自动补在正文之后——否则自定义要求会静默丢失。
  const withCustom = vars.custom === '' || body.includes(vars.custom)
    ? body
    : `${body}

${vars.custom}`
  return `${withCustom}
---

本批次工具调用速记（batchId 固定为 ${batch.id}）：

- 看整页：mistake_pages({ batchId: "${batch.id}", page: N })
- 只看某条横带：mistake_pages({ batchId: "${batch.id}", page: N, band: B })
- 某处读不准，索取原生分辨率重切：mistake_pages({ batchId: "${batch.id}", page: N, band: B, cell: 1..9 })
- 提交候选错题：mistake_stage({ batchId: "${batch.id}", candidates: [...] })
- 提交最终决定：mistake_select({ batchId: "${batch.id}", keep: ["8"], drop: [{ ref: "3", reason: "已掌握" }] })
`
}
