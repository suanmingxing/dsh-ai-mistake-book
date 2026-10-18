/**
 * PDF 导出模板设置：六个预设板块 + 用户自定义模板板块。
 *
 * 为什么不放进 DSH 的插件 config（config.js）：那份 schema 由 DSH 设置页渲染，
 * 而本插件的编辑入口在自己的「设置」标签里，要写回 config 需要 DSH 的 settings
 * 写接口；板块选择是插件的展示偏好，放一个插件自有的 JSON 更简单也更可控。
 *
 * 文件落在归档根下（`<root>/export-settings.json`），随错题本一起搬家。
 *
 * 自定义模板（存在 templates/custom-templates.json）在这里被当成「第七个及以后
 * 的板块」：勾选/启用状态在模板自身（enabled），顺序与预设板块统一记在
 * `settings.order` 里，键是 `tpl:<模板 id>`。这样设置页可以用同一张列表排序，
 * 导出时也用同一个目录（catalogue）逐板块渲染。
 */
import { join } from 'node:path'
import { readJson, writeJson } from './paths.js'

export const EXPORT_SETTINGS_FILE = 'export-settings.json'

/** 自定义板块在 order/sections 里的键前缀：`tpl:<模板 id>`。 */
export const CUSTOM_SECTION_PREFIX = 'tpl:'

/**
 * 一张卡片里可选的预设板块。`heading` 必须与卡片 Markdown 的 `## 标题` 完全一致；
 * 空字符串代表 `##` 之前的正文（题干）。`description` 是设置页给用户看的一句话
 * 说明（也是 PDF 模板列表里的小字），不参与导出内容。
 */
export const CARD_SECTIONS = [
  { key: 'stem', heading: '', label: '题干', description: '题目文本的完整转录，含行内公式。' },
  { key: 'work', heading: '我的作答与过程', label: '我的作答与过程', description: '学生在卷面上的作答、划改与页边演算过程。' },
  { key: 'answer', heading: '我标注的正确答案 / 解法', label: '我标注的正确答案 / 解法', description: '学生在卷面上自己标注的正确答案或正确解法。' },
  { key: 'knowledge', heading: '知识点与技巧', label: '知识点与技巧', description: '这道题涉及的知识点与解题技巧。' },
  { key: 'errorTypes', heading: '错因', label: '错因', description: '按错因分类归一后的错误原因。' },
  { key: 'uncertain', heading: '待人工确认', label: '待人工确认', description: '分析模型读不准、需要人工复核的内容。' },
]

/** 六个预设板块的 key（顺序即默认顺序）。 */
export const PRESET_KEYS = CARD_SECTIONS.map((section) => section.key)

/** 自定义模板 id → 它在导出顺序里的键（`tpl:<id>`）。 */
export function customKey(id) {
  return `${CUSTOM_SECTION_PREFIX}${String(id ?? '')}`
}

/** 这个 order 键是不是自定义板块（`tpl:<id>`）。 */
export function isCustomKey(key) {
  return typeof key === 'string' && key.startsWith(CUSTOM_SECTION_PREFIX)
}

/** `tpl:<id>` → `<id>`；不是自定义键时返回空串。 */
export function customIdOf(key) {
  return isCustomKey(key) ? key.slice(CUSTOM_SECTION_PREFIX.length) : ''
}

/** 去空、去重后的自定义模板 id 列表（保持传入顺序）。 */
function cleanCustomIds(customIds) {
  const cleaned = []
  for (const id of Array.isArray(customIds) ? customIds : []) {
    const text = typeof id === 'string' ? id.trim() : ''
    if (text !== '' && !cleaned.includes(text)) cleaned.push(text)
  }
  return cleaned
}

/**
 * 默认设置：六个预设板块全开，顺序为「预设六项 → 自定义板块（按模板列表顺序）」。
 * 自定义板块没有 sections 开关，启用与否由模板自己的 enabled 决定。
 */
export function defaultExportSettings(customIds = []) {
  return {
    sections: Object.fromEntries(CARD_SECTIONS.map((section) => [section.key, true])),
    order: [...PRESET_KEYS, ...cleanCustomIds(customIds).map(customKey)],
    includeSource: true,
    cropToQuestion: true,
  }
}

/**
 * 把任意顺序数组收敛成合法顺序：只保留「预设 key + 已知 tpl:<id>」、去重，
 * 缺失的预设按默认顺序补，缺失的自定义板块按 customIds 顺序补到末尾。
 * 这样旧版（没有 order）、手改坏的文件、以及删掉模板后残留的 tpl 键都能安全落盘。
 */
