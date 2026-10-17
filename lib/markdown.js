/**
 * Markdown → HTML for card bodies.
 *
 * Deliberately small and entirely host-side: the card body is transcribed text
 * from a model plus hand edits, so the renderer only needs the subset the card
 * format actually uses (headings, lists, quotes, code, rules, emphasis, links)
 * plus `$…$` / `$$…$$` math.
 *
 * Safety: every text run is HTML-escaped, and the only markup that survives
 * unescaped is what KaTeX itself produced. So `dangerouslySetInnerHTML` on the
 * client is fed output this module fully controls.
 */
import { renderMath } from './math.js'

const PLACEHOLDER = '\u0000M\u0000'

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Inline spans: code, emphasis, links. Input is already escaped. */
function inlineSpans(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, (match, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : '#'
      return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`
    })
}

/**
 * Render one line of text, pulling math out first so that `_`, `*` and `\` inside
 * a formula are never touched by the emphasis or escape passes.
 */
export function renderInline(text, mathSpans) {
  let working = String(text ?? '')
  const claim = (html) => {
    const index = mathSpans.push(html) - 1
    return `${PLACEHOLDER}${index}${PLACEHOLDER}`
  }
  working = working.replace(/\$\$([\s\S]+?)\$\$/g, (match, tex) => claim(renderMath(tex, true) ?? escapeHtml(match)))
  working = working.replace(/\\\[([\s\S]+?)\\\]/g, (match, tex) => claim(renderMath(tex, true) ?? escapeHtml(match)))
  working = working.replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (match, tex) => claim(renderMath(tex, false) ?? escapeHtml(match)))
  working = working.replace(/\\\(([\s\S]+?)\\\)/g, (match, tex) => claim(renderMath(tex, false) ?? escapeHtml(match)))
  return inlineSpans(escapeHtml(working))
}

function restore(html, mathSpans) {
  return html.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (match, index) => mathSpans[Number(index)] ?? '')
}

/**
 * Render a whole card body. Unknown constructs degrade to paragraphs rather than
 * being dropped, so nothing a user typed can silently disappear.
 */
export function renderMarkdown(markdown) {
  const mathSpans = []
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let paragraph = []
  let list = null   // 'ul' | 'ol'
  let quote = []
  let fence = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    out.push(`<p>${paragraph.map((line) => renderInline(line, mathSpans)).join('<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list === null) return
    out.push(`</${list}>`)
    list = null
  }
  const flushQuote = () => {
    if (quote.length === 0) return
    out.push(`<blockquote>${quote.map((line) => renderInline(line, mathSpans)).join('<br>')}</blockquote>`)
    quote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(fence.lines.join('\n'))}</code></pre>`)
        fence = null
      } else {
        fence.lines.push(raw)
      }
      continue
    }

    const fenceOpen = line.match(/^\s*```/)
    if (fenceOpen !== null) {
      flushAll()
      fence = { lines: [] }
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading !== null) {
      flushAll()
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2], mathSpans)}</h${level}>`)
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushAll()
      out.push('<hr>')
      continue
    }

    const quoted = line.match(/^>\s?(.*)$/)
    if (quoted !== null) {
      flushParagraph()
      flushList()
      quote.push(quoted[1])
      continue
    }

    const unordered = line.match(/^\s*[-*+]\s+(.*)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (unordered !== null || ordered !== null) {
      flushParagraph()
      flushQuote()
      const wanted = unordered !== null ? 'ul' : 'ol'
      if (list !== wanted) {
        flushList()
        out.push(`<${wanted}>`)
        list = wanted
      }
      out.push(`<li>${renderInline((unordered ?? ordered)[1], mathSpans)}</li>`)
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(line)
  }

  if (fence !== null) out.push(`<pre><code>${escapeHtml(fence.lines.join('\n'))}</code></pre>`)
  flushAll()
  return restore(out.join('\n'), mathSpans)
}

/** Card front-matter fields worth showing as a header row instead of raw YAML. */
export function renderCardHeader(fields) {
  const chips = []
  if (fields.difficulty !== '') chips.push(fields.difficulty)
  if (fields.verdict === 'wrong') chips.push('错题')
  for (const point of fields.knowledgePoints ?? []) chips.push(point)
  for (const type of fields.errorTypes ?? []) chips.push(type)
  return chips
}
