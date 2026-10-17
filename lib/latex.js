/**
 * LaTeX → readable Unicode text.
 *
 * The PDF route goes through LibreOffice, which cannot consume the MathML that
 * KaTeX produces for the on-screen view, and there is no headless browser here to
 * rasterize formulas. So formulas are transliterated: Greek letters, operators,
 * fractions, roots, and super/subscripts become the characters a teacher would
 * write. Anything unrecognised degrades to its own name rather than to backslashes,
 * and `\frac`/`\sqrt` keep explicit brackets so the structure survives.
 */

export const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', equiv: '≡',
  approx: '≈', sim: '∼', propto: '∝', in: '∈', notin: '∉', ni: '∋',
  subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  setminus: '∖', emptyset: '∅', varnothing: '∅', infty: '∞',
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  angle: '∠', perp: '⊥', parallel: '∥', triangle: '△', square: '□', circ: '∘',
  degree: '°', sum: '∑', prod: '∏', int: '∫', oint: '∮', partial: '∂',
  nabla: '∇', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  therefore: '∴', because: '∵', ldots: '…', cdots: '⋯', dots: '…',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': '', ':': ' ',
}

const SUPERSCRIPTS = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' }
const SUBSCRIPTS = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' }

/** Read a `{...}` group (or a single token) starting at `from`. */
function readGroup(text, from) {
  let index = from
  while (index < text.length && /\s/.test(text[index])) index += 1
  if (text[index] !== '{') {
    // A bare token: one command or one character.
    if (text[index] === '\\') {
      const match = /^\\[a-zA-Z]+/.exec(text.slice(index))
      if (match !== null) return { value: match[0], next: index + match[0].length }
    }
    return { value: text[index] ?? '', next: index + 1 }
  }
  let depth = 0
  const start = index + 1
  for (; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return { value: text.slice(start, index), next: index + 1 }
    }
  }
  return { value: text.slice(start), next: text.length }
}

/** Whole-script values that have a dedicated character rather than a raised form. */
const SCRIPT_SPECIAL = { '∘': '°' }

function toScript(content, table, marker) {
  const trimmed = content.trim()
  if (SCRIPT_SPECIAL[trimmed] !== undefined) return SCRIPT_SPECIAL[trimmed]
  let out = ''
  for (const character of trimmed) {
    if (table[character] === undefined) return `${marker}(${trimmed})`
    out += table[character]
  }
  return out
}

/** Only bracket a fraction operand when it is not already a single atom. */
function operand(value) {
  const trimmed = value.trim()
  if (/^[A-Za-z0-9α-ωΑ-Ω]+$/u.test(trimmed)) return trimmed
  if (/^\(.*\)$/u.test(trimmed)) return trimmed
  return `(${trimmed})`
}

export function latexToText(input) {
  let text = String(input ?? '')
  let out = ''
  let index = 0

  while (index < text.length) {
    const character = text[index]

    if (character === '\\') {
      // No whitespace is consumed after the name: `a \le b` must keep its spaces,
      // otherwise the transliteration reads as `a ≤b`. Commands that take arguments
      // skip whitespace inside readGroup anyway.
      const name = /^\\([a-zA-Z]+)/.exec(text.slice(index))
      if (name !== null) {
        const command = name[1]
        let cursor = index + name[0].length
        if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
          const numerator = readGroup(text, cursor)
          const denominator = readGroup(text, numerator.next)
          out += `${operand(latexToText(numerator.value))}/${operand(latexToText(denominator.value))}`
          index = denominator.next
          continue
        }
        if (command === 'sqrt') {
          const body = readGroup(text, cursor)
          out += `√(${latexToText(body.value)})`
          index = body.next
          continue
        }
        if (command === 'text' || command === 'mathrm' || command === 'operatorname' || command === 'mbox') {
          const body = readGroup(text, cursor)
          out += latexToText(body.value)
          index = body.next
          continue
        }
        if (command === 'overline' || command === 'bar') {
          const body = readGroup(text, cursor)
          out += `${latexToText(body.value)}̄`
          index = body.next
          continue
        }
        if (command === 'vec' || command === 'overrightarrow') {
          const body = readGroup(text, cursor)
          out += `${latexToText(body.value)}→`
          index = body.next
          continue
        }
        if (command === 'left' || command === 'right' || command === 'displaystyle' || command === 'limits') {
          index = cursor
          continue
        }
        if (SYMBOLS[command] !== undefined) {
          out += SYMBOLS[command]
          index = cursor
          continue
        }
        // Unknown command: keep the name so nothing silently vanishes.
        out += command
        index = cursor
        continue
      }
      // Escaped punctuation such as `\{` or `\%`.
      out += text[index + 1] ?? ''
      index += 2
      continue
    }

    if (character === '^' || character === '_') {
      const group = readGroup(text, index + 1)
      out += toScript(latexToText(group.value), character === '^' ? SUPERSCRIPTS : SUBSCRIPTS, character)
      index = group.next
      continue
    }

    if (character === '{' || character === '}') {
      index += 1
      continue
    }

    out += character
    index += 1
  }

  return out.replace(/\s{2,}/g, ' ').trim()
}