function normalizeOrder(raw, customIds) {
  const knownCustom = new Set(cleanCustomIds(customIds))
  const order = []
  const push = (key) => {
    if (!order.includes(key)) order.push(key)
  }
  for (const key of Array.isArray(raw) ? raw : []) {
    if (typeof key !== 'string') continue
    if (PRESET_KEYS.includes(key)) {
      push(key)
      continue
    }
    if (isCustomKey(key)) {
      const id = customIdOf(key)
      if (knownCustom.has(id)) push(customKey(id))
    }
  }
  for (const key of PRESET_KEYS) push(key)
  for (const id of knownCustom) push(customKey(id))
  return order
}

function settingsFile(paths) {
  return join(paths.root, EXPORT_SETTINGS_FILE)
}

/**
 * 把任意输入收敛成合法设置：缺字段补默认，未知字段丢弃，值强制成布尔。
 * `customIds` 是当前真实存在的自定义模板 id；order 里指向已删除模板的 `tpl:` 键
 * 会被过滤掉，新模板会补在末尾。
 */
export function normalizeExportSettings(raw, customIds = []) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const defaults = defaultExportSettings(customIds)
  const sectionsIn = source.sections !== null && typeof source.sections === 'object' ? source.sections : {}
  const sections = {}
  for (const section of CARD_SECTIONS) {
    sections[section.key] = sectionsIn[section.key] === undefined
      ? defaults.sections[section.key]
      : sectionsIn[section.key] !== false
  }
  return {
    sections,
    order: normalizeOrder(source.order, customIds),
    includeSource: source.includeSource === undefined ? defaults.includeSource : source.includeSource !== false,
    cropToQuestion: source.cropToQuestion === undefined ? defaults.cropToQuestion : source.cropToQuestion !== false,
  }
}

export async function readExportSettings(paths, customIds = []) {
  return normalizeExportSettings(await readJson(settingsFile(paths), defaultExportSettings(customIds)), customIds)
}

export async function writeExportSettings(paths, input, customIds = []) {
  const settings = normalizeExportSettings(input, customIds)
  await writeJson(settingsFile(paths), settings)
  return settings
}

/**
 * 板块目录：六个预设板块 + 用户自定义模板板块。设置页按这份目录渲染统一列表，
 * 导出按同一份目录逐板块渲染，保证两侧顺序与名称永远一致。
 *
 * 自定义条目带上模板 id 与说明；`heading` 就是卡片里的 `## 标题`（=模板标题）。
 */
export function sectionCatalogue(customItems = []) {
  const catalogue = CARD_SECTIONS.map((section) => ({
    key: section.key,
    kind: 'preset',
    heading: section.heading,
    label: section.label,
    description: section.description,
  }))
  for (const item of Array.isArray(customItems) ? customItems : []) {
    if (item === null || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (id === '') continue
    const title = String(item.title ?? '').trim()
    catalogue.push({
      key: customKey(id),
      kind: 'custom',
      id,
      heading: title,
      label: title,
      description: String(item.description ?? '').trim(),
    })
  }
  return catalogue
}

/**
 * 按 `settings.order` 返回板块目录；目录里存在但 order 没覆盖到的条目追加在末尾。
 * 追加是刻意的：设置文件陈旧或手动删过 order 时，板块不能因此从导出里消失。
 */
export function orderedSections(settings, catalogue = sectionCatalogue()) {
  const entries = Array.isArray(catalogue) ? catalogue : []
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  const order = Array.isArray(settings?.order) && settings.order.length > 0
    ? settings.order
    : entries.map((entry) => entry.key)
  const ordered = []
  const seen = new Set()
  for (const key of order) {
    const entry = byKey.get(key)
    if (entry === undefined || seen.has(key)) continue
    seen.add(key)
    ordered.push(entry)
  }
  for (const entry of entries) {
    if (seen.has(entry.key)) continue
    seen.add(entry.key)
    ordered.push(entry)
  }
  return ordered
}

/**
 * 预设板块标题 → 是否包含。**只用于预设板块**：自定义板块的开关在模板自身的
 * `enabled` 上（见 export.js / sectionCatalogue）。
 *
 * 卡片里可能出现设置里没有的标题（模板被改过、或以后新增板块）。这类标题
 * **默认包含**：宁可多给一栏，也不要把用户没听说过的内容悄悄删掉。
 */
export function sectionIncluded(settings, heading) {
  const section = CARD_SECTIONS.find((entry) => entry.heading === heading)
  if (section === undefined) return true
  return settings.sections[section.key] !== false
}
