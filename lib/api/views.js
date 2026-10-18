/**
 * Shared view models for the API methods.
 *
 * `summarize` is the only reduction of a batch record the review UI gets from the
 * list endpoints: the full record can carry every page/band/diagnostic line, and
 * a batch list does not need to ship that much JSON per row.
 */

/** Compact client-facing view of one batch record. */
export function summarize(batch) {
  return {
    id: batch.id,
    status: batch.status,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    origin: batch.origin,
    subject: batch.subject,
    hint: batch.hint,
    pageCount: batch.pages?.length ?? 0,
    bandsPerPage: batch.pages?.[0]?.bands?.length ?? 0,
    sources: (batch.sources ?? []).map((source) => ({ name: source.name, bytes: source.bytes, file: source.file })),
    sessionId: batch.session?.sessionId ?? null,
    sessionTitle: batch.session?.title ?? null,
    workspacePath: batch.workspace?.path ?? null,
    paperTitle: batch.paperTitle ?? null,
    draftCount: batch.drafts?.length ?? 0,
    candidateCount: batch.candidates?.length ?? 0,
    recuts: batch.delivery?.recuts ?? 0,
    archivePath: batch.archivePath ?? null,
    delivery: batch.delivery ?? { calls: 0, images: 0 },
    error: batch.error ?? null,
  }
}
