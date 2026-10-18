/**
 * PDF export API methods.
 *
 * Both halves are imported lazily on purpose: `../export.js` pulls docx/latex/the
 * LibreOffice bridge, `../export-store.js` only touches the exports directory, and
 * the plugin host should not load either unless the user exports or opens the
 * manage page. Rendering a printable booklet is a user action like archiving.
 */
export async function exportCards(payload, { paths }) {
  const { exportCardsToPdf } = await import('../export.js')
  return await exportCardsToPdf(paths, {
    files: Array.isArray(payload.files) ? payload.files : undefined,
    includeSource: payload.includeSource !== false,
    cropToQuestion: payload.cropToQuestion !== false,
    title: typeof payload.title === 'string' ? payload.title : undefined,
  })
}

/** Exported PDFs (newest first) with the sidecar metadata when present. */
export async function exports(payload, { paths }) {
  const { listExports } = await import('../export-store.js')
  return { files: await listExports(paths) }
}

/** Delete one export: PDF, intermediate DOCX and sidecar together. */
export async function exportDelete(payload, { paths, config }) {
  const { deleteExport } = await import('../export-store.js')
  return await deleteExport(paths, String(payload.file ?? ''), { permanent: config.deleteToTrash === false })
}
