/**
 * Archiving and the knowledge-point index.
 *
 * Archiving is the only step that moves anything from `inbox/` (staged, still
 * owned by the analysis run) into `library/` (the mistake book proper). It always
 * ends by rebuilding the index, and the index is always derived from the card
 * files — deleting it is safe, hand-editing a card is safe, and a card that failed
 * to parse is reported rather than silently dropped.
 */
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { readCardFields, parseFrontMatter } from './frontmatter.js'
import { renderFrontMatterData } from './card.js'
import { topLevelOf } from './normalize.js'
import { messageOf, pathExists, slugify, toRelative, writeJson } from './paths.js'
import { moveToBin } from './trash.js'

/** Folder inside a paper directory holding its archived cards. */
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

/** Draft summaries for one batch, ready for the review UI. */
export async function readDrafts(paths, batch) {
  const files = await listDraftFiles(paths, batch.id)
  const drafts = []
  for (const file of files) {
    const draft = await readDraft(paths, batch.id, file)
    const source = await resolveSourceImage(paths, draft.fields, undefined)
    drafts.push({
      fileName: draft.fileName,
      markdown: draft.markdown,
      body: draft.body,
      fields: draft.fields,
      hasUncertainty: draft.body.includes('## 待人工确认'),
      sourceImage: source?.file,
    })
  }
  return drafts
}

export function draftCardsDir(paths, batchId) {
  return join(paths.batchDir(batchId), DRAFT_CARD_DIR)
}

export async function listDraftFiles(paths, batchId) {
  const dir = draftCardsDir(paths, batchId)
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function readDraft(paths, batchId, fileName) {
  const file = join(draftCardsDir(paths, batchId), basename(String(fileName)))
  const markdown = await readFile(file, 'utf8')
  const parsed = parseFrontMatter(markdown)
  return { fileName: basename(file), markdown, data: parsed.data, body: parsed.body, fields: readCardFields(parsed.data) }
}

/**
 * Patch one draft: merge front-matter fields and/or replace the body, then
 * re-render. Unknown keys already in the file are preserved.
 */
export async function updateDraft(paths, batchId, fileName, patch = {}) {
  const current = await readDraft(paths, batchId, fileName)
  const data = { ...current.data, ...(patch.frontMatter ?? {}) }
  if (Array.isArray(data.knowledgePoints) && data.knowledgePoints.length > 0) {
    data.topKnowledgePoint = topLevelOf(data.knowledgePoints[0])
  }
  const body = typeof patch.body === 'string' ? patch.body : current.body
  const markdown = `${renderFrontMatterData(data)}\n${body.replace(/^\n+/, '')}`
  await writeFile(join(draftCardsDir(paths, batchId), basename(current.fileName)), markdown, 'utf8')
  return { fileName: current.fileName, markdown, data }
}

export async function removeDraft(paths, batchId, fileName) {
  const file = join(draftCardsDir(paths, batchId), basename(String(fileName)))
  if (!(await pathExists(file))) return false
  await rm(file, { force: true })
  return true
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

async function uniqueDirName(parent, base) {
  let candidate = base
  let counter = 2
  while (await pathExists(join(parent, candidate))) {
    candidate = `${base} (${counter})`
    counter += 1
  }
  return candidate
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

/**
 * Move a confirmed batch into the library and rebuild the index.
 * Draft files are re-read from disk, so an edit made in the UI — or by hand — is
 * what gets archived.
 */
export async function archiveBatch(paths, batch, { keepOriginalScan = true, keepBandImages = true } = {}) {
  if (batch.status === 'archived') throw new Error(`批次 ${batch.id} 已经归档过了。`)
  if (!Array.isArray(batch.drafts) || batch.drafts.length === 0) {
    throw new Error('这个批次还没有生成卡片草稿，请先让分析会话调用 mistake_select。')
  }
  const files = await listDraftFiles(paths, batch.id)
  if (files.length === 0) throw new Error('找不到草稿卡片文件，请重新调用 mistake_select。')

  const drafts = []
  for (const file of files) drafts.push(await readDraft(paths, batch.id, file))
  const subject = drafts[0].fields.subject !== '' ? drafts[0].fields.subject : 'math'
  const paperTitle = batch.paperTitle ?? drafts[0].fields.paper ?? batch.id

  const subjectDir = join(paths.library, subject)
  await mkdir(subjectDir, { recursive: true })
  const dirName = await uniqueDirName(subjectDir, slugify(paperTitle, batch.id, 80))
  const paperDir = join(subjectDir, dirName)
  await mkdir(join(paperDir, DRAFT_CARD_DIR), { recursive: true })

  const archivedAt = new Date().toISOString()
  const archivedCards = []
  for (const draft of drafts) {
    const data = {
      ...draft.data,
      subject,
      paper: paperTitle,
      topKnowledgePoint: draft.fields.knowledgePoints.length > 0 ? topLevelOf(draft.fields.knowledgePoints[0]) : draft.data.topKnowledgePoint,
      archivedAt,
      status: 'archived',
    }
    const markdown = `${renderFrontMatterData(data)}\n${draft.body.replace(/^\n+/, '')}`
    const target = join(paperDir, DRAFT_CARD_DIR, draft.fileName)
    await writeFile(target, markdown, 'utf8')
    archivedCards.push({ id: draft.fields.id, fileName: draft.fileName, file: toRelative(paths.root, target) })
  }

  // Assets move rather than copy: the inbox is a staging area, not a second archive.
  const movedAssets = []
  if (keepOriginalScan && (await pathExists(join(paths.batchDir(batch.id), 'source')))) {
    await rename(join(paths.batchDir(batch.id), 'source'), join(paperDir, 'source'))
    movedAssets.push('source')
  }
  if (keepBandImages && (await pathExists(join(paths.batchDir(batch.id), 'bands')))) {
    await rename(join(paths.batchDir(batch.id), 'bands'), join(paperDir, 'bands'))
    movedAssets.push('bands')
  }

  await writeJson(join(paperDir, 'paper.json'), {    title: paperTitle,
    subject,
    dir: toRelative(paths.root, paperDir),
    batch: batch.id,
    session: batch.session?.sessionId ?? null,
    hint: batch.hint ?? '',
    sourceFiles: (batch.sources ?? []).map((source) => source.name),
    pages: (batch.pages ?? []).map((page) => ({ page: page.page, width: page.width, height: page.height, bands: page.bands?.length ?? 0 })),
    cards: archivedCards,
    diagnostics: batch.diagnostics ?? [],
    archivedAt,
  })

  batch.status = 'archived'
  batch.archivedAt = archivedAt
  batch.archivePath = toRelative(paths.root, paperDir)
  batch.cards = archivedCards
  // Clear the staging copies: the library holds the real ones now, and leaving
  // them behind is what would let a second archive duplicate every card.
  await rm(join(paths.batchDir(batch.id), DRAFT_CARD_DIR), { recursive: true, force: true })
  const index = await buildIndex(paths)

  return { paper: { title: paperTitle, subject, dir: batch.archivePath }, cards: archivedCards, index, movedAssets }
}
