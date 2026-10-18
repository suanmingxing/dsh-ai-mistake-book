/**
 * Batch-facing API methods: the review page's status, list and detail views.
 */
import { readDrafts } from '../drafts.js'
import { listBatches, readBatch } from '../store.js'
import { summarize } from './views.js'

/** Deployment settings the client needs to describe the running configuration. */
export function status(payload, { paths, config }) {
  return {
    archiveRoot: paths.root,
    pagesPerRequest: config.pagesPerRequest,
    pdfDpi: config.pdfDpi,
    overviewDpi: config.overviewDpi,
    maxPagesPerBatch: config.maxPagesPerBatch,
    maxRecutsPerPage: config.maxRecutsPerPage,
    keepOriginalScan: config.keepOriginalScan,
    fileNamePattern: config.fileNamePattern,
    analysisProvider: config.analysisProvider,
    analysisModel: config.analysisModel,
  }
}

/** Batches, newest first, optionally filtered by lifecycle status. */
export async function batches(payload, { paths }) {
  const statusFilter = typeof payload.status === 'string' && payload.status !== '' ? payload.status : undefined
  const list = await listBatches(paths, statusFilter === undefined ? {} : { status: statusFilter })
  return { batches: list.map(summarize) }
}

/** One batch with its pages, candidates, drafts and diagnostics. */
export async function batch(payload, { paths }) {
  const record = await readBatch(paths, String(payload.batchId))
  const drafts = await readDrafts(paths, record)
  return {
    batch: summarize(record),
    pages: record.pages.map((page) => ({
      page: page.page,
      width: page.width,
      height: page.height,
      bands: page.bands.length,
      overviewFile: page.overview.file,
      bandFiles: page.bands.map((band) => band.file),
      sourceName: page.sourceName ?? null,
    })),
    candidates: (record.candidates ?? []).map((candidate) => ({
      ref: candidate.ref,
      label: candidate.refLabel,
      knowledgePoints: candidate.knowledgePoints,
      errorTypes: candidate.errorTypes,
      difficulty: candidate.difficulty,
      uncertain: candidate.uncertain?.length ?? 0,
    })),
    selection: record.selection ?? null,
    drafts,
    recuts: record.recuts ?? [],
    diagnostics: record.diagnostics ?? [],
  }
}