/** 字符是否属于「一段数学表达式」的组成部分（不含汉字与全角标点）。 */
const MATH_CHAR = /[0-9A-Za-z+\-*/=<>()\[\]|,.:;!^_{}\\′'√±≤≥≠≈∞·×÷∈∉⊂⊆∪∩∅→←↔⇒⇔∠△∥⊥°%]/

function isMathChar(character) {
  return character !== undefined && MATH_CHAR.test(character)
}

/**
 * 扫出「裸 LaTeX 片段」：以 `\命令` 为锚点，向前吃掉紧邻的数学字符（`1-2t`），
 * 向后吃到汉字、全角标点或句读为止。返回互不重叠的区间。
 *
 * 为什么要扫而不是整行转写：整行转写会把正文里的 `{`、`}` 当成分组符号删掉，
 * 也会把英文里的 `_` 当角标。只转真正属于表达式的片段，正文才不会被误伤。
 */
function bareMathRanges(text) {
  const ranges = []
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\') continue
    if (!/[a-zA-Z]/.test(text[index + 1] ?? '')) continue
    let start = index
    while (start > 0 && isMathChar(text[start - 1])) start -= 1
    let end = index
    let depth = 0
    while (end < text.length) {
      const character = text[end]
      if (character === '\\') {
        end += 1
        while (end < text.length && /[a-zA-Z]/.test(text[end])) end += 1
        continue
      }
      if (character === '{') { depth += 1; end += 1; continue }
      if (character === '}') { if (depth > 0) depth -= 1; end += 1; continue }
      if (depth > 0) { end += 1; continue }
      if (isMathChar(character)) { end += 1; continue }
      // `a \le b`：空白后面仍是数学字符时，属于同一个表达式
      if (/\s/.test(character)) {
        let cursor = end
        while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1
        if (cursor < text.length && isMathChar(text[cursor])) { end = cursor; continue }
      }
      break
    }
    if (end <= start) continue
    const previous = ranges[ranges.length - 1]
    if (previous !== undefined && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else ranges.push([start, end])
    index = end - 1
  }
  return ranges
}

function replaceBareMath(text) {
  const ranges = bareMathRanges(text)
  if (ranges.length === 0) return text
  let out = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    out += text.slice(cursor, start)
    out += latexToText(text.slice(start, end))
    cursor = end
  }
  return out + text.slice(cursor)
}

/**
 * 裸的 `x^{2}` / `x_{1}`（没有反斜杠、也没被上一步的片段吃掉）。
 * 只认带花括号的形式：`foo_bar` 这类下划线标识符不能被当成角标。
 */
