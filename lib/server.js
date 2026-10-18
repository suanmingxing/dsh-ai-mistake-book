/**
 * Client-facing HTTP surface.
 *
 * The Host routes are deliberately thin: they read the same records the tools
 * write, re-derive every path from the archive root, and refuse anything that is
 * not a loopback, same-origin request.
 *
 * Archiving lives here and only here. It is a user decision, so it is reachable
 * from the plugin page and deliberately NOT exposed as an agent tool. Deleting is
 * the same kind of decision and follows the same rule.
 */
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { URL } from 'node:url'
import {
  archiveBatch,
  buildIndex,
  deleteCards,
  readDraft,
  readDrafts,
  removeDraft,
  resolveSourceImage,
  updateDraft,
} from './archive.js'
import { readCardFields, parseFrontMatter } from './frontmatter.js'
import { CARD_SECTIONS, readExportSettings, writeExportSettings } from './export-settings.js'
import { CELLS_PER_BAND, cellRectangle } from './grid.js'
import { archivePaths, messageOf, resolveInside } from './paths.js'
import { cropPng, decodePng } from './png.js'
import { listBatches, readBatch, trace, writeBatch } from './store.js'
import { releaseArchivedSession } from './session.js'
import { ensureTemplates, readTemplates, writeTemplate, saveCustomTemplate, deleteCustomTemplate } from './templates.js'
import { emptyBin, listBin, restoreFromBin } from './trash.js'

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
}

function writeJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function ok(res, value) {
  writeJson(res, 200, { ok: true, value })
}

function fail(res, error, status = 400) {
  writeJson(res, status, { ok: false, error: { message: messageOf(error) } })
}

