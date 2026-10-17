/**
 * Front-matter parsing.
 *
 * The card format is ours, so this reads exactly the subset we emit — quoted
 * scalars, numbers, booleans, null, flow arrays and flow objects — and ignores
 * anything it does not understand instead of throwing. A user hand-editing a card
 * must never be able to make the index rebuild fail.
 */

const QUOTED = /^"((?:[^"\\]|\\.)*)"$/

function unescape(text) {
  return text.replace(/\\(["\\nrt])/g, (match, char) => (char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : char))
}

function splitTopLevel(text, separator) {
  const parts = []
  let depth = 0
  let quoted = false
  let current = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      current += char
      if (char === '\\') {
        current += text[index + 1] ?? ''
        index += 1
      } else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth -= 1
    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/** Parse one scalar, array or inline object. */
export function parseValue(raw) {
  const text = String(raw ?? '').trim()
  if (text === '' || text === 'null' || text === '~') return null
  if (text === 'true') return true
  if (text === 'false') return false
  const quoted = text.match(QUOTED)
  if (quoted !== null) return unescape(quoted[1])
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d*\.\d+$/.test(text)) return Number(text)
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim()
    if (inner === '') return []
    return splitTopLevel(inner, ',').map((part) => parseValue(part)).filter((value) => value !== undefined)
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    const inner = text.slice(1, -1).trim()
    const out = {}
    if (inner === '') return out
    for (const entry of splitTopLevel(inner, ',')) {
      const colon = entry.indexOf(':')
      if (colon === -1) continue
      const key = entry.slice(0, colon).trim().replace(QUOTED, '$1')
      out[key] = parseValue(entry.slice(colon + 1))
    }
    return out
  }
  return text
}

/**
 * Split a Markdown document into its front-matter object and its body.
 * A document without front-matter yields `{ data: {}, body: text }`.
 */
export function parseFrontMatter(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n')
  if (!source.startsWith('---\n')) return { data: {}, body: source, hadFrontMatter: false }
  const end = source.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: source, hadFrontMatter: false }
  const block = source.slice(4, end)
  const rest = source.slice(end + 4).replace(/^\n/, '')
  const data = {}
  for (const line of block.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (key === '') continue
    data[key] = parseValue(line.slice(colon + 1))
  }
  return { data, body: rest, hadFrontMatter: true }
}

/** Strings only, tolerating a scalar where a list was expected. */
export function asStringList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter((entry) => entry !== '')
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()]
  return []
}

/** The card fields the archive and the UI care about, normalized for reading. */
export function readCardFields(data) {
  return {
    id: typeof data.id === 'string' ? data.id : '',
    subject: typeof data.subject === 'string' ? data.subject : '',
    paper: typeof data.paper === 'string' ? data.paper : '',
    questionRef: typeof data.questionRef === 'string' ? data.questionRef : '',
    knowledgePoints: asStringList(data.knowledgePoints),
    skills: asStringList(data.skills),
    errorTypes: asStringList(data.errorTypes),
    difficulty: typeof data.difficulty === 'string' ? data.difficulty : '中',
    verdict: typeof data.verdict === 'string' ? data.verdict : 'wrong',
    basis: typeof data.basis === 'string' ? data.basis : '',
    source: data.source !== null && typeof data.source === 'object' ? data.source : {},
    provenance: data.provenance !== null && typeof data.provenance === 'object' ? data.provenance : {},
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    status: typeof data.status === 'string' ? data.status : '',
  }
}