function replaceLooseScripts(text) {
  return String(text ?? '')
    .replace(/([0-9A-Za-zα-ωΑ-Ω)\]}])\^\{([^{}]+)\}/g, (match, base, body) => base + toScript(latexToText(body), SUPERSCRIPTS, '^'))
    .replace(/([0-9A-Za-zα-ωΑ-Ω)\]}])\_\{([^{}]+)\}/g, (match, base, body) => base + toScript(latexToText(body), SUBSCRIPTS, '_'))
}

/**
 * Replace `$…$` and `$$…$$` inside a text run with readable math, leaving the rest
 * of the prose untouched.
 *
 * 卡片的 Markdown 里，行内公式**默认不带定界符**（任务书就是这么要求的），
 * 例如 `则 \\cos\\alpha-\\sin\\alpha 的值为`。所以只处理 `$…$` 是不够的：
 * 裸 LaTeX 会原样漏到 PDF 里，读出来就是 `frac{1}{2}`、`vec{a}`。这里先处理
 * 带定界符的，再用片段扫描把裸 LaTeX 也交给同一套转写器。
 */
export function mathToText(text) {
  let out = String(text ?? '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (match, body) => ` ${latexToText(body)} `)
    .replace(/\\\[([\s\S]+?)\\\]/g, (match, body) => ` ${latexToText(body)} `)
    .replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (match, body) => latexToText(body))
    .replace(/\\\(([\s\S]+?)\\\)/g, (match, body) => latexToText(body))
  // 裸 LaTeX 片段（卡片默认写法）
  out = replaceBareMath(out)
  // 没有反斜杠的裸脚本：t^{2} / x_1
  out = replaceLooseScripts(out)
  // 兜底：仍残留的单条命令不要让读者看到反斜杠
  out = out.replace(/\\([a-zA-Z]+)/g, (match, command) => (SYMBOLS[command] !== undefined ? SYMBOLS[command] : command))
  return out.replace(/[ \t]{2,}/g, ' ')
}

/**
 * 把一行文本切成「正文 / 数学」片段，供 OMML 路线使用。
 *
 * 正文照旧写成文字，数学片段交给 `latexToOmml()` 变成 Word 原生公式。
 * 定界符（`$…$` / `$$…$$` / `\(…\)` / `\[…\]`）与裸 LaTeX 都支持——
 * 卡片默认写裸的。
 *
 * @returns {Array<{ kind: 'text'|'math', text: string }>}
 */
export function mathSegments(line) {
  const source = String(line ?? '')
  const pieces = []
  const pushText = (text) => {
    if (text === '') return
    const last = pieces[pieces.length - 1]
    if (last !== undefined && last.kind === 'text') last.text += text
    else pieces.push({ kind: 'text', text })
  }
  const pushMath = (tex) => {
    const trimmed = tex.trim()
    if (trimmed !== '') pieces.push({ kind: 'math', text: trimmed })
  }
  // 裸 LaTeX：逐个区间切出来，区间之间是正文。
  const flushBare = (text) => {
    let rest = text
    let guard = 0
    while (rest !== '' && guard < 500) {
      guard += 1
      const ranges = bareMathRanges(rest)
      if (ranges.length === 0) {
        pushText(rest)
        return
      }
      const [start, end] = ranges[0]
      pushText(rest.slice(0, start))
      pushMath(rest.slice(start, end))
      rest = rest.slice(end)
    }
    if (rest !== '') pushText(rest)
  }

  const delimited = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|(?<!\\)\$[^$\n]+?(?<!\\)\$|\\\([\s\S]+?\\\)/g
  let cursor = 0
  let match
  while ((match = delimited.exec(source)) !== null) {
    const raw = match[0]
    const inner = raw.startsWith('$$') || raw.startsWith('\\[') || raw.startsWith('\\(')
      ? raw.slice(2, -2)
      : raw.slice(1, -1)
    const before = source.slice(cursor, match.index)
    if (before !== '') flushBare(before)
    pushMath(inner)
    cursor = match.index + raw.length
  }
  const tail = source.slice(cursor)
  if (tail !== '') flushBare(tail)
  return pieces
}
