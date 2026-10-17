/**
 * Ingest: one scan in, one batch plus one analysis session out.
 *
 * This is the single operation behind both callers — the `/mistake` command and
 * the `mistake_ingest` tool — so the two paths can never drift apart.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { archivePaths, ensureArchiveLayout, messageOf, newBatchId, removeIfExists, toRelative } from './paths.js'
import { extensionForMediaType, registerPageImages, sniffImageMediaType } from './pages.js'
import { analysisBrief } from './prompt.js'
import { isPdfName, rasterizePdf } from './raster.js'
import { ANALYSIS_TOOL_ALLOWLIST, assertInsideArchiveWorkspace, ensureArchiveWorkspace, promptSession, requireCallerSessionId, resolveVisionRoute, restrictAnalysisTools } from './session.js'
import { trace, writeBatch } from './store.js'
import { ensureTemplates, readTemplates } from './templates.js'

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

function safeFileName(name, fallback) {
  const base = basename(String(name ?? '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  if (base === '' || base === '.' || base === '..') return fallback
  return base.slice(0, 120)
}

async function materializeBlocks(ctx, blocks, sourceDir) {
  const written = []
  let index = 0
  for (const block of blocks ?? []) {
    index += 1
    if (block?.type === 'image' && block.attachment !== undefined) {
      const stored = await ctx.attachments.readImage(block.attachment)
      const mediaType = block.attachment.mediaType ?? sniffImageMediaType(stored.data) ?? 'image/png'
      const name = safeFileName(block.attachment.name, `image-${String(index).padStart(2, '0')}${extensionForMediaType(mediaType)}`)
      const file = join(sourceDir, name)
      await writeFile(file, stored.data)
      written.push({ file, name, bytes: stored.data.length, mediaType })
      continue
    }
    if (block?.type === 'file' && block.attachment !== undefined) {
      const ref = block.attachment
      const name = safeFileName(ref.name, `file-${String(index).padStart(2, '0')}.bin`)
      const file = join(sourceDir, name)
      let copied = false
      try {
        const hostPath = ctx.attachments.fileHostPath?.(ref)
        if (typeof hostPath === 'string' && hostPath !== '' && existsSync(hostPath)) {
          await copyFile(hostPath, file)
          copied = true
        }
      } catch {
        /* fall through to the stream copy */
      }
      if (!copied) {
        const chunks = []
        for await (const chunk of ctx.attachments.readFileStream(ref)) chunks.push(Buffer.from(chunk))
        await writeFile(file, Buffer.concat(chunks))
      }
      const bytes = (await readFile(file)).length
      written.push({ file, name, bytes, mediaType: sniffImageMediaType(await readFile(file)) ?? (isPdfName(name) ? 'application/pdf' : undefined) })
      continue
    }
  }
  return written
}

