/**
 * The archived library: card collection, the knowledge-point index, and deleting.
 *
 * The index is always derived from the card files — deleting it is safe,
 * hand-editing a card is safe, and a card that failed to parse is reported rather
 * than silently dropped. Deleting is a user decision, so this module is only
 * reachable from the plugin page (via lib/api/library.js), never from an agent
 * tool.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readCardFields, parseFrontMatter } from './frontmatter.js'
import { topLevelOf } from './normalize.js'
import { messageOf, pathExists, toRelative, writeJson } from './paths.js'
import { moveToBin } from './trash.js'

/** Folder inside a paper directory holding its archived cards. */
// Kept as a literal here (instead of importing drafts.js) so this module never
// imports drafts.js: drafts.js imports `resolveSourceImage` from here, and a
// two-way import would be a cycle.
const DRAFT_CARD_DIR = 'cards'

const pad = (value, width) => String(value).padStart(width, '0')

/**
 * Locate the image a card's `source` locator points at, so the review UI can show
 * the original scan beside the transcription. Works for a staged draft (images
 * still in `inbox/<batch>/`) and for an archived card (images moved beside it).
 */
export async function resolveSourceImage(paths, fields, cardFile) {
  const page = Number(fields.source?.page)
  if (!Number.isFinite(page) || page < 1) return undefined
  const band = Number(fields.source?.band)
  const bases = []
  if (typeof cardFile === 'string' && cardFile.startsWith('library/')) {
    const parts = cardFile.split('/')
    if (parts.length >= 4) bases.push(join(paths.root, ...parts.slice(0, 3)))
  }
  const batch = fields.provenance?.batch
  if (typeof batch === 'string' && batch !== '') bases.push(paths.batchDir(batch))
  for (const base of bases) {
    const candidates = []
    for (const dir of ['bands', 'overview', 'raster']) {
      if (Number.isFinite(band) && band >= 1) candidates.push(join(base, dir, `page-${pad(page, 4)}-band-${pad(band, 2)}.png`))
      candidates.push(join(base, dir, `page-${pad(page, 4)}.png`))
      candidates.push(join(base, dir, 's1', `page-${pad(page, 4)}.png`))
    }
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return { file: toRelative(paths.root, candidate), absolute: candidate }
    }
  }
  return undefined
}

