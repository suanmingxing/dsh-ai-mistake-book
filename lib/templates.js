/**
 * Editable templates.
 *
 * The prompts are data, not code: they live as Markdown files under the archive
 * root so the user can tune how the analysis behaves without touching the plugin,
 * and so a change is visible and diffable.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nowStamp, pathExists, readJson, writeJson } from './paths.js'

export const DEFAULT_ANALYSIS = `（本条消息由 AI 错题本插件自动下发，用于分析批次 {{batchId}}；分析就在用户当前的这个会话里进行。）

你是「AI 错题本」的卷面分析员。批次 {{batchId}}，学科 {{subject}}。

## 一、读数要求

1. 先调用 mistake_pages 看卷面：先看整页概览定位题号，再看横带读取内容。
2. 横带的分辨率高于整页概览。**凡是要转录手写内容，必须以横带为准，不要凭概览猜。**
3. 某条横带看不清时，用 \`mistake_pages({ batchId: "{{batchId}}", page: N, band: B, cell: C })\` 索取该处**原生分辨率重切**（cell 为 1..{{cells}} 的 3×3 分格，左→右、上→下）。这是从源图重新裁切，不是放大，所以可能看清你没看清的东西。
4. 重切后仍不可辨，**必须记入该题的 uncertain 字段**，不要猜、不要跳过。源图读不出来的东西，交给人来确认。

## 二、提取要求

对每一道**错题**，提取以下内容。**你的任务是整理学生已有的东西，不是重新解题：**

- \`stem\`：题干转录。**行内公式必须用 $...$ 包住**（例如 \`四个点到平面 $\\alpha$ 的距离\`），否则正文里的公式不会被渲染。
- \`myAnswer\`：学生在卷面横线/空格处写下的作答。
- \`myAnswerStruck\`：该作答是否被划改/划掉（true/false）。
- \`revisedAnswer\`：若被划改，划改后改写成了什么；没有则留空。
- \`myWork\`：页边、空白处的演算过程（尽量照抄原样，含手写公式）。
- \`annotatedAnswer\`：**学生在卷面上自己标注的正确答案**。没有标注就留空。
- \`annotatedMethod\`：**学生在卷面上自己标注的正确解法/技巧**。没有就留空。
- \`knowledgePoints\`：多级知识点，用 \`一级/二级\` 形式，如 \`函数/函数的单调性\`。可多个。
- \`skills\`：解题技巧短句（有标注才填）。
- \`errorTypes\`：错因，从下面的分类里选。
- \`difficulty\`：\`易\` / \`中\` / \`难\`。
- \`basis\`：**你判定这是错题的依据**（例如"用户在命令里报了第 5 题""卷面上该题作答被长斜线划掉"）。
- \`uncertain\`：读不准之处，每项含 \`what\`（读不准什么）、\`where\`（第几页/哪一带/哪个位置）、\`blocking\`（是否严重到影响归档）。
- \`source\`：\`{ page, band, cell, note }\`，指明这段内容来自哪里，便于人工回溯原图。

**绝不编造。** 卷面上没有的答案、过程、知识点，一律留空。若某题的确缺少正确答案且缺少关键步骤而你判断必须补充，才在 \`annotatedMethod\` 之后单独说明"以下为补充解析"——这是例外，不是常态。

## 三、难度标定背景

以下框架用于**校准难度与知识点的粒度**，避免分析过初级或过高级。**不要**把知识点强行塞进这个框架的条目里；它只是背景。

{{background}}

## 四、错因分类

{{taxonomy}}

## 五、本次要整理的错题

用户在命令中报的题号：**{{hint}}**

- **以用户报的题号为准。** 只对这些题做完整提取与提交。
- 若用户报的题号在卷面上对不上（漏读、误读、题号不存在），**不要自行改题号**，把差异写进 uncertain 并说明。
- 若用户没有报题号，先看卷面，再用 ask_user_question 问清楚哪几题需要整理。

## 六、工作流程（必须按顺序）

1. 用 mistake_pages 读完全部页面。
2. 用 \`mistake_stage\` 一次性提交本批次全部错题（\`candidates\` 数组）。
3. 用 \`ask_user_question\` 把候选清单交给用户确认：哪几题真的需要整理。把重复/疑似已归档的题也告诉用户。
4. 用户确认后，用 \`mistake_select\` 提交最终决定（\`keep\` 要整理的 ref，\`drop\` 不整理的及原因）。插件会据此生成卡片草稿，等待用户在插件页面里确认归档。

**只有用户可以决定归档与否。** 不要声称已经归档。

## 七、用户自定义要求

{{custom}}

## 八、你的环境

- 你**没有**文件系统、命令行或脚本访问权限。不要试图自己裁图、找文件、写脚本或诊断环境——那些工具不存在，你只会浪费回合。
- 读卷面的唯一途径是 \`mistake_pages\`。
- 每页的重切次数有限，请集中用在**真正关键、且靠原生分辨率有可能读清**的地方。额度用完后，请把剩下读不准的内容记入 \`uncertain\` 并继续推进，不要反复索取同一区域。
`

export const DEFAULT_BACKGROUND = `上海高中数学水平框架（仅作难度与粒度校准）：

- 高一：集合与逻辑、不等式、函数（概念/性质/幂指对）、三角比与三角函数初步、向量初步、立体几何初步。
- 高二：数列、向量的坐标运算与数量积、解三角形、解析几何（直线/圆/圆锥曲线）、空间向量与立体几何、复数、排列组合与二项式定理、概率统计初步。
- 高三：导数及其应用、概率分布（二项/超几何/正态）、统计推断、综合复习与压轴题（解析几何综合、导数综合、数列不等式）。

常见答题层级：基础题考单一概念套用；中档题考两三个概念的组合与分类讨论；难题考多步推理、参数讨论、构造与放缩。

英语（如为英语学科）：语法（时态/非谓语/从句/虚拟）、词汇辨析、完形、阅读（细节/推断/主旨）、翻译、写作（应用文/概要）。

**校准原则**：若某题只需套用单一定义，不要给它贴高等或竞赛级知识点；若某题需要多步分类讨论，也不要降级成简单概念。知识点粒度到"二级"通常足够（如 \`解析几何/椭圆的标准方程\`），不要细到具体解题步骤。
`

export const DEFAULT_ERROR_TAXONOMY = `# 错因分类：一行一个。可在下方增删，插件会按这里的名称归一化。
概念不清
公式记错
计算失误
审题错误
方法不当
分类讨论不全
知识漏洞
表达不规范
时间不足
`

const FILES = {
  analysis: { name: 'analysis.md', content: DEFAULT_ANALYSIS },
  background: { name: 'background.md', content: DEFAULT_BACKGROUND },
  errorTaxonomy: { name: 'error-taxonomy.md', content: DEFAULT_ERROR_TAXONOMY },
}

/** Built-in defaults, delivered to the Settings page so it can offer "restore". */
export const DEFAULT_TEMPLATES = Object.fromEntries(
  Object.entries(FILES).map(([key, file]) => [key, file.content]),
)

