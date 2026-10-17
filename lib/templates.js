/**
 * Editable templates.
 *
 * The prompts are data, not code: they live as Markdown files under the archive
 * root so the user can tune how the analysis behaves without touching the plugin,
 * and so a change is visible and diffable.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathExists, readJson, writeJson } from './paths.js'

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

export function templateFile(paths, key) {
  return join(paths.templates, FILES[key].name)
}

/** Write any missing template so the user always has something to edit. */
export async function ensureTemplates(paths) {
  await mkdir(paths.templates, { recursive: true })
  const created = []
  for (const [key, file] of Object.entries(FILES)) {
    const target = templateFile(paths, key)
    if (await pathExists(target)) continue
    await writeFile(target, file.content, 'utf8')
    created.push(file.name)
  }
  return created
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

/** `{{name}}` substitution; unknown placeholders are left visible rather than blanked. */
export function renderTemplate(text, vars) {
  return String(text ?? '').replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match))
}

/* ============================================================================
 * 用户自定义模板
 *
 * 三份内置模板（analysis / background / error-taxonomy）各管一件事，改它们等于
 * 改整个流程。用户往往只是想在提取时多要一条规矩（"保留分数线层级""英语题标注
 * 语法点"），不该为此去动主模板。所以另开一组**附加模板**：
 *   · 每条有标题、说明、正文，可启用/停用、可增删；
 *   · 启用的条目会拼进分析任务书的「用户自定义要求」一节，自动并入提示词；
 *   · 存在 templates/custom.json，随错题本一起搬家。
 * ========================================================================== */

export const CUSTOM_TEMPLATES_FILE = 'custom.json'

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

async function writeCustomTemplates(paths, items) {
  await mkdir(paths.templates, { recursive: true })
  await writeJson(customTemplatesFile(paths), { version: 1, items })
  return items
}

/**
 * 新增或更新一条自定义模板。
 * 不带 id = 新增；带 id = 就地更新（找不到就当新增，避免因为一次误删而丢内容）。
 * 标题为空时拒绝：列表里无法区分，提示词里也会变成无名段落。
 */
export async function saveCustomTemplate(paths, input) {
  const items = await readCustomTemplates(paths)
  const next = normalizeCustomItem({ ...input, updatedAt: new Date().toISOString() })
  if (next.title === '') throw new Error('请先填写模板标题')
  const index = items.findIndex((item) => item.id === (typeof input?.id === 'string' ? input.id : next.id))
  if (index >= 0) items[index] = next
  else items.push(next)
  await writeCustomTemplates(paths, items)
  return { item: next, items }
}

export async function deleteCustomTemplate(paths, id) {
  const items = await readCustomTemplates(paths)
  const target = String(id ?? '')
  const next = items.filter((item) => item.id !== target)
  if (next.length === items.length) throw new Error(`找不到模板：${target}`)
  await writeCustomTemplates(paths, next)
  return { removed: target, items: next }
}

/**
 * 把启用的自定义模板渲染成任务书的一节。
 *
 * 没有启用项时返回空串（调用方据此决定要不要拼进提示词）。说明一并写进去：
 * 它是用户给这条规则写的意图，模型看到它更容易判断边界，而不是机械照抄。
 */
export function renderCustomSection(items) {
  const enabled = (Array.isArray(items) ? items : [])
    .filter((item) => item.enabled !== false)
    .filter((item) => item.title.trim() !== '' || item.content.trim() !== '' || item.description !== '')
  if (enabled.length === 0) return ''
  const lines = [
    '## 用户自定义要求',
    '',
    '以下条目由用户在「AI 错题本 → 设置」里维护，按顺序遵守；与其它要求冲突时以本区为准。',
    '',
  ]
  enabled.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title.trim() === '' ? '未命名模板' : item.title.trim()}`)
    if (item.description !== '') lines.push('', `说明：${item.description}`)
    if (item.content.trim() !== '') lines.push('', item.content.trim())
    lines.push('')
  })
  return lines.join('\n').trim()
}