/** Every archived card, in no particular order. Unparsable cards are reported. */
export async function collectCards(paths) {
  const cards = []
  const skipped = []
  let subjects = []
  try {
    subjects = (await readdir(paths.library, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return { cards, skipped }
    throw error
  }
  for (const subject of subjects) {
    const subjectDir = join(paths.library, subject)
    for (const paper of await readdir(subjectDir, { withFileTypes: true })) {
      if (!paper.isDirectory()) continue
      const cardsDir = join(subjectDir, paper.name, DRAFT_CARD_DIR)
      if (!(await pathExists(cardsDir))) continue
      for (const file of (await readdir(cardsDir)).filter((name) => name.endsWith('.md')).sort()) {
        const full = join(cardsDir, file)
        try {
          const parsed = parseFrontMatter(await readFile(full, 'utf8'))
          const fields = readCardFields(parsed.data)
          if (fields.id === '') {
            skipped.push({ file: toRelative(paths.root, full) ?? full, reason: '卡片缺少 id' })
            continue
          }
          cards.push({
            ...fields,
            subject: fields.subject === '' ? subject : fields.subject,
            paperDir: paper.name,
            file: toRelative(paths.root, full) ?? full,
            uncertain: parsed.body.includes('## 待人工确认'),
          })
        } catch (error) {
          skipped.push({ file: toRelative(paths.root, full) ?? full, reason: messageOf(error) })
        }
      }
    }
  }
  return { cards, skipped }
}

function countBy(cards, pick) {
  const map = new Map()
  for (const card of cards) for (const key of pick(card)) map.set(key, (map.get(key) ?? 0) + 1)
  return map
}

/** Build the machine index and the human index from the cards on disk. */
export async function buildIndex(paths) {
  const { cards, skipped } = await collectCards(paths)
  const subjects = new Map()
  for (const card of cards) {
    if (!subjects.has(card.subject)) subjects.set(card.subject, [])
    subjects.get(card.subject).push(card)
  }

  const json = {
    generatedAt: new Date().toISOString(),
    archiveRoot: paths.root,
    totals: {
      cards: cards.length,
      papers: new Set(cards.map((card) => `${card.subject}/${card.paperDir}`)).size,
      knowledgePoints: countBy(cards, (card) => card.knowledgePoints).size,
    },
    subjects: [...subjects.entries()].map(([subject, list]) => {
      const byTop = new Map()
      for (const card of list) {
        for (const point of card.knowledgePoints.length > 0 ? card.knowledgePoints : ['（未标知识点）']) {
          const top = topLevelOf(point)
          if (!byTop.has(top)) byTop.set(top, new Map())
          const points = byTop.get(top)
          if (!points.has(point)) points.set(point, [])
          points.get(point).push(card.id)
        }
      }
      return {
        subject,
        cards: list.length,
        tree: [...byTop.entries()].map(([top, points]) => ({
          name: top,
          count: points.size,
          points: [...points.entries()].map(([point, ids]) => ({ name: point, count: ids.length, cardIds: ids })),
        })),
        papers: [...new Set(list.map((card) => card.paperDir))].sort(),
      }
    }),
    cards: cards.map((card) => ({
      id: card.id,
      subject: card.subject,
      paper: card.paper,
      paperDir: card.paperDir,
      questionRef: card.questionRef,
      knowledgePoints: card.knowledgePoints,
      errorTypes: card.errorTypes,
      difficulty: card.difficulty,
      verdict: card.verdict,
      file: card.file,
      createdAt: card.createdAt,
      hasUncertainty: card.uncertain,
    })),
    skipped,
  }

  const lines = ['# AI 错题本索引', '']
  lines.push(`> 生成于 ${json.generatedAt}　｜　共 ${json.totals.cards} 张卡片，覆盖 ${json.totals.knowledgePoints} 个知识点，${json.totals.papers} 份卷子`, '')
  lines.push('本文件由插件从卡片 front-matter 自动生成，可随时删除重建。', '')
  for (const entry of json.subjects) {
    lines.push(`## ${entry.subject}`, '')
    lines.push(`共 ${entry.cards} 张卡片，来自 ${entry.papers.length} 份卷子。`, '')
    for (const top of entry.tree) {
      lines.push(`### ${top.name}`, '')
      for (const point of top.points) {
        lines.push(`#### ${point.name}`, '')
        for (const id of point.cardIds) {
          const card = json.cards.find((candidate) => candidate.id === id)
          if (card === undefined) continue
          const meta = [card.paper, card.questionRef === '' ? '' : `第 ${card.questionRef} 题`, card.difficulty, card.errorTypes.join('、')].filter((part) => part !== '')
          const flag = card.hasUncertainty ? ' ⚠️待确认' : ''
          lines.push(`- [${card.id}](<${card.file}>)　${meta.join('　｜　')}${flag}`)
        }
        lines.push('')
      }
    }
  }
  if (skipped.length > 0) {
    lines.push('## 未能索引的卡片', '')
    for (const entry of skipped) lines.push(`- \`${entry.file}\`：${entry.reason}`)
    lines.push('')
  }

  await writeJson(paths.indexJson, json)
  await writeFile(paths.indexMd, lines.join('\n'), 'utf8')
  return json
}

/**
 * Delete archived cards.
 *
 * Deliberately reachable only from the review UI: filing and deleting are the
 * user's decisions, so no model-facing tool is allowed to remove an archive entry.
 * The default moves files into the recycle bin; only `permanent: true` destroys
 * them, and the index is rebuilt afterwards either way.
 */
export async function deleteCards(paths, { files, permanent = false, includePapers = false, note = '' } = {}) {
  const wanted = [...new Set((files ?? []).map((file) => String(file).trim()))].filter((file) => file !== '')
  if (wanted.length === 0) throw new Error('没有选择要删除的卡片')

  const collected = await collectCards(paths)
  const known = new Set(collected.cards.map((card) => card.file))
  const targets = wanted.filter((file) => known.has(file))
  const unknown = wanted.filter((file) => !known.has(file))
  if (targets.length === 0) throw new Error(`这些卡片不在库里：${unknown.join('、')}`)

  const paperDirOf = (file) => {
    const parts = file.split('/')
    return parts.slice(0, Math.max(0, parts.length - 2)).join('/')
  }
  const untouched = collected.cards.filter((card) => !targets.includes(card.file))

  let payload = [...targets]
  let emptiedPapers = []
  if (includePapers) {
    const touched = [...new Set(targets.map(paperDirOf))]
    emptiedPapers = touched.filter((paperDir) => !untouched.some((card) => paperDirOf(card.file) === paperDir))
    if (emptiedPapers.length > 0) {
      // Move the whole paper folder (its scan and bands included) instead of the
      // individual cards that lived in it.
      payload = payload.filter((file) => !emptiedPapers.includes(paperDirOf(file)))
      payload.push(...emptiedPapers)
    }
  }

  const result = await moveToBin(paths, payload, { permanent, note: note === '' ? `删除 ${targets.length} 张卡片` : note })
  const index = await buildIndex(paths)
  return {
    deletedCards: targets.length,
    emptiedPapers,
    unknown,
    stamp: result.stamp,
    moved: result.moved,
    permanent: result.permanent,
    missing: result.missing,
    totals: index.totals,
  }
}