/**
 * Human-facing title/description for the three built-in blocks. The description is
 * what the Settings page shows under a block title; it is metadata and is NOT
 * injected into the prompt (unlike a custom template's description).
 */
export const TEMPLATE_META = {
  analysis: {
    title: '分析任务书',
    description: '主任务书：读数要求、提取字段、题号范围与工作流程；{{background}} / {{taxonomy}} 是插入点。',
  },
  background: {
    title: '难度与学段背景',
    description: '用于校准难度与知识点粒度的学段框架；替换进分析任务书的「三、难度标定背景」。',
  },
  errorTaxonomy: {
    title: '错因分类',
    description: '错因分类清单；替换进「四、错因分类」，并用于归一化错因字段。',
  },
}

export function templateFile(paths, key) {
  return join(paths.templates, FILES[key].name)
}

/**
 * Write any missing template so the user always has something to edit, then run
 * the one-time legacy custom-template migration. The migration is best effort: a
 * failure (read-only file, broken JSON) never blocks ingest or the settings page,
 * it simply retries on the next call.
 */
export async function ensureTemplates(paths) {
  await mkdir(paths.templates, { recursive: true })
  const created = []
  for (const [key, file] of Object.entries(FILES)) {
    const target = templateFile(paths, key)
    if (await pathExists(target)) continue
    await writeFile(target, file.content, 'utf8')
    created.push(file.name)
  }
  let migrated = null
  try {
    migrated = await migrateLegacyCustomTemplates(paths)
  } catch {
    migrated = null
  }
  return { created, migrated }
}

