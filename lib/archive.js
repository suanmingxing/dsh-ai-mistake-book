/**
 * Archiving: the only step that moves a confirmed batch from `inbox/` (staged,
 * still owned by the analysis run) into `library/` (the mistake book proper).
 *
 * Draft I/O lives in `drafts.js` and index building in `library.js`; this module
 * keeps only the filing workflow, and it always ends by rebuilding the index.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderFrontMatterData } from './card.js'
import { DRAFT_CARD_DIR, listDraftFiles, readDraft } from './drafts.js'
import { buildIndex } from './library.js'
import { topLevelOf } from './normalize.js'
import { pathExists, slugify, toRelative, writeJson } from './paths.js'

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
