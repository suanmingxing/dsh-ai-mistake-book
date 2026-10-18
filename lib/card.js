/**
 * Card rendering: one wrong question becomes one Markdown file whose YAML
 * front-matter is the machine source of truth and whose body is the note a human
 * reads. The index is rebuilt from front-matter alone, so hand-editing a body can
 * never break the archive.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanText, topLevelOf } from './normalize.js'
import { pathExists, slugify } from './paths.js'

/** YAML scalar: double-quoted with backslash escapes, which both YAML and JSON accept. */
function yamlScalar(value) {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value)
  if (text === '') return '""'
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function yamlList(values) {
  return `[${values.map((value) => serializeValue(value)).join(', ')}]`
}

function section(title, body) {
  const text = cleanText(body)
  if (text === '') return ''
  return `## ${title}\n\n${text}\n`
}

function bullets(label, values) {
  if (values.length === 0) return ''
  return `**${label}**\n\n${values.map((value) => `- ${value}`).join('\n')}\n`
}

/**
 * Human-readable body. Sections the scan did not provide are omitted rather than
 * filled with invented content — the whole point of this plugin is to organize
 * what the student actually wrote.
 */
export function renderCardBody(candidate) {
  const parts = []
  parts.push(`# 题干\n\n${cleanText(candidate.stem) || '_（未能从卷面读出题干）_'}\n`)

  if (candidate.myAnswer !== '' || candidate.myWork !== '' || candidate.revisedAnswer !== '') {
    const lines = []
    if (candidate.myAnswer !== '') {
      lines.push(candidate.myAnswerStruck
        ? `原作答（已被划改）：$${candidate.myAnswer}$`
        : `我的作答：$${candidate.myAnswer}$`)
    }
    if (candidate.revisedAnswer !== '') lines.push(`划改后：$${candidate.revisedAnswer}$`)
    if (candidate.myWork !== '') lines.push(`\n页边演算：\n\n${candidate.myWork}`)
    parts.push(section('我的作答与过程', lines.join('\n')))
  }

  const annotated = []
  if (candidate.annotatedAnswer !== '') annotated.push(`正确答案（卷面标注）：$${candidate.annotatedAnswer}$`)
  if (candidate.annotatedMethod !== '') annotated.push(`\n解法 / 技巧（卷面标注）：\n\n${candidate.annotatedMethod}`)
  parts.push(section('我标注的正确答案 / 解法', annotated.length === 0 ? '_（卷面未标注）_' : annotated.join('\n')))

  const knowledge = []
  if (candidate.knowledgePoints.length > 0) knowledge.push(`知识点：${candidate.knowledgePoints.join('；')}`)
  if (candidate.skills.length > 0) knowledge.push(`技巧：${candidate.skills.join('；')}`)
  if (knowledge.length > 0) parts.push(`## 知识点与技巧\n\n${knowledge.join('\n')}\n`)

  parts.push(section('错因', candidate.errorTypes.map((type) => `- ${type}`).join('\n')))

  if (candidate.uncertain.length > 0) {
    parts.push(`## 待人工确认\n\n${candidate.uncertain.map((item) => {
      const where = item.where === '' ? '' : `（${item.where}）`
      return `- ${item.what}${where}${item.blocking ? ' **— 阻断归档**' : ''}`
    }).join('\n')}\n`)
  }

  if (candidate.unknownErrorTypes.length > 0) {
    parts.push(`> 错因分类模板中没有：${candidate.unknownErrorTypes.join('、')}。可在 \`templates/error-taxonomy.md\` 里补充。\n`)
  }

  // 自定义板块：用户在 PDF 模板里新增的板块，模型按任务书说明产出内容。
  for (const custom of Array.isArray(candidate.customSections) ? candidate.customSections : []) {
    const title = cleanText(custom?.title)
    const text = cleanText(custom?.content)
    if (title === '' || text === '') continue
    parts.push(`## ${title}\n\n${text}\n`)
  }

  return parts.filter((part) => part !== '').join('\n')
}

/** Stable key order, so re-rendering an edited card does not reshuffle its head. */
const FRONT_MATTER_ORDER = [
  'id', 'subject', 'paper', 'questionRef',
  'knowledgePoints', 'topKnowledgePoint', 'skills', 'customSections', 'errorTypes',
  'difficulty', 'verdict', 'basis', 'source', 'provenance',
  'createdAt', 'archivedAt', 'status', 'review',
]

function serializeValue(value) {
  if (Array.isArray(value)) return yamlList(value)
  if (value !== null && typeof value === 'object') {
    // Recurse: a member may itself be a list (review.attempts) or a nested object.
    return `{ ${Object.entries(value).map(([key, member]) => `${key}: ${serializeValue(member)}`).join(', ')} }`
  }
  return yamlScalar(value)
}