/** Only the loopback GUI talking to its own origin may use these routes. */
function requestAllowed(req) {
  const remote = req.socket?.remoteAddress ?? ''
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  if (!loopback) return false
  const site = req.headers['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'none'
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function summarize(batch) {
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

export function registerRoutes(ctx, readConfig) {
  const disposers = []

  const api = async (method, payload) => {
    const config = readConfig()
    const paths = archivePaths(config.archiveRoot)
    switch (method) {
      case 'status':
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

      case 'batches': {
        const status = typeof payload.status === 'string' && payload.status !== '' ? payload.status : undefined
        const batches = await listBatches(paths, status === undefined ? {} : { status })
        return { batches: batches.map(summarize) }
      }

      case 'batch': {
        const batch = await readBatch(paths, String(payload.batchId))
        const drafts = await readDrafts(paths, batch)
        return {
          batch: summarize(batch),
          pages: batch.pages.map((page) => ({
            page: page.page,
            width: page.width,
            height: page.height,
            bands: page.bands.length,
            overviewFile: page.overview.file,
            bandFiles: page.bands.map((band) => band.file),
            sourceName: page.sourceName ?? null,
          })),
          candidates: (batch.candidates ?? []).map((candidate) => ({
            ref: candidate.ref,
            label: candidate.refLabel,
            knowledgePoints: candidate.knowledgePoints,
            errorTypes: candidate.errorTypes,
            difficulty: candidate.difficulty,
            uncertain: candidate.uncertain?.length ?? 0,
          })),
          selection: batch.selection ?? null,
          drafts,
          recuts: batch.recuts ?? [],
          diagnostics: batch.diagnostics ?? [],
        }
      }

      case 'draft': {
        const draft = await readDraft(paths, String(payload.batchId), String(payload.fileName))
        const source = await resolveSourceImage(paths, draft.fields, undefined)
        return {
          fileName: draft.fileName,
          markdown: draft.markdown,
          body: draft.body,
          fields: draft.fields,
          sourceImage: source?.file,
          hasUncertainty: draft.body.includes('## 待人工确认'),
        }
      }

      case 'draftUpdate': {
        const result = await updateDraft(paths, String(payload.batchId), String(payload.fileName), {
          frontMatter: payload.frontMatter,
          body: payload.body,
        })
        return { fileName: result.fileName, markdown: result.markdown }
      }

      case 'draftDrop': {
        await removeDraft(paths, String(payload.batchId), String(payload.fileName))
        const batch = await readBatch(paths, String(payload.batchId))
        batch.drafts = (batch.drafts ?? []).filter((draft) => draft.fileName !== String(payload.fileName))
        await writeBatch(paths, batch)
        return { dropped: true, remaining: batch.drafts.length }
      }

      case 'archive': {
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

      case 'library': {
        const indexFile = await readFile(paths.indexJson, 'utf8').catch(() => null)
        const index = indexFile === null ? await buildIndex(paths) : JSON.parse(indexFile)
        return { index }
      }

      case 'reindex':
        return { index: await buildIndex(paths) }

      case 'card': {
        const file = resolveInside(paths.root, String(payload.file))
        const markdown = await readFile(file, 'utf8')
        const parsed = parseFrontMatter(markdown)
        const fields = readCardFields(parsed.data)
        const source = await resolveSourceImage(paths, fields, String(payload.file))
        return { file: String(payload.file), markdown, body: parsed.body, fields, sourceImage: source?.file }
      }

      case 'export': {
        // Rendering a printable booklet is a user action like archiving, so it lives
        // on the HTTP surface rather than behind an agent tool.
        const { exportCardsToPdf } = await import('./export.js')
        return await exportCardsToPdf(paths, {
          files: Array.isArray(payload.files) ? payload.files : undefined,
          includeSource: payload.includeSource !== false,
          cropToQuestion: payload.cropToQuestion !== false,
          title: typeof payload.title === 'string' ? payload.title : undefined,
        })
      }

      case 'exports': {
        // 惰性加载：导出相关模块（docx / latex / LibreOffice 桥）不必在启动时就进内存。
        const { listExports } = await import('./export.js')
        return { files: await listExports(paths) }
      }

      case 'exportDelete': {
        const { deleteExport } = await import('./export.js')
        return await deleteExport(paths, String(payload.file ?? ''), { permanent: config.deleteToTrash === false })
      }

      case 'exportSettings': {
        // 导出 PDF 的默认板块（设置页可改），同时下发板块清单供界面渲染。
        return { settings: await readExportSettings(paths), sections: CARD_SECTIONS }
      }

      case 'exportSettingsSave': {
        return { settings: await writeExportSettings(paths, payload) }
      }

      case 'delete': {
        // The only route that removes archive entries, and it is user-driven.
        const result = await deleteCards(paths, {
          files: Array.isArray(payload.files) ? payload.files : [],
          permanent: payload.permanent === true,
          includePapers: payload.includePapers === true,
        })
        return result
      }

      case 'bin': {
        return {
          bins: await listBin(paths),
          mode: config.deleteToTrash === false ? 'permanent' : 'trash',
          retentionDays: typeof config.trashRetentionDays === 'number' ? config.trashRetentionDays : 30,
        }
      }

      case 'binRestore': {
        const result = await restoreFromBin(paths, String(payload.stamp ?? ''), Array.isArray(payload.files) ? payload.files : [])
        const index = await buildIndex(paths)
        return { ...result, totals: index.totals }
      }

      case 'binEmpty': {
        const result = await emptyBin(paths, typeof payload.stamp === 'string' && payload.stamp !== '' ? payload.stamp : undefined)
        return result
      }

      case 'render': {
        // Card bodies are Markdown with LaTeX. Rendering happens on the Host, so the
        // browser needs no Markdown parser and no KaTeX bundle: it gets finished HTML.
        const { renderMarkdown } = await import('./markdown.js')
        const { mathAvailable, mathUnavailableReason } = await import('./math.js')
        const available = mathAvailable()
        return {
          html: renderMarkdown(String(payload.markdown ?? '')),
          mathAvailable: available,
          mathError: available ? null : mathUnavailableReason(),
        }
      }

      case 'templates': {
        await ensureTemplates(paths)
        const { custom, ...editable } = await readTemplates(paths)
        // `custom` is the user's custom-template array and is delivered separately.
        // Leaving it inside `editable` made the settings page render it as a
        // template button that could never be saved ("未知模板").
        return { templates: editable, dir: paths.templates, custom }
      }

      case 'customTemplateSave': {
        return await saveCustomTemplate(paths, payload)
      }

      case 'customTemplateDelete': {
        return await deleteCustomTemplate(paths, String(payload.id ?? ''))
      }

      case 'templateSave': {
        const file = await writeTemplate(paths, String(payload.key), String(payload.content ?? ''))
        return { saved: true, file }
      }

      case 'revealArchiveRoot':
        return { path: paths.root }

      default:
        throw new Error(`未知的接口方法：${method}`)
    }
  }

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/mistake/api',
    handler: async (req, res) => {
      if (!requestAllowed(req)) {
        fail(res, new Error('forbidden'), 403)
        return
      }
      if (req.method !== 'POST') {
        fail(res, new Error('只接受 POST'), 405)
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const method = url.pathname.startsWith('/mistake/api/') ? url.pathname.slice('/mistake/api/'.length) : ''
      if (method === '' || method.includes('/')) {
        fail(res, new Error('未知的接口路径'), 404)
        return
      }
      try {
        ok(res, await api(method, await readJsonBody(req)))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/mistake/asset',
    handler: async (req, res) => {
      if (!requestAllowed(req)) {
        fail(res, new Error('forbidden'), 403)
        return
      }
      try {
        const config = readConfig()
        const paths = archivePaths(config.archiveRoot)
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const target = resolveInside(paths.root, url.searchParams.get('path') ?? '')
        const info = await stat(target)
        if (!info.isFile()) throw new Error('不是文件')
        res.writeHead(200, {
          'content-type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'content-length': String(info.size),
          'cache-control': 'no-store',
        })
        createReadStream(target).pipe(res)
      } catch (error) {
        fail(res, error, 404)
      }
    },
  }))

  /**
   * Serve the exact region a card points at, so review is "card beside its own
   * original" rather than "card beside a whole page".
   */
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/mistake/crop',
    handler: async (req, res) => {
      if (!requestAllowed(req)) {
        fail(res, new Error('forbidden'), 403)
        return
      }
      try {
        const config = readConfig()
        const paths = archivePaths(config.archiveRoot)
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const file = resolveInside(paths.root, url.searchParams.get('file') ?? '')
        const cell = Number(url.searchParams.get('cell'))
        const bytes = await readFile(file)
        let out = bytes
        if (Number.isFinite(cell) && cell >= 1 && cell <= CELLS_PER_BAND) {
          const decoded = decodePng(bytes)
          const rect = cellRectangle({ width: decoded.width, height: decoded.height }, cell)
          out = cropPng(bytes, rect).buffer
        }
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(out.length), 'cache-control': 'no-store' })
        res.end(out)
      } catch (error) {
        fail(res, error, 404)
      }
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        /* already disposed */
      }
    }
  }
}