export async function readTemplates(paths) {
  const out = {}
  for (const [key, file] of Object.entries(FILES)) {
    try {
      out[key] = await readFile(templateFile(paths, key), 'utf8')
    } catch {
      out[key] = file.content
    }
  }
  out.custom = await readCustomTemplates(paths)
  return out
}

export async function writeTemplate(paths, key, content) {
  if (FILES[key] === undefined) throw new Error(`未知模板：${key}`)
  await mkdir(paths.templates, { recursive: true })
  await writeFile(templateFile(paths, key), String(content ?? ''), 'utf8')
  return templateFile(paths, key)
}

/**
 * Write several templates in one call (the Settings page saves all blocks with one
 * button). Only the keys present in `patch` are written; an empty analysis task is
 * refused because it would leave the analysis session with no instructions.
 */
export async function writeTemplates(paths, patch = {}) {
  const saved = []
  for (const key of Object.keys(FILES)) {
    if (patch?.[key] === undefined) continue
    if (key === 'analysis' && String(patch[key]).trim() === '') throw new Error('分析任务书不能为空')
    await writeTemplate(paths, key, patch[key])
    saved.push(key)
  }
  if (saved.length === 0) throw new Error('没有需要保存的模板')
  return saved
}

/** `{{name}}` substitution; unknown placeholders are left visible rather than blanked. */
export function renderTemplate(text, vars) {
  return String(text ?? '').replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

/* ============================================================================
 * 旧版「自定义模板」一次性迁移
 *
 * v0.1.x 把用户要求存在 templates/custom.json 的条目列表里，再拼成任务书的
 * 「用户自定义要求」。现在 customization 就是直接编辑默认 prompt，所以这里只
 * 保留迁移：启用条目追加进 analysis.md，然后把文件改名为 custom.json.migrated
 * （保留原数据）。没有该文件、已迁移过、或内容损坏时都安静跳过。
 * ========================================================================== */

const LEGACY_CUSTOM_FILE = 'custom.json'
const MIGRATION_MARKER = '<!-- ai-mistake-book: custom-templates migrated -->'

function legacyCustomFile(paths) {
  return join(paths.templates, LEGACY_CUSTOM_FILE)
}

/** 旧条目的启用判定与文本整理；只服务于迁移。 */
function legacyItemText(item) {
  if (item === null || typeof item !== 'object' || item.enabled === false) return null
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  const description = typeof item.description === 'string' ? item.description.trim() : ''
  const content = typeof item.content === 'string' ? item.content.trim() : ''
  if (title === '' && description === '' && content === '') return null
  return { title, description, content }
}

function renderMigratedSection(items) {
  const lines = [
    '## 用户自定义要求',
    '',
    '以下条目由旧版「自定义模板」迁移而来，按顺序遵守；与其它要求冲突时以本区为准。',
    '',
  ]
  items.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title === '' ? '未命名要求' : item.title}`)
    if (item.description !== '') lines.push('', `说明：${item.description}`)
    if (item.content !== '') lines.push('', item.content)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/**
 * Migrate the legacy custom-template list into analysis.md and archive the file.
 * Returns `{ count, file }` when a migration happened, otherwise `null`.
 */
async function migrateLegacyCustomTemplates(paths) {
  const source = legacyCustomFile(paths)
  if (!(await pathExists(source))) return null
  let raw = null
  try {
    raw = JSON.parse(await readFile(source, 'utf8'))
  } catch {
    raw = null
  }
  const items = (Array.isArray(raw?.items) ? raw.items : []).map(legacyItemText).filter((item) => item !== null)
  if (items.length > 0) {
    const target = templateFile(paths, 'analysis')
    let analysis
    try {
      analysis = await readFile(target, 'utf8')
    } catch {
      analysis = DEFAULT_ANALYSIS
    }
    if (!analysis.includes(MIGRATION_MARKER)) {
      const next = `${analysis.replace(/\s+$/, '')}\n\n${renderMigratedSection(items)}\n\n${MIGRATION_MARKER}\n`
      await writeFile(target, next, 'utf8')
    }
  }
  let archived = join(paths.templates, `${LEGACY_CUSTOM_FILE}.migrated`)
  if (await pathExists(archived)) archived = join(paths.templates, `${LEGACY_CUSTOM_FILE}.migrated-${nowStamp()}`)
  await rename(source, archived)
  return { count: items.length, file: archived.split(/[\\/]/).pop() }
}

/* ============================================================================
 * 用户自定义模板（v0.1.2 恢复「添加新模板」能力）
 *
 * 每条有标题、说明、正文与启用开关；启用的条目按列表顺序拼成任务书的
 * 「用户自定义要求」一节。文件与旧版迁移文件分开：
 *   - 新存储：templates/custom-templates.json
 *   - 旧版 templates/custom.json 仍由上面的迁移逻辑一次性并入 analysis.md
 * 这样恢复功能不会把旧数据再迁一次，也不会被迁移逻辑改名。
 * ========================================================================== */

export const CUSTOM_TEMPLATES_FILE = 'custom-templates.json'

function customTemplatesFile(paths) {
  return join(paths.templates, CUSTOM_TEMPLATES_FILE)
}

function normalizeCustomItem(raw) {
  return {
    id: typeof raw?.id === 'string' && raw.id !== '' ? raw.id : `t-${randomUUID().slice(0, 8)}`,
    title: String(raw?.title ?? '').trim(),
    description: String(raw?.description ?? '').trim(),
    content: String(raw?.content ?? ''),
    enabled: raw?.enabled !== false,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

export async function readCustomTemplates(paths) {
  const raw = await readJson(customTemplatesFile(paths), { version: 1, items: [] })
  const items = Array.isArray(raw?.items) ? raw.items : []
  return items.map(normalizeCustomItem)
}

/**
 * Replace the whole custom-template list (the Settings page saves all blocks with
 * one button). Titles are mandatory: an unnamed rule cannot be told apart in the
 * list, and it would become an anonymous paragraph in the prompt.
 */
export async function saveCustomTemplates(paths, items) {
  const next = (Array.isArray(items) ? items : []).map(normalizeCustomItem)
  for (const item of next) {
    if (item.title === '') throw new Error('自定义模板标题不能为空')
  }
  await mkdir(paths.templates, { recursive: true })
  await writeJson(customTemplatesFile(paths), { version: 1, items: next })
  return next
}

/**
 * Render the enabled custom templates as the brief's final section.
 *
 * The description is included on purpose: it states the intent behind the rule, so
 * the model can judge edge cases instead of copying the rule mechanically. This is
 * the format carried over from v0.1.0, kept identical for custom entries.
 */
export function renderCustomSection(items) {
  const enabled = (Array.isArray(items) ? items : [])
    .filter((item) => item.enabled !== false)
    .filter((item) => (item.title ?? '').trim() !== '' || (item.content ?? '').trim() !== '' || (item.description ?? '').trim() !== '')
  if (enabled.length === 0) return ''
  const lines = [
    '## 用户自定义要求',
    '',
    '以下条目由用户在「AI 错题本 → 设置」里维护，按顺序遵守；与其它要求冲突时以本区为准。',
    '',
  ]
  enabled.forEach((item, index) => {
    const title = (item.title ?? '').trim()
    const description = (item.description ?? '').trim()
    const content = (item.content ?? '').trim()
    lines.push(`### ${index + 1}. ${title === '' ? '未命名要求' : title}`)
    if (description !== '') lines.push('', `说明：${description}`)
    if (content !== '') lines.push('', content)
    lines.push('')
  })
  return lines.join('\n').trim()
}
