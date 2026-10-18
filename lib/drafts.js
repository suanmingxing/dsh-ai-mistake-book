/**
 * Staged-draft I/O for a batch under `inbox/<batchId>/cards/`.
 *
 * A draft is one wrong question the analysis run staged: the same Markdown +
 * front-matter format as an archived card, kept in the inbox until the user
 * confirms the archive (see archive.js). Editing and dropping drafts is allowed
 * between staging and filing.
 */
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { renderFrontMatterData } from './card.js'
import { parseFrontMatter, readCardFields } from './frontmatter.js'
import { resolveSourceImage } from './library.js'
import { topLevelOf } from './normalize.js'
import { pathExists } from './paths.js'

/** Folder inside a batch directory (and a paper directory) holding cards. */
export const DRAFT_CARD_DIR = 'cards'

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
