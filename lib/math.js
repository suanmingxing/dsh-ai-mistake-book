/**
 * Math rendering.
 *
 * KaTeX is vendored into the plugin (`node_modules/katex`) and used in MathML
 * output mode, so no KaTeX stylesheet or font files are needed — the browser
 * renders the MathML natively. A formula KaTeX cannot parse falls back to its
 * source instead of throwing or blanking the card.
 */
import { createRequire } from 'node:module'

let loaded
let failure

function load() {
  if (loaded !== undefined) return loaded
  if (failure !== undefined) return null
  try {
    const require = createRequire(import.meta.url)
    loaded = require('katex')
    return loaded
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    return null
  }
}

/** Whether the vendored KaTeX could be loaded in this deployment. */
export function mathAvailable() {
  return load() !== null
}

export function mathUnavailableReason() {
  load()
  return failure
}

/**
 * Render one TeX string to a bare `<math>` element, or `undefined` when the input
 * is not valid TeX so the caller can fall back to showing the source.
 */
export function renderMath(tex, displayMode = false) {
  const katex = load()
  if (katex === null) return undefined
  const source = String(tex ?? '').trim()
  if (source === '') return undefined
  let html
  try {
    html = katex.renderToString(source, { output: 'mathml', throwOnError: false, displayMode })
  } catch {
    return undefined
  }
  const start = html.indexOf('<math')
  const end = html.lastIndexOf('</math>')
  // A parse failure yields KaTeX's error span instead of MathML; treat it as a miss.
  if (start === -1 || end === -1) return undefined
  return html.slice(start, end + 7)
}
