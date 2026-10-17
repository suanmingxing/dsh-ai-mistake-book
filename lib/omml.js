/**
 * LaTeX → OMML（Office Math Markup Language）。
 *
 * 为什么不走图片：LibreOffice 引擎在 DSH 里是 **WASM 实现**，kit 的 convert 白名单
 * 拒绝 `svg→png` / `mml→png`，既没有无头浏览器也没有可用的 soffice 二进制；
 * 装 MathJax + 原生 SVG 光栅器又要联网下载并引入 native addon。
 *
 * 而 LibreOffice 的 DOCX 导入**支持 OMML**（实测：同样一页，空文档 0 个深色像素、
 * 6KB PDF；带 OMML 的 920 个深色像素、25KB PDF，且 PDF 内出现 OpenSymbol 字体）。
 * 所以直接把公式写成 Word 原生公式对象，排版交给 LibreOffice，零新增依赖。
 *
 * 解析器只覆盖错题卡里真实出现的写法：分数、根式、上下标、向量箭头、上划线、
 * `\left…\right` 定界符、希腊字母与常用运算符、函数名。未知命令退化成直立文字，
 * 不会让整条公式消失。
 */
import { SYMBOLS } from './latex.js'

const escapeText = (text) => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const escapeAttr = (text) => escapeText(text).replace(/"/g, '&quot;')

const UPRIGHT_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'lg', 'exp', 'max', 'min', 'lim', 'sup', 'inf',
])

const SPACE_COMMANDS = new Set([',', ';', ':', '!', 'quad', 'qquad', 'enspace', 'thinspace'])

class Parser {
  constructor(tex) {
    this.tex = String(tex ?? '')
    this.i = 0
  }

  skipSpace() {
    while (this.i < this.tex.length && /\s/.test(this.tex[this.i])) this.i += 1
  }

  /** 解析到结尾、指定的收尾字符，或（可选）遇到 `\right` 为止。 */
  parseSequence({ stop, stopAtRight = false } = {}) {
    const nodes = []
    for (;;) {
      this.skipSpace()
      if (this.i >= this.tex.length) break
      if (stop !== undefined && this.tex[this.i] === stop) break
      if (stopAtRight && /^\\right\b/.test(this.tex.slice(this.i))) break
      const atom = this.parseAtom()
      if (atom === undefined) {
        this.i += 1
        continue
      }
      nodes.push(this.parseScripts(atom))
    }
    return nodes
  }

  /** `^` / `_` 顺带把 `x_a^b` 合成一个 sSubSup。 */
  parseScripts(base) {
    let node = base
    for (;;) {
      this.skipSpace()
      const symbol = this.tex[this.i]
      if (symbol !== '^' && symbol !== '_') break
      this.i += 1
      const argument = this.parseArgument()
      node = symbol === '^'
        ? { type: 'sup', base: node, sup: argument }
        : { type: 'sub', base: node, sub: argument }
      if (node.type === 'sup' && node.base.type === 'sub') {
        node = { type: 'subsup', base: node.base.base, sub: node.base.sub, sup: node.sup }
      }
    }
    return node
  }

  /** 花括号分组，或单个原子。 */
  parseArgument() {
    this.skipSpace()
    if (this.tex[this.i] === '{') {
      this.i += 1
      const nodes = this.parseSequence({ stop: '}' })
      if (this.tex[this.i] === '}') this.i += 1
      return { type: 'seq', nodes }
    }
    const atom = this.parseAtom()
    return atom ?? { type: 'text', text: '', upright: false }
  }

  parseAtom() {
    this.skipSpace()
    const symbol = this.tex[this.i]
    if (symbol === undefined) return undefined
    if (symbol === '\\') return this.parseCommand()
    if (symbol === '{') {
      this.i += 1
      const nodes = this.parseSequence({ stop: '}' })
      if (this.tex[this.i] === '}') this.i += 1
      return { type: 'seq', nodes }
    }
    if (symbol === '}' || symbol === '^' || symbol === '_') return undefined
    this.i += 1
    return { type: 'text', text: symbol, upright: false }
  }

