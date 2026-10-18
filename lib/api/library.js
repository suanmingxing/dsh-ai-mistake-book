/**
 * Archived-library API methods: index reads/rebuilds, card reads, and the only
 * delete route the client has.
 *
 * Deleting is a user decision, so — like archiving — it lives on the HTTP surface
 * and deliberately NOT behind an agent tool.
 */
import { readFile } from 'node:fs/promises'
import { buildIndex, deleteCards as deleteArchivedCards, resolveSourceImage } from '../library.js'
import { parseFrontMatter, readCardFields } from '../frontmatter.js'
import { resolveInside } from '../paths.js'

/** The knowledge-point index, rebuilt on demand when index.json is missing. */
export async function library(payload, { paths }) {
  const indexFile = await readFile(paths.indexJson, 'utf8').catch(() => null)
  const index = indexFile === null ? await buildIndex(paths) : JSON.parse(indexFile)
  return { index }
}

/** Force a rebuild of the index from the card files on disk. */
export async function reindex(payload, { paths }) {
  return { index: await buildIndex(paths) }
}

/** One archived card as markdown + parsed fields + its original scan region. */
export async function card(payload, { paths }) {
  const file = resolveInside(paths.root, String(payload.file))
  const markdown = await readFile(file, 'utf8')
  const parsed = parseFrontMatter(markdown)
  const fields = readCardFields(parsed.data)
  const source = await resolveSourceImage(paths, fields, String(payload.file))
  return { file: String(payload.file), markdown, body: parsed.body, fields, sourceImage: source?.file }
}

/** Delete archived cards (or whole emptied papers) and rebuild the index. */
export async function deleteCards(payload, { paths }) {
  const result = await deleteArchivedCards(paths, {
    files: Array.isArray(payload.files) ? payload.files : [],
    permanent: payload.permanent === true,
    includePapers: payload.includePapers === true,
  })
  return result
}
