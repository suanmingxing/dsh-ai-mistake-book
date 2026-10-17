/**
 * Plugin configuration.
 *
 * `Config` is the schema the Loader validates and the Settings page projects into
 * a form. Fields the user may change while the plugin stays mounted are marked
 * `volatile()`: only DSH's own schemastery wraps such a field in the reference the
 * Loader's live-commit path walks, so a schema from the public package would
 * silently drop every live write.
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_ARCHIVE_ROOT, normalizeRoot } from './paths.js'

/** Mark a field live when the installed schemastery supports it. */
function live(field) {
  return typeof field?.volatile === 'function' ? field.volatile() : field
}

export const Config = z.object({
  /** Absolute directory holding the whole mistake book. Changing it remounts the plugin. */
  archiveRoot: z.string().default(DEFAULT_ARCHIVE_ROOT),

  /** Rasterization dpi for scanned PDFs. 400 is the highest A4 setting inside the kit's pixel cap. */
  pdfDpi: live(z.number().step(1).min(72).max(600).default(400)),
  /** dpi of the whole-page overview image delivered next to the bands. */
  overviewDpi: live(z.number().step(1).min(72).max(300).default(200)),
  /** Per-image pixel budget; must stay at or below DSH's 4 MP attachment normalization cap. */
  maxPixelsPerImage: live(z.number().step(1).min(500000).max(4194304).default(4194304)),
  /** Pages delivered per `mistake_pages` call (a page costs 1 overview + N bands). */
  pagesPerRequest: live(z.number().step(1).min(1).max(8).default(2)),
  /** Hard cap on rasterized pages per batch. */
  maxPagesPerBatch: live(z.number().step(1).min(1).max(200).default(60)),
  /** How many native-resolution re-cuts one page may spend before the model must record uncertainty instead. */
  maxRecutsPerPage: live(z.number().step(1).min(0).max(24).default(4)),
  /** Restrict an analysis session to its own tools so it cannot wander into the shell. */
  restrictAnalysisTools: live(z.boolean().default(true)),

  /** Provider for the analysis session; empty means "use the deployment default". */
  analysisProvider: live(z.string().default('')),
  /** Model for the analysis session; empty means "use the deployment default". */
  analysisModel: live(z.string().default('')),

  /** Title prefix of the analysis session. */
  sessionTitlePrefix: live(z.string().default('错题本')),

  /** Card file name pattern; placeholders: {id} {ref} {subject} {kp1} {kpFull} {paper} {difficulty}. */
  fileNamePattern: live(z.string().default('{id} {kp1}')),

  /** Keep the original scan beside the archived cards. */
  keepOriginalScan: live(z.boolean().default(true)),
  /**
   * Deleting a card moves it into `<root>/_trash` instead of destroying it.
   * Turn this off only if you want deletion to be immediate and final.
   */
  deleteToTrash: live(z.boolean().default(true)),
  /** How many days a recycle-bin folder is kept before the UI offers to empty it. */
  trashRetentionDays: live(z.number().default(30)),
  /** Log every rasterization and session step into the batch directory for diagnosis. */
  debugTrace: live(z.boolean().default(true)),
})

/**
 * A `volatile()` field parses into a cosmokit Volatile reference, not a plain
 * value: the Loader keeps it live and walks it on every commit. Read through it.
 */
function unwrap(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.get !== 'function') return value
  const isVolatile = Object.getOwnPropertySymbols(value).some((symbol) => String(symbol).includes('volatile'))
  if (!isVolatile) return value
  try {
    return value.get()
  } catch {
    return undefined
  }
}

/** Deployment-level values, read from the row config as the Loader validated it. */
export function resolveConfig(raw) {
  const source = raw ?? {}
  const read = (key) => unwrap(source[key])
  const number = (key, fallback) => {
    const value = read(key)
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }
  const text = (key, fallback) => {
    const value = read(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  }
  const flag = (key, fallback) => {
    const value = read(key)
    return typeof value === 'boolean' ? value : fallback
  }
  return {
    archiveRoot: normalizeRoot(read('archiveRoot')),
    pdfDpi: number('pdfDpi', 400),
    overviewDpi: number('overviewDpi', 200),
    maxPixelsPerImage: number('maxPixelsPerImage', 4194304),
    pagesPerRequest: number('pagesPerRequest', 2),
    maxPagesPerBatch: number('maxPagesPerBatch', 60),
    maxRecutsPerPage: number('maxRecutsPerPage', 4),
    restrictAnalysisTools: flag('restrictAnalysisTools', true),
    analysisProvider: text('analysisProvider', ''),
    analysisModel: text('analysisModel', ''),
    sessionTitlePrefix: text('sessionTitlePrefix', '错题本'),
    fileNamePattern: text('fileNamePattern', '{id} {kp1}'),
    keepOriginalScan: flag('keepOriginalScan', true),
    deleteToTrash: flag('deleteToTrash', true),
    trashRetentionDays: number('trashRetentionDays', 30),
    debugTrace: flag('debugTrace', true),
  }
}

/**
 * Read the live row config through the settings service, falling back to the
 * activation-time config. Volatile edits land here without a remount.
 */
export function liveConfig(ctx, activationConfig) {
  const base = resolveConfig(activationConfig)
  try {
    const settings = ctx.get('settings')
    if (settings === undefined || typeof settings.describe !== 'function') return base
    const entryId = ownEntryId(ctx)
    if (entryId === undefined) return base
    const descriptor = settings.describe({ redactSecrets: true }).find((candidate) => candidate.ns === entryId)
    if (descriptor?.value === undefined) return base
    return resolveConfig({ ...activationConfig, ...descriptor.value })
  } catch {
    return base
  }
}

/** The Loader row id is a mount choice, not a package property, so resolve it live. */
export function ownEntryId(ctx) {
  let fallback
  try {
    for (const entry of ctx.loader.entries()) {
      const id = entry.options.id
      if (entry.options.name !== 'ai-mistake-book' || typeof id !== 'string' || id === '') continue
      if (entry.fiber === ctx.fiber) return id
      if (entry.disabled !== true && fallback === undefined) fallback = id
    }
  } catch {
    return undefined
  }
  return fallback
}