/**
 * Render an arbitrary front-matter record. Used when re-rendering an edited card,
 * where the data came back from disk rather than from a candidate object.
 */
export function renderFrontMatterData(data) {
  const lines = ['---']
  const written = new Set()
  for (const key of FRONT_MATTER_ORDER) {
    if (data[key] === undefined) continue
    written.add(key)
    lines.push(`${key}: ${serializeValue(data[key])}`)
  }
  for (const [key, value] of Object.entries(data)) {
    if (written.has(key) || value === undefined) continue
    lines.push(`${key}: ${serializeValue(value)}`)
  }
  lines.push('---')
  return lines.join('\n')
}

/** YAML front-matter block. */
export function renderCardFrontMatter(card) {
  return renderFrontMatterData({
    id: card.id,
    subject: card.subject,
    paper: card.paper,
    questionRef: card.questionRef,
    knowledgePoints: card.knowledgePoints,
    topKnowledgePoint: card.knowledgePoints.length > 0 ? topLevelOf(card.knowledgePoints[0]) : undefined,
    skills: card.skills,
    customSections: Array.isArray(card.customSections) && card.customSections.length > 0
      ? card.customSections.map((entry) => ({ id: entry.id, title: entry.title }))
      : undefined,
    errorTypes: card.errorTypes,
    difficulty: card.difficulty,
    verdict: card.verdict,
    basis: card.basis,
    source: { page: card.source.page ?? null, band: card.source.band ?? null, cell: card.source.cell ?? null, note: card.source.note ?? '' },
    provenance: card.provenance,
    createdAt: card.createdAt,
    status: card.status,
    review: { nextReviewAt: null, attempts: [] },
  })
}

/** File name from the configured pattern; every placeholder is sanitized into a valid name. */
export function cardFileName(pattern, card) {
  const firstKnowledge = card.knowledgePoints[0] ?? ''
  const values = {
    id: card.id,
    ref: card.questionRef,
    subject: card.subject,
    kp1: firstKnowledge.split('/').pop() ?? '',
    kpFull: firstKnowledge.replace(/\//g, '-'),
    paper: card.paper,
    difficulty: card.difficulty,
  }
  let name = String(pattern ?? '{id} {kp1}')
  for (const [key, value] of Object.entries(values)) {
    name = name.split(`{${key}}`).join(String(value ?? ''))
  }
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()
  if (name === '' || name === '.md') name = card.id
  if (!name.toLowerCase().endsWith('.md')) name = `${name}.md`
  return name.slice(0, 150)
}

/** Full card file content. */
export function renderCard(card) {
  return `${renderCardFrontMatter(card)}\n${renderCardBody(card)}\n`
}

/** Subject key used for both the directory and the card id prefix. */
export function subjectKey(value) {
  const text = cleanText(value).toLowerCase()
  if (text === '' ) return 'math'
  const map = { 数学: 'math', math: 'math', 英语: 'english', english: 'english', 英文: 'english' }
  return map[text] ?? slugify(text, 'math', 24).toLowerCase()
}

const ID_PREFIX = { math: 'M', english: 'E' }

export function idPrefixFor(subject) {
  return ID_PREFIX[subject] ?? subject.slice(0, 1).toUpperCase()
}

/**
 * Next free card id for a subject, derived from the archive itself rather than a
 * counter file, so the numbers survive a hand-edited or partially deleted library.
 */
export async function nextCardId(libraryRoot, subject, reserved = []) {
  const prefix = idPrefixFor(subject)
  const base = join(libraryRoot, subject)
  const used = new Set(reserved)
  if (await pathExists(base)) {
    for (const paper of await readdir(base, { withFileTypes: true })) {
      if (!paper.isDirectory()) continue
      const cardsDir = join(base, paper.name, 'cards')
      if (!(await pathExists(cardsDir))) continue
      for (const file of await readdir(cardsDir)) {
        const match = file.match(new RegExp(`^${prefix}-(\\d+)`))
        if (match !== null) used.add(Number(match[1]))
      }
      // Draft cards carry their id in front-matter; read it so a re-run does not reuse numbers.
      for (const file of await readdir(cardsDir)) {
        if (!file.endsWith('.md')) continue
        try {
          const head = (await readFile(join(cardsDir, file), 'utf8')).slice(0, 400)
          const match = head.match(new RegExp(`id:\\s*"${prefix}-(\\d+)"`))
          if (match !== null) used.add(Number(match[1]))
        } catch {
          /* unreadable card does not block numbering */
        }
      }
    }
  }
  let next = 1
  while (used.has(next)) next += 1
  return `${prefix}-${String(next).padStart(4, '0')}`
}