  parseCommand() {
    const named = /^\\([a-zA-Z]+)/.exec(this.tex.slice(this.i))
    if (named === null) {
      // 转义标点：\{ \% \, …
      const symbol = this.tex[this.i + 1] ?? ''
      this.i += 2
      return { type: 'text', text: SPACE_COMMANDS.has(symbol) ? ' ' : symbol, upright: false }
    }
    const name = named[1]
    this.i += named[0].length

    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': {
        const numerator = this.parseArgument()
        const denominator = this.parseArgument()
        return { type: 'frac', num: numerator, den: denominator }
      }
      case 'sqrt': {
        this.skipSpace()
        let degree
        if (this.tex[this.i] === '[') {
          this.i += 1
          const nodes = this.parseSequence({ stop: ']' })
          if (this.tex[this.i] === ']') this.i += 1
          degree = { type: 'seq', nodes }
        }
        return { type: 'rad', body: this.parseArgument(), degree }
      }
      case 'vec': case 'overrightarrow':
        return { type: 'acc', body: this.parseArgument(), chr: '\u20D7' }
      case 'overline': case 'bar':
        return { type: 'bar', body: this.parseArgument() }
      case 'text': case 'mathrm': case 'operatorname': case 'mbox': {
        this.skipSpace()
        if (this.tex[this.i] !== '{') return { type: 'text', text: '', upright: true }
        let depth = 0
        const start = this.i + 1
        let end = this.i
        for (; end < this.tex.length; end += 1) {
          if (this.tex[end] === '{') depth += 1
          else if (this.tex[end] === '}') {
            depth -= 1
            if (depth === 0) break
          }
        }
        const raw = this.tex.slice(start, end)
        this.i = end + 1
        return { type: 'text', text: raw, upright: true }
      }
      case 'left': {
        this.skipSpace()
        const open = this.tex[this.i] === '.' ? '' : (this.tex[this.i] ?? '')
        this.i += 1
        const nodes = this.parseSequence({ stopAtRight: true })
        this.skipSpace()
        let close = ''
        if (/^\\right\b/.test(this.tex.slice(this.i))) {
          this.i += '\\right'.length
          this.skipSpace()
          close = this.tex[this.i] === '.' ? '' : (this.tex[this.i] ?? '')
          this.i += 1
        }
        return { type: 'delim', beg: open, end: close, nodes }
      }
      case 'right': case 'displaystyle': case 'textstyle': case 'limits': case 'nolimits':
        return { type: 'text', text: '', upright: false }
      default:
        break
    }
    if (SPACE_COMMANDS.has(name)) return { type: 'text', text: ' ', upright: false }
    if (UPRIGHT_FUNCTIONS.has(name)) return { type: 'text', text: name, upright: true }
    if (SYMBOLS[name] !== undefined) return { type: 'text', text: SYMBOLS[name], upright: false }
    // 未知命令：输出命令名而不是丢掉，保持"可读"这条底线。
    return { type: 'text', text: name, upright: true }
  }
}

function renderRun(text, upright) {
  if (text === '') return ''
  const style = upright ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''
  return `<m:r>${style}<m:t xml:space="preserve">${escapeText(text)}</m:t></m:r>`
}

function renderNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map(renderNode).join('')
}

function renderNode(node) {
  if (node === undefined || node === null) return ''
  switch (node.type) {
    case 'text':
      return renderRun(node.text, node.upright === true)
    case 'seq':
      return renderNodes(node.nodes)
    case 'frac':
      return `<m:f><m:num>${renderNode(node.num)}</m:num><m:den>${renderNode(node.den)}</m:den></m:f>`
    case 'rad': {
      const hide = node.degree === undefined ? '<m:degHide m:val="1"/>' : ''
      const degree = node.degree === undefined ? '' : renderNode(node.degree)
      return `<m:rad><m:radPr>${hide}</m:radPr><m:deg>${degree}</m:deg><m:e>${renderNode(node.body)}</m:e></m:rad>`
    }
    case 'sup':
      return `<m:sSup><m:e>${renderNode(node.base)}</m:e><m:sup>${renderNode(node.sup)}</m:sup></m:sSup>`
    case 'sub':
      return `<m:sSub><m:e>${renderNode(node.base)}</m:e><m:sub>${renderNode(node.sub)}</m:sub></m:sSub>`
    case 'subsup':
      return `<m:sSubSup><m:e>${renderNode(node.base)}</m:e><m:sub>${renderNode(node.sub)}</m:sub><m:sup>${renderNode(node.sup)}</m:sup></m:sSubSup>`
    case 'acc':
      return `<m:acc><m:accPr><m:chr m:val="${escapeAttr(node.chr)}"/></m:accPr><m:e>${renderNode(node.body)}</m:e></m:acc>`
    case 'bar':
      return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${renderNode(node.body)}</m:e></m:bar>`
    case 'delim':
      return `<m:d><m:dPr><m:begChr m:val="${escapeAttr(node.beg)}"/><m:endChr m:val="${escapeAttr(node.end)}"/></m:dPr>`
        + `<m:e>${renderNodes(node.nodes)}</m:e></m:d>`
    default:
      return ''
  }
}

/**
 * 把一段 LaTeX 转成 `<m:oMath>` 片段。
 * 解析异常时返回 undefined，调用方据此退回 Unicode 转写。
 */
export function latexToOmml(tex) {
  const source = String(tex ?? '').trim()
  if (source === '') return undefined
  try {
    const nodes = new Parser(source).parseSequence()
    const body = renderNodes(nodes)
    if (body === '') return undefined
    return `<m:oMath>${body}</m:oMath>`
  } catch {
    return undefined
  }
}