/** Pull absolute file paths out of a free-form hint, so `/mistake D:\\scans\\p.pdf` works. */
export function extractPathsFromHint(hint) {
  const text = String(hint ?? '')
  const found = []
  const consider = (raw) => {
    const candidate = String(raw ?? '').trim().replace(/^["']|["']$/g, '').replace(/^@/, '').replace(/^["']|["']$/g, '')
    if (candidate === '' || !isAbsolute(candidate) || !existsSync(candidate)) return
    if (!found.includes(candidate)) found.push(candidate)
  }
  for (const match of text.matchAll(/"([^"]+)"|'([^']+)'/g)) consider(match[1] ?? match[2])
  for (const token of text.split(/\s+/)) consider(token)
  return found
}

export function stripPathsFromHint(hint, paths) {
  let text = String(hint ?? '')
  for (const path of paths) {
    for (const variant of [`@"${path}"`, `'${path}'`, `"${path}"`, `@${path}`, path]) {
      text = text.split(variant).join(' ')
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Run one ingest. Throws with an actionable message; the caller turns that into a
 * command error or a tool error so the user always sees why nothing was filed.
 */
export async function ingestBatch(ctx, config, input) {
  const paths = await ensureArchiveLayout(archivePaths(config.archiveRoot))
  const createdTemplates = await ensureTemplates(paths)
  const templates = await readTemplates(paths)

  // A hint may carry file paths (`/mistake D:\scans\paper-2026-10-01.pdf 8`). Those
  // paths are consumed as sources and MUST be stripped before the hint is stored:
  // otherwise every digit in the filename is read back as a reported question
  // number, and the brief tells the model to file questions that do not exist.
  const authoredSources = [...(input.sourcePaths ?? [])]
  const hintPaths = extractPathsFromHint(input.hint)
  for (const path of hintPaths) if (!authoredSources.includes(path)) authoredSources.push(path)
  const cleanHint = stripPathsFromHint(input.hint, hintPaths)

  // Validate BEFORE creating anything, so a rejected invocation leaves no orphan
  // batch directory behind — which is exactly what two failed commands did.
  if ((input.attachments?.length ?? 0) === 0 && authoredSources.length === 0) {
    throw new Error([
      '没有收到扫描件。请用下面任一种写法：',
      '· 在命令里直接给文件的绝对路径（推荐，附件不一定随命令送出）：',
      '    /mistake C:\\Users\\hemu0\\Downloads\\卷子.pdf 5,9,12',
      '· 或者让会话里的助手用 mistake_ingest 工具指定路径。',
    ].join('\n'))
  }

  const batchId = newBatchId()
  const batchDir = paths.batchDir(batchId)
  const sourceDir = join(batchDir, 'source')
  // Neither writeFile nor copyFile creates parents, so make the batch skeleton first.
  await mkdir(sourceDir, { recursive: true })
  const relativeTo = (file) => toRelative(paths.root, file)

  const batch = {
    id: batchId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ingesting',
    origin: input.origin ?? 'unknown',
    subject: input.subject ?? null,
    hint: cleanHint,
    ...(cleanHint === String(input.hint ?? '').trim() ? {} : { rawHint: input.hint ?? '' }),
    archiveRoot: paths.root,
    sources: [],
    pages: [],
    session: null,
    workspace: null,
    delivery: { calls: 0, images: 0, lastAt: null },
    diagnostics: [],
    error: null,
  }

  await writeBatch(paths, batch)
  trace(batch, 'info', 'ingest 开始', { batchId, attachmentCount: input.attachments?.length ?? 0, authoredSources })
  if (createdTemplates.length > 0) trace(batch, 'info', '已生成模板文件', createdTemplates)

  try {
    // ---- 1. materialize every original so the archive always keeps the source
    batch.sources = await materializeBlocks(ctx, input.attachments, sourceDir)
    for (const [index, path] of authoredSources.entries()) {
      if (!existsSync(path)) throw new Error(`找不到文件：${path}`)
      const name = safeFileName(basename(path), `source-${index + 1}.bin`)
      const file = join(sourceDir, name)
      await copyFile(path, file)
      const bytes = (await readFile(file)).length
      batch.sources.push({ file, name, bytes, mediaType: sniffImageMediaType(await readFile(file)) ?? (isPdfName(name) ? 'application/pdf' : undefined) })
    }
    if (batch.sources.length === 0) throw new Error('扫描件读取后为空')
    trace(batch, 'info', '原始文件已存档', batch.sources.map((source) => ({ name: source.name, bytes: source.bytes })))
    await writeBatch(paths, batch)

    // ---- 2. rasterize PDFs, register every page as overview + bands
    let pageNumber = 0
    for (const [sourceIndex, source] of batch.sources.entries()) {
      const bytes = await readFile(source.file)
      const mediaType = sniffImageMediaType(bytes)
      if (isPdfName(source.name)) {
        // Per-source output directories: a later PDF must not wipe an earlier one.
        const rasterDir = join(batchDir, 'raster', `s${sourceIndex + 1}`)
        const overviewDir = join(batchDir, 'overview', `s${sourceIndex + 1}`)
        trace(batch, 'info', `光栅化 ${source.name}`, { dpi: config.pdfDpi, overviewDpi: config.overviewDpi })
        await removeIfExists(rasterDir)
        await removeIfExists(overviewDir)
        const { manifest } = await rasterizePdf(source.file, rasterDir, {
          dpi: config.pdfDpi,
          maxPages: config.maxPagesPerBatch,
          signal: input.signal,
        })
        if (manifest.pageCount > config.maxPagesPerBatch) {
          throw new Error(`扫描件共 ${manifest.pageCount} 页，超过上限 ${config.maxPagesPerBatch} 页。请拆分后分批录入，或在设置里调高上限。`)
        }
        let overviewManifest = manifest
        if (config.overviewDpi !== config.pdfDpi) {
          const rendered = await rasterizePdf(source.file, overviewDir, {
            dpi: config.overviewDpi,
            maxPages: config.maxPagesPerBatch,
            signal: input.signal,
          })
          overviewManifest = rendered.manifest
        }
        for (const entry of manifest.images) {
          pageNumber += 1
          const overviewEntry = overviewManifest.images.find((image) => image.index === entry.index)
          const page = await registerPageImages(ctx, {
            batchDir,
            pageNumber,
            rasterFile: entry.path,
            overviewFile: overviewEntry?.path,
            maxPixels: config.maxPixelsPerImage,
            relativeTo,
          })
          page.sourceName = source.name
          batch.pages.push(page)
          trace(batch, 'info', `第 ${pageNumber} 页已登记`, { size: `${page.width}x${page.height}`, bands: page.bands.length })
        }
        continue
      }
      if (mediaType === 'image/png') {
        pageNumber += 1
        const page = await registerPageImages(ctx, {
          batchDir,
          pageNumber,
          rasterFile: source.file,
          overviewFile: undefined,
          maxPixels: config.maxPixelsPerImage,
          relativeTo,
        })
        page.sourceName = source.name
        batch.pages.push(page)
        trace(batch, 'info', `第 ${pageNumber} 页已登记（图片输入）`, { size: `${page.width}x${page.height}`, bands: page.bands.length })
        continue
      }
      if (mediaType !== undefined) {
        // Non-PNG raster inputs cannot be sliced without a decoder, so they are
        // delivered whole; DSH still normalizes them to the 4 MP attachment cap.
        pageNumber += 1
        const ref = await ctx.attachments.saveImage({ data: bytes, mediaType, name: source.name })
        batch.pages.push({
          page: pageNumber,
          width: ref.width,
          height: ref.height,
          mediaType,
          sourceName: source.name,
          overview: { width: ref.width, height: ref.height, bytes: bytes.length, file: relativeTo(source.file), attachment: ref },
          bands: [],
          note: '非 PNG 图片无法切片，已整图投喂',
        })
        trace(batch, 'warn', `第 ${pageNumber} 页为非 PNG 图片，未切片`, { mediaType })
        continue
      }
      throw new Error(`不支持的扫描件格式：${source.name}。请提供 PDF 或 PNG/JPEG/WebP/GIF 图片。`)
    }

    if (batch.pages.length === 0) throw new Error('没有解析出任何页面')
    batch.status = 'rasterized'
    await writeBatch(paths, batch)

    // ---- 3. the analysis runs HERE, so the caller must be the right session
    const callerAgent = input.agent
    if (input.requireArchiveWorkspace !== false) assertInsideArchiveWorkspace(callerAgent, paths.root)
    const sessionId = requireCallerSessionId(callerAgent)
    // Kept so the workspace exists for the user to open sessions in later.
    const { workspace, created } = await ensureArchiveWorkspace(ctx, paths.root)
    if (created) trace(batch, 'info', '已创建归档工作区', { workspaceId: workspace.id, path: workspace.path })

    const { selection } = await resolveVisionRoute(ctx, config)
    trace(batch, 'info', '使用分析模型', selection)
    if (config.analysisProvider !== '' && config.analysisModel !== '') {
      await ctx.sessionController.selectModel({ sessionId, provider: selection.provider, model: selection.model })
      trace(batch, 'info', '已为本次分析切换模型', selection)
    }

    batch.session = { sessionId, mode: 'current' }
    batch.workspace = { id: workspace.id, path: workspace.path, created }
    batch.status = 'analyzing'

    // Narrow the tool surface for the duration of the analysis. The model has been
    // observed reaching for a shell and trying to crop images by hand when it has
    // one, so the restriction is applied before its first step and lifted again as
    // soon as the batch settles.
    if (config.restrictAnalysisTools) {
      const restricted = restrictAnalysisTools(ctx, sessionId)
      batch.session.toolRestriction = restricted.applied
        ? { applied: true, allow: ANALYSIS_TOOL_ALLOWLIST }
        : { applied: false, reason: restricted.reason }
      trace(batch, restricted.applied ? 'info' : 'warn', restricted.applied ? '已临时收窄会话工具集' : `工具集收窄未生效：${restricted.reason}`, batch.session.toolRestriction)
      if (restricted.applied) input.onRestriction?.(sessionId, restricted.dispose)
    }
    await writeBatch(paths, batch)

    const brief = analysisBrief({ batch, config, templates })
    if (input.deliverBrief === false) {
      // The caller is already inside a model turn (the `mistake_ingest` tool), so
      // the brief is handed back as the tool result. Sending it as a queued prompt
      // put it BEHIND the running turn: observed live, the model read the scan and
      // spent three re-cuts before the instructions ever reached it.
      batch.briefDelivered = 'tool-result'
    } else {
      await promptSession(ctx, sessionId, brief, input.signal)
      batch.briefDelivered = 'session-prompt'
    }
    trace(batch, 'info', '任务书已下发', { sessionId, via: batch.briefDelivered })
    // Let the caller remember which session owns this batch, so the batch can be
    // reconciled when that session finishes a turn.
    input.onSession?.(sessionId, batch.id)
    await writeBatch(paths, batch)

    return { batch, paths, sessionId, brief, workspace: { id: workspace.id, path: workspace.path, created } }
  } catch (error) {
    batch.status = 'failed'
    batch.error = messageOf(error)
    trace(batch, 'error', `ingest 失败：${messageOf(error)}`)
    try {
      await writeBatch(paths, batch)
    } catch {
      /* the original failure matters more */
    }
    throw error
  }
}
