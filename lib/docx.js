/**
 * Minimal DOCX writer.
 *
 * The PDF export runs through the bundled LibreOffice engine, which accepts Office
 * documents but not HTML, so the printable document is assembled as OOXML here. The
 * output is a plain, valid WordprocessingML package: a body of paragraphs, headings
 * and inline PNG images, A4 page setup, and a CJK-capable default font.
 */
import { createZip } from './zip.js'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'

/** A4 in twips, with 2 cm margins, and the usable width in EMU for images. */
const PAGE = { width: 11906, height: 16838, margin: 1134 }
const CONTENT_EMU = Math.round(((PAGE.width - PAGE.margin * 2) / 1440) * 914400)

export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not legal in XML 1.0 and would make the package invalid.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/** PNG pixel size from the IHDR chunk — no full decode needed. */
export function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return undefined
  if (buffer.readUInt32BE(0) !== 0x89504e47) return undefined
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width === 0 || height === 0) return undefined
  return { width, height }
}

function run(text, options = {}) {
  const properties = [
    options.bold === true ? '<w:b/>' : '',
    options.size === undefined ? '' : `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`,
    options.color === undefined ? '' : `<w:color w:val="${options.color}"/>`,
  ].join('')
  const rPr = properties === '' ? '' : `<w:rPr>${properties}</w:rPr>`
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

function paragraph(text, options = {}) {
  const style = options.style === undefined ? '' : `<w:pStyle w:val="${options.style}"/>`
  const spacing = options.spacing === undefined ? '' : `<w:spacing w:before="${options.spacing[0]}" w:after="${options.spacing[1]}"/>`
  const border = options.topBorder === true
    ? '<w:pBdr><w:top w:val="single" w:sz="6" w:space="6" w:color="BBBBBB"/></w:pBdr>'
    : ''
  const pPr = style === '' && spacing === '' && border === '' ? '' : `<w:pPr>${style}${spacing}${border}</w:pPr>`
  if (text === '') return `<w:p>${pPr}</w:p>`
  return `<w:p>${pPr}${run(text, options)}</w:p>`
}

function imageParagraph(relId, index, width, height, caption) {
  const emu = (pixels) => Math.round((pixels / 96) * 914400)
  const scale = Math.min(1, CONTENT_EMU / emu(width))
  const cx = Math.round(emu(width) * scale)
  const cy = Math.round(emu(height) * scale)
  const drawing = [
    '<w:r><w:drawing>',
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`,
    `<wp:docPr id="${index}" name="Picture ${index}"/>`,
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>`,
    `<pic:nvPicPr><pic:cNvPr id="${index}" name="image${index}.png"/><pic:cNvPicPr/></pic:nvPicPr>`,
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`,
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>',
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>',
  ].join('')
  const captionRun = caption === undefined ? '' : paragraph(caption, { size: 16, color: '777777' })
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${drawing}</w:p>${captionRun}`
}

/**
 * 一段正文里可以混排文字与 Word 原生公式。
 *
 * `runs` 的每一项要么是 `{ text }`（普通文字），要么是 `{ omml }`
 * （`<m:oMath>…</m:oMath>`，来自 lib/omml.js）。OMML 必须与 `<w:r>` 平级
 * 直接挂在 `<w:p>` 下，所以这里不能把它塞进某一个 run 里面。
 */
function richParagraph(runs) {
  const body = (runs ?? []).map((part) => (
    typeof part?.omml === 'string' ? part.omml : run(String(part?.text ?? ''))
  )).join('')
  return `<w:p>${body}</w:p>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun" w:cs="Times New Roman"/>
<w:sz w:val="21"/><w:szCs w:val="21"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style>
</w:styles>`

/**
 * Build a DOCX package.
 *
 * @param {{ title?: string, blocks: Array<object> }} document
 *   Blocks: `{ kind: 'title'|'heading'|'subheading'|'text'|'quote'|'rule'|'image'|'pagebreak', ... }`.
 * @returns {Buffer}
 */
export function buildDocx(document) {
  const media = []
  const rels = [`<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>`]
  const paragraphs = []

  if (typeof document.title === 'string' && document.title !== '') {
    paragraphs.push(paragraph(document.title, { style: 'Title' }))
  }

  for (const block of document.blocks ?? []) {
    switch (block.kind) {
      case 'title':
        paragraphs.push(paragraph(block.text, { style: 'Title' }))
        break
      case 'heading':
        paragraphs.push(paragraph(block.text, { style: 'Heading1', topBorder: paragraphs.length > 0 }))
        break
      case 'subheading':
        paragraphs.push(paragraph(block.text, { style: 'Heading2' }))
        break
      case 'quote':
        paragraphs.push(paragraph(block.text, { style: 'Quote' }))
        break
      case 'rich':
        paragraphs.push(richParagraph(block.runs))
        break
      case 'rule':
        paragraphs.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`)
        break
      case 'pagebreak':
        paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        break
      case 'image': {
        const size = pngSize(block.data)
        if (size === undefined) break
        const index = media.length + 1
        const relId = `rIdImg${index}`
        media.push({ name: `word/media/image${index}.png`, data: block.data })
        rels.push(`<Relationship Id="${relId}" Type="${R}/image" Target="media/image${index}.png"/>`)
        paragraphs.push(imageParagraph(relId, index, size.width, size.height, block.caption))
        break
      }
      default:
        paragraphs.push(paragraph(block.text ?? '', { size: block.size, bold: block.bold === true, color: block.color }))
    }
  }

  const sectPr = `<w:sectPr><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>` +
    `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="${M}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">
<w:body>${paragraphs.join('')}${sectPr}</w:body>
</w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    { name: 'word/styles.xml', data: STYLES },
    ...media,
  ])
}
