/**
 * Small standalone API methods.
 */

/** Markdown + KaTeX rendering for card bodies; both modules load lazily. */
export async function render(payload) {
  // Card bodies are Markdown with LaTeX. Rendering happens on the Host, so the
  // browser needs no Markdown parser and no KaTeX bundle: it gets finished HTML.
  const { renderMarkdown } = await import('../markdown.js')
  const { mathAvailable, mathUnavailableReason } = await import('../math.js')
  const available = mathAvailable()
  return {
    html: renderMarkdown(String(payload.markdown ?? '')),
    mathAvailable: available,
    mathError: available ? null : mathUnavailableReason(),
  }
}

/** The archive root the Host will open in the system file manager. */
export function revealArchiveRoot(payload, { paths }) {
  return { path: paths.root }
}
