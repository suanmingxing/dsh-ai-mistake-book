/**
 * Normalization: turn whatever the model extracted into one canonical shape.
 *
 * Everything here is deterministic and idempotent. The model is asked to do the
 * reading; deciding what a knowledge point is *called*, how a card is named, and
 * what counts as a valid error type is the plugin's job, so the archive stays
 * consistent no matter how the model phrases things on a given day.
 */

/** Strip the delimiters a model tends to wrap around inline LaTeX. */
export function cleanMath(value) {
  if (typeof value !== 'string') return ''
  let text = value.trim()
  if (text === '') return ''
  text = text.replace(/^\\\[([\s\S]*)\\\]$/, '$1')
  text = text.replace(/^\\\(([\s\S]*)\\\)$/, '$1')
  if (text.length > 3 && text.startsWith('$$') && text.endsWith('$$')) text = text.slice(2, -2)
  else if (text.length > 2 && text.startsWith('$') && text.endsWith('$') && !text.slice(1, -1).includes('$')) text = text.slice(1, -1)
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Plain text fields: collapse runaway whitespace but keep the author's line breaks. */
export function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Knowledge points are multi-level paths such as "函数/函数的单调性".
 * Levels are trimmed, empties dropped, and duplicates merged case-insensitively.
 */
export function normalizeKnowledgePoints(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const levels = raw.split(/[/>›·]+/).map((level) => cleanText(level).replace(/\s+/g, ' ')).filter((level) => level !== '')
    if (levels.length === 0) continue
    const point = levels.join('/')
    const key = point.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(point)
  }
  return out
}

/** The first level of a knowledge point, used for the top of the index tree. */
export function topLevelOf(point) {
  const cut = String(point ?? '').indexOf('/')
  return cut === -1 ? String(point ?? '') : String(point).slice(0, cut)
}

const DIFFICULTY_ALIASES = new Map([
  ['易', '易'], ['简单', '易'], ['基础', '易'], ['容易', '易'], ['easy', '易'], ['low', '易'],
  ['中', '中'], ['中等', '中'], ['一般', '中'], ['medium', '中'], ['normal', '中'],
  ['难', '难'], ['较难', '难'], ['困难', '难'], ['hard', '难'], ['high', '难'],
])

export function normalizeDifficulty(value) {
  const text = cleanText(value).toLowerCase()
  if (text === '') return '中'
  if (DIFFICULTY_ALIASES.has(text)) return DIFFICULTY_ALIASES.get(text)
  if (text.includes('易') || text.includes('简单')) return '易'
  if (text.includes('难')) return '难'
  return '中'
}

/**
 * Match an error type against the configured taxonomy. Unknown labels are kept
 * (the archive should not silently discard the model's judgement) but reported,
 * so the user can extend the taxonomy in templates/error-taxonomy.md.
 */
export function normalizeErrorTypes(value, taxonomy = []) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const canonical = taxonomy.map((entry) => cleanText(entry)).filter((entry) => entry !== '')
  const lookup = new Map(canonical.map((entry) => [entry.toLowerCase(), entry]))
  const kept = []
  const unknown = []
  for (const raw of list) {
    const text = cleanText(raw).replace(/[（(].*?[)）]/g, '').trim()
    if (text === '') continue
    const exact = lookup.get(text.toLowerCase())
    if (exact !== undefined) {
      if (!kept.includes(exact)) kept.push(exact)
      continue
    }
    const partial = canonical.find((entry) => text.includes(entry) || entry.includes(text))
    if (partial !== undefined) {
      if (!kept.includes(partial)) kept.push(partial)
      continue
    }
    if (!unknown.includes(text)) unknown.push(text)
    if (!kept.includes(text)) kept.push(text)
  }
  return { errorTypes: kept, unknown }
}

/** Parse the taxonomy template: one label per line, `#` comments and bullets ignored. */
export function parseTaxonomy(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*+]\s*/, '').replace(/#.*$/, '').trim())
    .map((line) => line.replace(/[：:]\s*$/, ''))
    .filter((line) => line !== '')
}

