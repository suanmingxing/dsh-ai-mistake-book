/**
 * Batch persistence: one directory per ingest run under `inbox/<batchId>`.
 *
 * The batch record is the plugin's working state between "the scan arrived" and
 * "the user confirmed the archive". It is plain JSON written atomically, so a
 * crash mid-ingest leaves a readable, diagnosable record rather than a mystery.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { messageOf, pathExists, readJson, writeJson } from './paths.js'

export const BATCH_FILE = 'batch.json'

export function batchFile(paths, batchId) {
  return join(paths.batchDir(batchId), BATCH_FILE)
}

export async function readBatch(paths, batchId) {
  const file = batchFile(paths, batchId)
  const batch = await readJson(file, undefined)
  if (batch === undefined) throw new Error(`批次不存在：${batchId}`)
  return batch
}

export async function writeBatch(paths, batch) {
  batch.updatedAt = new Date().toISOString()
  return writeJson(batchFile(paths, batch.id), batch)
}

export async function listBatchIds(paths) {
  try {
    const entries = await readdir(paths.inbox, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('b-')).map((entry) => entry.name).sort().reverse()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/** Every batch, newest first, skipping directories that are not readable batches. */
export async function listBatches(paths, { status } = {}) {
  const ids = await listBatchIds(paths)
  const batches = []
  for (const id of ids) {
    try {
      const batch = await readBatch(paths, id)
      if (status === undefined || batch.status === status) batches.push(batch)
    } catch {
      /* a directory without a readable record is not a batch */
    }
  }
  return batches
}

/** Append one diagnostic line to the batch record, bounded so it cannot grow forever. */
export function trace(batch, level, message, extra) {
  if (!Array.isArray(batch.diagnostics)) batch.diagnostics = []
  batch.diagnostics.push({
    at: new Date().toISOString(),
    level,
    message: String(message).slice(0, 2000),
    ...(extra === undefined ? {} : { extra: safeExtra(extra) }),
  })
  if (batch.diagnostics.length > 200) batch.diagnostics.splice(0, batch.diagnostics.length - 200)
  return batch
}

function safeExtra(extra) {
  try {
    return JSON.parse(JSON.stringify(extra))
  } catch {
    return String(extra)
  }
}

export async function recordFailure(paths, batch, error) {
  batch.status = 'failed'
  batch.error = messageOf(error)
  trace(batch, 'error', messageOf(error))
  await writeBatch(paths, batch)
  return batch
}

export async function batchExists(paths, batchId) {
  return pathExists(batchFile(paths, batchId))
}

/** States a later reconcile must not overwrite. */
export const SETTLED_STATUSES = ['archived', 'awaiting-confirmation', 'cancelled']

/**
 * Reconcile a batch when its analysis session finishes a turn.
 *
 * Without this, a session that stops without calling the plugin's tools — the
 * model gave up, answered something unhelpful, or the user closed it — leaves the
 * batch claiming to be "analyzing" forever, and the review page keeps showing a
 * run that ended minutes ago. The state is derived from what actually got staged,
 * which is the only thing that matters downstream.
 */
export async function reconcileBatch(paths, batchId) {
  const batch = await readBatch(paths, batchId)
  if (SETTLED_STATUSES.includes(batch.status)) return batch.status
  const next = (batch.drafts?.length ?? 0) > 0
    ? 'awaiting-confirmation'
    : (batch.candidates?.length ?? 0) > 0
      ? 'staged'
      : 'analysis-ended'
  if (next !== batch.status) {
    batch.status = next
    trace(batch, 'info', `分析会话回合结束，批次状态调整为 ${next}`, {
      candidates: batch.candidates?.length ?? 0,
      drafts: batch.drafts?.length ?? 0,
    })
    await writeBatch(paths, batch)
  }
  return next
}
