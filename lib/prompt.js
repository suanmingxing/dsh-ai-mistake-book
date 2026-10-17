/**
 * Task briefs handed to the analysis session.
 *
 * The extraction brief is rendered from `templates/analysis.md`, so the user can
 * change how the model works without touching plugin code. The reconnaissance
 * brief is kept for diagnostics: it is what P1 used to prove the page images
 * actually reach the model.
 */
import { parseReportedRefs } from './normalize.js'
import { renderCustomSection, renderTemplate } from './templates.js'

export function reconBrief({ batch, config }) {
  const pageCount = batch.pages.length
  const bandTotal = batch.pages[0]?.bands?.length ?? 0
  const hint = typeof batch.hint === 'string' && batch.hint.trim() !== '' ? batch.hint.trim() : '（未提供）'
  return [
    `你是「AI 错题本」的卷面侦察员。本批次：${batch.id}`,
    '',
    `这份扫描件共 ${pageCount} 页；每页提供 1 张整页概览${bandTotal > 0 ? ` 和 ${bandTotal} 条整宽横带切片` : ''}。横带切片的分辨率高于整页概览，看清手写与小字号公式要用切片。`,
    `用户在录入时给出的提示：${hint}`,
    '',
    '本次只做侦察，不做归档。请完成：',
    `1. 调用 mistake_pages 工具（参数 batchId="${batch.id}"），每次最多取 ${config.pagesPerRequest} 页，直到看完所有页。`,
    '2. 逐页报告你实际看到的内容：整页共几道题、题号范围、题型（填空/选择/解答）、是否有手写作答、是否有批改痕迹（勾、叉、划线、分数、评语）。',
    '3. 明确回答：手写内容是否清晰可读？若有不清晰之处，指出是第几页、哪个位置。',
    '4. 用 200 字以内总结这份卷子的结构与可读性。',
    '',
    '要求：只报告你确实看到的内容。不要推测、不要解题、不要编造题号。看不清就说看不清。',
  ].join('\n')
}

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
