/**
 * PDF 导出板块的默认设置。
 *
 * 为什么不放进 DSH 的插件 config（config.js）：那份 schema 由 DSH 设置页渲染，
 * 而本插件的编辑入口在自己的「设置」标签里，要写回 config 需要 DSH 的 settings
 * 写接口；板块选择是插件的展示偏好，放一个插件自有的 JSON 更简单也更可控。
 *
 * 文件落在归档根下（`<root>/export-settings.json`），随错题本一起搬家。
 */
import { join } from 'node:path'
import { readJson, writeJson } from './paths.js'

export const EXPORT_SETTINGS_FILE = 'export-settings.json'

/**
 * 一张卡片里可选的板块。`heading` 必须与卡片 Markdown 的 `## 标题` 完全一致；
 * 空字符串代表 `##` 之前的正文（题干）。
 */
export const CARD_SECTIONS = [
  { key: 'stem', heading: '', label: '题干' },
  { key: 'work', heading: '我的作答与过程', label: '我的作答与过程' },
  { key: 'answer', heading: '我标注的正确答案 / 解法', label: '我标注的正确答案 / 解法' },
  { key: 'knowledge', heading: '知识点与技巧', label: '知识点与技巧' },
  { key: 'errorTypes', heading: '错因', label: '错因' },
  { key: 'uncertain', heading: '待人工确认', label: '待人工确认' },
]

/** 默认全开：用户不设置时，导出内容与之前一致。 */
export const DEFAULT_EXPORT_SETTINGS = {
  sections: Object.fromEntries(CARD_SECTIONS.map((section) => [section.key, true])),
  includeSource: true,
  cropToQuestion: true,
}

function settingsFile(paths) {
  return join(paths.root, EXPORT_SETTINGS_FILE)
}

/** 把任意输入收敛成合法设置：缺字段补默认，未知字段丢弃，值强制成布尔。 */
export function normalizeExportSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const sectionsIn = source.sections !== null && typeof source.sections === 'object' ? source.sections : {}
  const sections = {}
  for (const section of CARD_SECTIONS) {
    sections[section.key] = sectionsIn[section.key] === undefined ? DEFAULT_EXPORT_SETTINGS.sections[section.key] : sectionsIn[section.key] !== false
  }
  return {
    sections,
    includeSource: source.includeSource === undefined ? DEFAULT_EXPORT_SETTINGS.includeSource : source.includeSource !== false,
    cropToQuestion: source.cropToQuestion === undefined ? DEFAULT_EXPORT_SETTINGS.cropToQuestion : source.cropToQuestion !== false,
  }
}

export async function readExportSettings(paths) {
  return normalizeExportSettings(await readJson(settingsFile(paths), DEFAULT_EXPORT_SETTINGS))
}

export async function writeExportSettings(paths, input) {
  const settings = normalizeExportSettings(input)
  await writeJson(settingsFile(paths), settings)
  return settings
}

/**
 * 板块标题 → 是否包含。
 *
 * 卡片里可能出现设置里没有的标题（模板被改过、或以后新增板块）。这类标题
 * **默认包含**：宁可多给一栏，也不要把用户没听说过的内容悄悄删掉。
 */
export function sectionIncluded(settings, heading) {
  const section = CARD_SECTIONS.find((entry) => entry.heading === heading)
  if (section === undefined) return true
  return settings.sections[section.key] !== false
}