/** A question reference that is stable enough to use as a key: "8", "Q8", "第8题" all -> "8". */
export function normalizeRef(value) {
  const text = cleanText(value)
  const digits = text.match(/\d+/g)
  if (digits !== null && digits.length > 0) return digits.join('.')
  return text.toLowerCase().replace(/\s+/g, '')
}

/** Parse the user's reported question numbers out of the /mistake hint. */
export function parseReportedRefs(hint) {
  const text = cleanText(hint)
  if (text === '') return []
  const matches = text.match(/\d+\s*(?:[、,，\-–~到至]\s*\d+)*/g)
  if (matches === null) return []
  const refs = new Set()
  for (const match of matches) {
    const numbers = match.match(/\d+/g) ?? []
    for (const number of numbers) refs.add(String(Number(number)))
  }
  return [...refs]
}

/** Normalize a model-supplied source locator into what the card stores. */
export function normalizeSource(value, fallbackPage) {
  const source = value ?? {}
  const number = (input) => (Number.isFinite(Number(input)) ? Number(input) : undefined)
  return {
    page: number(source.page) ?? fallbackPage,
    band: number(source.band),
    cell: number(source.cell),
    note: cleanText(source.note),
  }
}

/**
 * Extra sections the model produced for the user's custom PDF templates.
 *
 * Only enabled templates are accepted, matched by title (case/space-insensitive);
 * entries keep the template's canonical title so the card/PDF heading matches the
 * configured section exactly. Unknown titles are reported, not silently kept.
 */
export function normalizeCustomSections(value, customTemplates = []) {
  const templates = (Array.isArray(customTemplates) ? customTemplates : [])
    .filter((item) => item !== null && typeof item === 'object' && item.enabled !== false)
    .filter((item) => String(item.title ?? '').trim() !== '')
  const byTitle = new Map(templates.map((item) => [String(item.title).trim().toLowerCase(), item]))
  const customSections = []
  const unknown = []
  for (const raw of Array.isArray(value) ? value : []) {
    const title = cleanText(raw?.title)
    const template = byTitle.get(title.toLowerCase())
    if (template === undefined) {
      if (title !== '') unknown.push(title)
      continue
    }
    if (customSections.some((entry) => entry.id === template.id)) continue
    customSections.push({
      id: template.id,
      title: String(template.title).trim(),
      content: cleanText(raw?.content),
    })
  }
  return { customSections, unknown }
}

/** Normalize one staged candidate. */
export function normalizeCandidate(raw, { taxonomy = [], fallbackPage, customTemplates = [] } = {}) {
  const errors = normalizeErrorTypes(raw?.errorTypes, taxonomy)
  const custom = normalizeCustomSections(raw?.extraSections, customTemplates)
  return {
    ref: normalizeRef(raw?.ref),
    refLabel: cleanText(raw?.ref) || `Q${normalizeRef(raw?.ref)}`,
    page: normalizeSource(raw?.source, fallbackPage).page,
    source: normalizeSource(raw?.source, fallbackPage),
    wrong: raw?.wrong !== false,
    basis: cleanText(raw?.basis),
    stem: cleanMath(raw?.stem),
    myAnswer: cleanMath(raw?.myAnswer),
    myAnswerStruck: raw?.myAnswerStruck === true,
    revisedAnswer: cleanMath(raw?.revisedAnswer),
    myWork: cleanText(raw?.myWork),
    annotatedAnswer: cleanMath(raw?.annotatedAnswer),
    annotatedMethod: cleanText(raw?.annotatedMethod),
    knowledgePoints: normalizeKnowledgePoints(raw?.knowledgePoints),
    skills: normalizeKnowledgePoints(raw?.skills),
    errorTypes: errors.errorTypes,
    unknownErrorTypes: errors.unknown,
    difficulty: normalizeDifficulty(raw?.difficulty),
    uncertain: (Array.isArray(raw?.uncertain) ? raw.uncertain : []).map((item) => ({
      what: cleanText(item?.what),
      where: cleanText(item?.where),
      blocking: item?.blocking === true,
    })).filter((item) => item.what !== '' || item.where !== ''),
    confidence: Number.isFinite(Number(raw?.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : undefined,
    customSections: custom.customSections,
    unknownCustomSections: custom.unknown,
  }
}
