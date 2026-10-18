/**
 * Draft editing and archiving: everything that happens between "the model staged
 * candidates" and "the user filed the paper".
 *
 * Archiving lives here and only here. It is a user decision, so it is reachable
 * from the plugin page and deliberately NOT exposed as an agent tool.
 */
import { archiveBatch } from '../archive.js'
import { readDraft, removeDraft, updateDraft } from '../drafts.js'
import { resolveSourceImage } from '../library.js'
import { readBatch, trace, writeBatch } from '../store.js'
import { releaseArchivedSession } from '../session.js'

/** One staged draft with its parsed fields and the scan region it came from. */
export async function draft(payload, { paths }) {
  const record = await readDraft(paths, String(payload.batchId), String(payload.fileName))
  const source = await resolveSourceImage(paths, record.fields, undefined)
  return {
    fileName: record.fileName,
    markdown: record.markdown,
    body: record.body,
    fields: record.fields,
    sourceImage: source?.file,
    hasUncertainty: record.body.includes('## 待人工确认'),
  }
}

/** Patch one draft (front-matter fields and/or body) and re-render it. */
export async function draftUpdate(payload, { paths }) {
  const result = await updateDraft(paths, String(payload.batchId), String(payload.fileName), {
    frontMatter: payload.frontMatter,
    body: payload.body,
  })
  return { fileName: result.fileName, markdown: result.markdown }
}

/** Remove one staged draft and drop it from the batch's draft list. */
export async function draftDrop(payload, { paths }) {
  await removeDraft(paths, String(payload.batchId), String(payload.fileName))
  const batch = await readBatch(paths, String(payload.batchId))
  batch.drafts = (batch.drafts ?? []).filter((draft) => draft.fileName !== String(payload.fileName))
  await writeBatch(paths, batch)
  return { dropped: true, remaining: batch.drafts.length }
}

/** Move a confirmed batch into the library and release its analysis session. */
export async function archive(payload, { ctx, config, paths }) {
  const batch = await readBatch(paths, String(payload.batchId))
  if (payload.paperTitle !== undefined && String(payload.paperTitle).trim() !== '') {
    batch.paperTitle = String(payload.paperTitle).trim()
  }
  const result = await archiveBatch(paths, batch, { keepOriginalScan: config.keepOriginalScan, keepBandImages: true })
  trace(batch, 'info', '已归档', { paper: result.paper.dir, cards: result.cards.length })
  // 题目落库之后再释放分析会话：归档前它还要被用来改卡片，不能提前收掉。
  const released = await releaseArchivedSession(ctx, batch.session?.sessionId)
  trace(batch, 'info', '已释放分析会话', released)
  await writeBatch(paths, batch)
  return {
    paper: result.paper,
    cards: result.cards,
    movedAssets: result.movedAssets,
    totals: result.index.totals,
  }
}
