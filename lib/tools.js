/**
 * Agent tools. Per DSH's "one operation, two callers" rule the ingest operation
 * lives in ingest.js and is exposed here and through the `/mistake` command, so
 * the tool path and the command path can never diverge.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cardFileName, nextCardId, renderCard, subjectKey } from './card.js'
import { CELLS_PER_BAND, cellRectangle, planRecut } from './grid.js'
import { cleanText, normalizeCandidate, normalizeRef, parseReportedRefs, parseTaxonomy } from './normalize.js'
import { archivePaths, nowStamp, removeIfExists, resolveInside } from './paths.js'
import { cropPng } from './png.js'
import { ingestBatch } from './ingest.js'
import { cancelAnalysisSession } from './session.js'
import { listBatches, readBatch, trace, writeBatch } from './store.js'
import { ensureTemplates, readTemplates } from './templates.js'

/** What the model is asked to produce for each wrong question. */
const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ref'],
  properties: {
    ref: { type: 'string', description: '卷面题号，如 "8"。' },
    wrong: { type: 'boolean', description: '是否判定为错题，默认 true。' },
    basis: { type: 'string', description: '判定依据，例如"用户报了第 8 题""该题作答被长斜线划掉"。' },
    stem: { type: 'string', description: '题干转录，行内公式用 LaTeX，不加定界符。' },
    myAnswer: { type: 'string', description: '学生在卷面上写下的作答。' },
    myAnswerStruck: { type: 'boolean', description: '该作答是否被划改/划掉。' },
    revisedAnswer: { type: 'string', description: '划改后改写成了什么。' },
    myWork: { type: 'string', description: '页边/空白处的演算过程，照抄原样。' },
    annotatedAnswer: { type: 'string', description: '学生自己在卷面上标注的正确答案。没有就留空。' },
    annotatedMethod: { type: 'string', description: '学生自己标注的正确解法或技巧。没有就留空。' },
    knowledgePoints: { type: 'array', items: { type: 'string' }, description: '多级知识点，形如 "函数/函数的单调性"。' },
    skills: { type: 'array', items: { type: 'string' }, description: '解题技巧短句。' },
    errorTypes: { type: 'array', items: { type: 'string' }, description: '错因，取自分类模板。' },
    difficulty: { type: 'string', enum: ['易', '中', '难'] },
    confidence: { type: 'number', description: '0..1，你对本次提取整体的把握。' },
    extraSections: {
      type: 'array',
      description: '自定义板块内容（任务书「自定义板块要求」里列出的标题）；没有就留空。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'content'],
        properties: {
          title: { type: 'string', description: '板块标题，必须与任务书给出的标题完全一致。' },
          content: { type: 'string', description: '该板块的正文，按任务书里的说明书写。' },
        },
      },
    },
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        page: { type: 'integer' },
        band: { type: 'integer' },
        cell: { type: 'integer' },
        note: { type: 'string' },
      },
    },
    uncertain: {
      type: 'array',
      description: '读不准之处。宁可多报，不要猜。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what'],
        properties: {
          what: { type: 'string', description: '读不准的是什么。' },
          where: { type: 'string', description: '第几页、哪条带、哪个位置。' },
          blocking: { type: 'boolean', description: '是否严重到不该直接归档。' },
        },
      },
    },
  },
}

const IMAGE_REF_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
  },
  required: ['attachmentId'],
}

const PAGES_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'images'],
  properties: {
    summary: { type: 'string' },
    images: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['attachment', 'label'],
        properties: {
          label: { type: 'string' },
          kind: { type: 'string', enum: ['overview', 'band', 'recut'] },
          page: { type: 'integer' },
          attachment: IMAGE_REF_SCHEMA,
        },
      },
    },
  },
}

function blockForImage(image) {
  return [
    { type: 'text', text: image.label },
    { type: 'image', attachment: image.attachment },
  ]
}

/** Drop undefined members so a returned value always satisfies its JSON schema. */
function compact(value) {
  const out = {}
  for (const [key, member] of Object.entries(value)) {
    if (member !== undefined) out[key] = member
  }
  return out
}

function selectPages(batch, args) {
  const total = batch.pages.length
  if (total === 0) throw new Error(`批次 ${batch.id} 还没有任何页面（状态：${batch.status}）`)
  const byPage = Number.isInteger(args.page) ? args.page : undefined
  const from = byPage ?? (Number.isInteger(args.from) ? args.from : 1)
  const count = Number.isInteger(args.count) && args.count > 0 ? args.count : undefined
  if (from < 1 || from > total) throw new Error(`页码超出范围：本批次共 ${total} 页，请求第 ${from} 页`)
  const end = count === undefined ? (byPage === undefined ? total : from) : Math.min(total, from + count - 1)
  return batch.pages.filter((page) => page.page >= from && page.page <= end)
}

/** A band is offered to the model as a 3x3 grid of cells, numbered left-to-right then top-to-bottom. */
export const CELL_COLUMNS = 3
export const CELL_ROWS = 3

export function registerTools(ctx, readConfig, state) {
  const disposers = []

  disposers.push(ctx.tools.register({
    name: 'mistake_pages',
    description: [
      'Read the scanned pages of one AI 错题本 batch as images.',
      'A page is delivered as one whole-page overview plus full-width band slices; the bands carry more resolution than the overview.',
      'If a band is still not legible, call again with that band and one cell (1..9, a 3x3 split of the band) to receive that area re-cut at maximum sampling resolution.',
      'A re-cut is re-rendered from the source, not an enlargement of what you already saw, so it can reveal detail the band could not carry.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        batchId: { type: 'string', description: 'Batch id from the task brief, e.g. b-20261001-024715.' },
        page: { type: 'integer', description: 'Deliver exactly this page (1-based). Omit to continue from `from`.' },
        from: { type: 'integer', description: 'First page when reading several pages at once (1-based, default 1).' },
        count: { type: 'integer', description: 'How many pages to deliver. Omit to deliver a single page when `page` is set, otherwise every page.' },
        band: { type: 'integer', description: 'Deliver only this band of the page (1-based), instead of the whole page.' },
        cell: { type: 'integer', description: `With \`band\`, re-cut that cell (1..${CELLS_PER_BAND}) at native resolution. Only use this when the band was not legible.` },
      },
      required: ['batchId'],
    },
    output: {
      schema: PAGES_OUTPUT_SCHEMA,
      render(args, value) {
        const blocks = [{ type: 'text', text: value.summary }]
        for (const image of value.images ?? []) blocks.push(...blockForImage(image))
        return blocks
      },
    },
    async execute(args) {
      const config = readConfig()
      const paths = archivePaths(config.archiveRoot)
      const batch = await readBatch(paths, String(args.batchId))
      const selected = selectPages(batch, args)
      const images = []
      const lines = []

      // ---- re-cut path: band + cell -----------------------------------------
      if (Number.isInteger(args.cell) || Number.isInteger(args.band)) {
        const page = selected[0]
        const bands = page.bands ?? []
        if (bands.length === 0) throw new Error(`第 ${page.page} 页没有横带（该页未切片），无法重切。请改用整页概览。`)
        const bandIndex = Number.isInteger(args.band) ? args.band : undefined
        if (bandIndex === undefined) throw new Error('给了 cell 就必须同时给出 band（cell 是横带内的 3×3 分格）；只给 band 会投喂整条横带，两者都省略则读取整页。')
        const band = bands.find((entry) => entry.index === bandIndex)
        if (band === undefined) throw new Error(`横带超出范围：第 ${page.page} 页共 ${bands.length} 条横带`)

        let entry
        if (Number.isInteger(args.cell)) {
          const cell = cellRectangle(band, args.cell)
          // A budget stops a model from grinding through every cell instead of
          // recording what it could not read.
          const usedRecuts = (batch.recuts ?? []).filter((entry) => entry.page === page.page).length
          if (usedRecuts >= config.maxRecutsPerPage) {
            throw new Error(`第 ${page.page} 页的重切次数已达上限 ${config.maxRecutsPerPage} 次。请停止索取，把仍然读不准的地方写进 uncertain 并调用 mistake_stage。`)
          }
          const plan = planRecut({
            bandWidth: band.width,
            bandHeight: band.height,
            focusLeft: cell.x,
            focusRight: cell.x + cell.width,
            focusTop: cell.y,
            focusBottom: cell.y + cell.height,
          })
          if (plan === null) throw new Error('这条横带已经以原生分辨率投喂，无法再提高清晰度。请把读不准的地方记入 uncertain。')
          if (plan.gain < 1.1) {
            throw new Error(`重切收益仅 ${plan.gain.toFixed(2)}×（这条横带已接近原生分辨率），不值得再投喂。请把读不准的地方记入 uncertain，交由人工确认。`)
          }
          // Pointing at two cells can resolve to the same window; saying so beats
          // silently resending a byte-identical image, which reads as a broken tool.
          const rectKey = `${page.page}:${bandIndex}:${plan.rect.x},${plan.rect.y},${plan.rect.width},${plan.rect.height}`
          const already = (batch.recuts ?? []).find((entry) => entry.rectKey === rectKey)
          if (already !== undefined) {
            const lines2 = [
              `第 ${page.page} 页横带 ${bandIndex} 第 ${args.cell} 格解析出的窗口，与你已经收到的第 ${already.cell} 格窗口完全相同（x=${plan.rect.x}, y=${band.y + plan.rect.y}, ${plan.rect.width}×${plan.rect.height}）。`,
              '同一块区域不会因为再要一次而变得更清楚。请换一个相邻的格，或把这里读不准的内容写进 uncertain 后调用 mistake_stage。',
            ]
            batch.delivery = {
              calls: (batch.delivery?.calls ?? 0) + 1,
              images: batch.delivery?.images ?? 0,
              recuts: batch.delivery?.recuts ?? 0,
              duplicateRecuts: (batch.delivery?.duplicateRecuts ?? 0) + 1,
              lastAt: new Date().toISOString(),
              lastPages: [page.page],
            }
            trace(batch, 'warn', '重复重切被拦截', { page: page.page, band: bandIndex, cell: args.cell, sameAs: already.cell })
            await writeBatch(paths, batch)
            return { summary: lines2.join('\n'), images: [] }
          }
          const sourceFile = resolveInside(paths.root, band.file)
          const cropped = cropPng(await readFile(sourceFile), plan.rect)
          const attachment = await ctx.attachments.saveImage({
            data: cropped.buffer,
            mediaType: 'image/png',
            name: `page-${String(page.page).padStart(4, '0')}-band-${String(bandIndex).padStart(2, '0')}-cell-${args.cell}.png`,
          })
          entry = {
            label: [
              `第 ${page.page} 页 横带 ${bandIndex} 第 ${args.cell} 格 → 原生分辨率重切`,
              `（${cropped.width}×${cropped.height}，源图区域 x=${plan.rect.x}–${plan.rect.x + plan.rect.width}、y=${band.y + plan.rect.y}–${band.y + plan.rect.y + plan.rect.height}，采样密度 ${plan.gain.toFixed(2)}× 于原横带）`,
              `这是从源图重新裁切的，不是放大。本页还可重切 ${config.maxRecutsPerPage - usedRecuts - 1} 次；若此处仍不可辨，请记入 uncertain。`,
            ].join(''),
            kind: 'recut',
            page: page.page,
            attachment,
          }
          lines.push(`重切：第 ${page.page} 页横带 ${bandIndex} 第 ${args.cell} 格，窗口 ${cropped.width}×${cropped.height}，采样密度提升 ${plan.gain.toFixed(2)}×（本页剩余 ${config.maxRecutsPerPage - usedRecuts - 1} 次）`)
          if (!Array.isArray(batch.recuts)) batch.recuts = []
          batch.recuts.push({
            at: new Date().toISOString(),
            page: page.page,
            band: bandIndex,
            cell: args.cell,
            rectKey,
            rect: { ...plan.rect, sourceY: band.y + plan.rect.y },
            gain: Number(plan.gain.toFixed(3)),
          })
          trace(batch, 'info', '区域重切', { page: page.page, band: bandIndex, cell: args.cell, gain: plan.gain.toFixed(3) })
        } else {
          entry = {
            label: `第 ${page.page} 页 横带 ${bandIndex}/${bands.length}（y=${band.y}, ${band.width}×${band.height}）｜如需局部放大，用 band=${bandIndex}&cell=1..${CELLS_PER_BAND}`,
            kind: 'band',
            page: page.page,
            attachment: band.attachment,
          }
          lines.push(`单独投喂：第 ${page.page} 页横带 ${bandIndex}`)
        }
        images.push(entry)
        batch.delivery = {
          calls: (batch.delivery?.calls ?? 0) + 1,
          images: (batch.delivery?.images ?? 0) + images.length,
          recuts: (batch.delivery?.recuts ?? 0) + (Number.isInteger(args.cell) ? 1 : 0),
          lastAt: new Date().toISOString(),
          lastPages: [page.page],
        }
        await writeBatch(paths, batch)
        return { summary: lines.join('\n'), images }
      }

      // ---- normal path: overview + bands ------------------------------------
      lines.push(`批次 ${batch.id}｜共 ${batch.pages.length} 页｜本次投喂第 ${selected[0].page}–${selected[selected.length - 1].page} 页`)
      for (const page of selected) {
        images.push({
          label: `第 ${page.page} 页 整页概览（${page.width}×${page.height}）`,
          kind: 'overview',
          page: page.page,
          attachment: page.overview.attachment,
        })
        lines.push(`第 ${page.page} 页：${page.width}×${page.height}，概览 1 张，横带 ${page.bands.length} 条`)
        for (const band of page.bands) {
          images.push({
            label: `第 ${page.page} 页 横带 ${band.index}/${page.bands.length}（y=${band.y}, ${band.width}×${band.height}）｜如需局部放大，用 band=${band.index}&cell=1..${CELLS_PER_BAND}`,
            kind: 'band',
            page: page.page,
            attachment: band.attachment,
          })
        }
      }
      lines.push('提示：横带是同一页的纵向切片，从上到下依次排列；整页概览用于定位题号。读不准时用 band + cell 索取原生分辨率重切。')
      batch.delivery = {
        calls: (batch.delivery?.calls ?? 0) + 1,
        images: (batch.delivery?.images ?? 0) + images.length,
        recuts: batch.delivery?.recuts ?? 0,
        lastAt: new Date().toISOString(),
        lastPages: selected.map((page) => page.page),
      }
      trace(batch, 'info', `mistake_pages 投喂`, { pages: batch.delivery.lastPages, images: images.length })
      await writeBatch(paths, batch)
      return { summary: lines.join('\n'), images }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'mistake_ingest',
    description: [
      'Start an AI 错题本 ingest run from a scanned exam PDF or image already on disk, and hand back the analysis brief so the calling session can run it.',
      'Use this when the user asks to file a paper from a file path rather than attaching it to the /mistake command.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source_path: { type: 'string', description: 'Absolute path to the scanned PDF or image.' },
        hint: { type: 'string', description: 'Which questions are wrong, e.g. "5,9,12" or "打叉的是错题".' },
        subject: { type: 'string', description: 'Subject key such as math or english.' },
      },
      required: ['source_path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['batchId', 'sessionId', 'pages', 'summary'],
        properties: {
          batchId: { type: 'string' },
          sessionId: { type: 'string' },
          workspaceId: { type: 'string' },
          pages: { type: 'integer' },
          summary: { type: 'string' },
          brief: { type: 'string' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.summary }]
      },
    },
    async execute(args, exec) {
      const config = readConfig()
      const { batch, sessionId, workspace, brief } = await ingestBatch(ctx, config, {
        sourcePaths: [String(args.source_path)],
        hint: typeof args.hint === 'string' ? args.hint : '',
        subject: typeof args.subject === 'string' ? args.subject : undefined,
        origin: 'tool',
        signal: exec?.signal,
        agent: exec?.agent,
        // The assistant calls this deliberately, so the workspace guard is the
        // command's rule rather than a blanket restriction on the tool.
        requireArchiveWorkspace: false,
        // Hand the brief back in this tool result instead of queueing it as a
        // prompt: a queued prompt lands behind the turn already in progress, and
        // the model was observed reading the scan before the instructions arrived.
        deliverBrief: false,
        onSession: (sessionId, batchId) => state.analysisSessions?.set(sessionId, batchId),
        onRestriction: (sessionId, dispose) => state.toolRestrictions?.set(sessionId, dispose),
      })
      const summary = [
        `批次 ${batch.id} 已建立：${batch.pages.length} 页，来源 ${batch.sources.map((source) => source.name).join('、')}`,
        `分析在本会话继续：${sessionId}（工作区 ${workspace.path}）`,
        `每页投喂 ${1 + (batch.pages[0]?.bands?.length ?? 0)} 张图（1 整页 + ${batch.pages[0]?.bands?.length ?? 0} 横带）`,
        '本会话的工具已被临时收窄到 4 个（读页面、提交候选、提交决定、问用户确认），批次落定后自动恢复。',
        '',
        '以下是本次分析必须遵循的任务书，请立即按它执行：',
        '',
        brief,
      ].join('\n')
      return { batchId: batch.id, sessionId, workspaceId: workspace.id, pages: batch.pages.length, summary, brief }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'mistake_batches',
    description: 'List AI 错题本 batches with their status, page count and analysis session, newest first.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', description: 'Optional filter: ingesting, rasterized, analyzing, staged, awaiting-confirmation, analysis-ended, archived, cancelled, failed.' },
        limit: { type: 'integer', description: 'Maximum rows to return, default 20.' },
      },
      required: [],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'batches'],
        properties: {
          summary: { type: 'string' },
          batches: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                pages: { type: 'integer' },
                sessionId: { type: 'string' },
                error: { type: 'string' },
                createdAt: { type: 'string' },
              },
              required: ['id', 'status'],
            },
          },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.summary }]
      },
    },
    async execute(args) {
      const config = readConfig()
      const paths = archivePaths(config.archiveRoot)
      const all = await listBatches(paths, typeof args.status === 'string' && args.status !== '' ? { status: args.status } : {})
      const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 20
      const rows = all.slice(0, limit).map((batch) => compact({
        id: batch.id,
        status: batch.status,
        pages: batch.pages?.length ?? 0,
        sessionId: batch.session?.sessionId,
        error: batch.error ?? undefined,
        createdAt: batch.createdAt,
        delivery: batch.delivery,
      }))
      const summary = rows.length === 0
        ? '暂无批次。'
        : rows.map((row) => `${row.id}｜${row.status}｜${row.pages} 页｜投喂 ${row.delivery?.images ?? 0} 图｜${row.error ?? ''}`.trim()).join('\n')
      return { summary, batches: rows }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'mistake_cancel',
    description: [
      'Stop the running analysis session of one AI 错题本 batch without deleting anything.',
      'Use it when a session has gone off task, is looping, or is sitting on a question that no longer matters.',
      'The batch and its staged candidates are kept; use mistake_discard afterwards if the batch should also go.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        batchId: { type: 'string', description: 'Batch whose analysis session should stop.' },
        reason: { type: 'string', description: 'Why it is being stopped; recorded on the batch.' },
      },
      required: ['batchId'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'cancelled'],
        properties: {
          summary: { type: 'string' },
          cancelled: { type: 'boolean' },
          sessionId: { type: 'string' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.summary }]
      },
    },
    async execute(args) {
      const config = readConfig()
      const paths = archivePaths(config.archiveRoot)
      const batch = await readBatch(paths, String(args.batchId))
      const sessionId = batch.session?.sessionId
      const result = await cancelAnalysisSession(ctx, sessionId)
      if (result.cancelled) {
        batch.status = batch.status === 'archived' ? batch.status : 'cancelled'
        trace(batch, 'warn', '分析会话已被停止', { sessionId, reason: args.reason ?? '' })
        await writeBatch(paths, batch)
      }
      const summary = result.cancelled
        ? `已停止批次 ${batch.id} 的分析会话（${sessionId}）${args.reason ? `，原因：${args.reason}` : ''}。批次本身保留。`
        : `没能停止会话：${result.reason ?? '未知原因'}。批次 ${batch.id} 未改动。`
      return compact({ cancelled: result.cancelled, sessionId, summary })
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'mistake_discard',
    description: [
      'Stop the analysis session of one AI 错题本 batch, then delete the batch and everything it staged.',
      'Use it to clear a failed ingest or a batch the user decided not to keep. Already archived cards are untouched.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        batchId: { type: 'string', description: 'Batch id to delete.' },
        confirm: { type: 'boolean', description: 'Must be true; guards against an accidental delete.' },
      },
      required: ['batchId', 'confirm'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'removed'],
        properties: {
          summary: { type: 'string' },
          removed: { type: 'boolean' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.summary }]
      },
    },
    async execute(args) {
      if (args.confirm !== true) throw new Error('删除批次需要 confirm=true')
      const config = readConfig()
      const paths = archivePaths(config.archiveRoot)
      const batch = await readBatch(paths, String(args.batchId))
      if (batch.status === 'archived') throw new Error(`批次 ${batch.id} 已归档，不能这样删除。请直接在归档目录里处理。`)
      // Stop the session first: deleting the batch out from under a live session
      // leaves it running and asking questions about files that no longer exist.
      const stopped = await cancelAnalysisSession(ctx, batch.session?.sessionId)
      await removeIfExists(paths.batchDir(batch.id))
      return {
        removed: true,
        summary: `已删除批次 ${batch.id}（原状态 ${batch.status}）${stopped.cancelled ? '，其分析会话已停止' : ''}。`,
      }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'mistake_stage',
    description: [
      'Submit the wrong questions you extracted from one AI 错题本 batch.',
      'Call it once with every candidate. Transcribe what the student actually wrote; leave a field empty rather than inventing content.',
      'Anything you could not read must appear in that question\'s `uncertain` list — that is what the human will check.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['batchId', 'candidates'],
      properties: {
        batchId: { type: 'string' },
        candidates: { type: 'array', minItems: 1, items: CANDIDATE_SCHEMA },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'staged', 'warnings'],
        properties: {
          summary: { type: 'string' },
          staged: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['ref'],
              properties: {
                ref: { type: 'string' },
                label: { type: 'string' },
                knowledgePoints: { type: 'array', items: { type: 'string' } },
                errorTypes: { type: 'array', items: { type: 'string' } },
                difficulty: { type: 'string' },
                uncertain: { type: 'integer' },
                blocking: { type: 'boolean' },
              },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.summary }]
      },
    },
    async execute(args) {
      const config = readConfig()
      const paths = archivePaths(config.archiveRoot)
      await ensureTemplates(paths)
      const templates = await readTemplates(paths)
      const taxonomy = parseTaxonomy(templates.errorTaxonomy)
      const batch = await readBatch(paths, String(args.batchId))
      const fallbackPage = batch.pages[0]?.page ?? 1
      const customTemplates = Array.isArray(templates.custom) ? templates.custom : []
      const normalized = args.candidates.map((raw) => normalizeCandidate(raw, { taxonomy, fallbackPage, customTemplates }))

      if (!Array.isArray(batch.candidates)) batch.candidates = []
      const warnings = []
      for (const candidate of normalized) {
        if (candidate.ref === '') {
          warnings.push('有一条候选没有可用的题号，已跳过。')
          continue
        }
        const existing = batch.candidates.findIndex((entry) => entry.ref === candidate.ref)
        if (existing === -1) batch.candidates.push(candidate)
        else batch.candidates[existing] = candidate
        if (candidate.unknownErrorTypes.length > 0) {
          warnings.push(`${candidate.refLabel}：错因"${candidate.unknownErrorTypes.join('、')}"不在分类模板中，已原样保留。`)
        }
        if (candidate.unknownCustomSections.length > 0) {
          warnings.push(`${candidate.refLabel}：extraSections 里的"${candidate.unknownCustomSections.join('、')}"不是当前启用的自定义板块，已忽略。`)
        }
        if (candidate.uncertain.some((item) => item.blocking)) {
          warnings.push(`${candidate.refLabel}：有阻断归档的不确定项，归档前必须人工确认。`)
        }
      }

      const reported = parseReportedRefs(batch.hint)
      const stagedRefs = new Set(batch.candidates.map((entry) => entry.ref))
      for (const ref of reported) {
        if (!stagedRefs.has(ref)) warnings.push(`用户在命令里报了第 ${ref} 题，但候选里没有它——请确认是漏读还是题号有误。`)
      }

      batch.status = 'staged'
      trace(batch, 'info', 'mistake_stage 提交候选', { count: normalized.length, total: batch.candidates.length })
      await writeBatch(paths, batch)

      const staged = batch.candidates.map((entry) => ({
        ref: entry.ref,
        label: entry.refLabel,
        knowledgePoints: entry.knowledgePoints,
        errorTypes: entry.errorTypes,
        difficulty: entry.difficulty,
        uncertain: entry.uncertain.length,
        blocking: entry.uncertain.some((item) => item.blocking),
      }))
      const summary = [
        `已登记 ${normalized.length} 条候选；本批次当前共 ${batch.candidates.length} 条。`,
        ...staged.map((entry) => `· ${entry.label}｜${entry.knowledgePoints.join('；') || '（未标知识点）'}｜错因 ${entry.errorTypes.join('、') || '未标'}｜难度 ${entry.difficulty}｜待确认 ${entry.uncertain}${entry.blocking ? '（含阻断项）' : ''}`),
        warnings.length > 0 ? `\n注意：\n${warnings.map((line) => `· ${line}`).join('\n')}` : '',
        '\n下一步：用 ask_user_question 让用户确认哪几题需要整理，然后用 mistake_select 提交决定。',
      ].join('\n')
      return { summary, staged, warnings }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'mistake_select',
    description: [
      'Record which staged candidates the user decided to keep, then generate the card drafts.',
      'Call it only after the user confirmed the set with ask_user_question. Drafts are not archived: the user still confirms them in the plugin page.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['batchId', 'keep'],
      properties: {
        batchId: { type: 'string' },
        keep: { type: 'array', items: { type: 'string' }, description: 'Question refs to organize, e.g. ["5","9","12"].' },
        drop: {
          type: 'array',
          description: 'Candidates the user decided not to organize.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['ref'],
            properties: { ref: { type: 'string' }, reason: { type: 'string' } },
          },
        },
        paperTitle: { type: 'string', description: 'Optional title for this paper, used as the archive folder name.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'drafted', 'warnings'],
        properties: {
          summary: { type: 'string' },
          drafted: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ref', 'id', 'fileName'],
              properties: { ref: { type: 'string' }, id: { type: 'string' }, fileName: { type: 'string' } },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.summary }]
      },
    },
    async execute(args) {
      const config = readConfig()
      const paths = archivePaths(config.archiveRoot)
      await ensureTemplates(paths)
      const templates = await readTemplates(paths)
      const batch = await readBatch(paths, String(args.batchId))
      const staged = Array.isArray(batch.candidates) ? batch.candidates : []
      if (staged.length === 0) throw new Error('这个批次还没有候选错题，请先调用 mistake_stage。')

      const subject = subjectKey(batch.subject ?? 'math')
      const keepRefs = (args.keep ?? []).map(normalizeRef).filter((ref) => ref !== '')
      const dropRefs = (args.drop ?? []).map((entry) => ({ ref: normalizeRef(entry?.ref), reason: cleanText(entry?.reason) }))
      const warnings = []
      for (const ref of [...keepRefs, ...dropRefs.map((entry) => entry.ref)]) {
        if (!staged.some((entry) => entry.ref === ref)) warnings.push(`题号 ${ref} 不在候选清单里，已忽略。`)
      }
      const selected = staged.filter((entry) => keepRefs.includes(entry.ref))
      if (selected.length === 0) throw new Error('keep 里没有匹配到任何候选题号，未生成任何草稿。')

      const reported = parseReportedRefs(batch.hint)
      for (const ref of reported) {
        if (!keepRefs.includes(ref) && !dropRefs.some((entry) => entry.ref === ref)) {
          warnings.push(`用户在命令里报了第 ${ref} 题，但既没进 keep 也没进 drop。`)
        }
      }

      const paperTitle = cleanText(args.paperTitle) !== ''
        ? cleanText(args.paperTitle)
        : `${nowStamp()} ${batch.sources[0]?.name?.replace(/\.[^.]+$/, '') ?? batch.id}`
      batch.paperTitle = paperTitle

      const cardsDir = join(paths.batchDir(batch.id), 'cards')
      await mkdir(cardsDir, { recursive: true })
      const reserved = []
      const drafted = []
      for (const candidate of selected) {
        const id = await nextCardId(paths.library, subject, reserved)
        reserved.push(Number(id.split('-')[1]))
        const card = {
          ...candidate,
          id,
          subject,
          paper: paperTitle,
          questionRef: candidate.refLabel,
          verdict: candidate.wrong ? 'wrong' : 'uncertain',
          provenance: { batch: batch.id, session: batch.session?.sessionId ?? null, sourceFile: batch.sources[0]?.name ?? null },
          createdAt: new Date().toISOString(),
          status: 'draft',
        }
        card.fileName = cardFileName(config.fileNamePattern, card)
        card.markdown = renderCard(card)
        await writeFile(join(cardsDir, card.fileName), card.markdown, 'utf8')
        drafted.push({ ref: candidate.ref, id, fileName: card.fileName, markdown: card.markdown, knowledgePoints: candidate.knowledgePoints })
      }

      batch.selection = { keep: keepRefs, drop: dropRefs, decidedAt: new Date().toISOString() }
      batch.drafts = drafted.map(({ markdown, ...rest }) => rest)
      batch.status = 'awaiting-confirmation'
      trace(batch, 'info', 'mistake_select 生成卡片草稿', { kept: drafted.length, dropped: dropRefs.length })
      await writeBatch(paths, batch)

      const summary = [
        `已生成 ${drafted.length} 张卡片草稿，等待你在插件页面里确认归档。`,
        ...drafted.map((entry) => `· ${entry.id}｜${entry.ref}｜${entry.fileName}`),
        dropRefs.length > 0 ? `\n未整理：${dropRefs.map((entry) => `${entry.ref}${entry.reason === '' ? '' : `（${entry.reason}）`}`).join('、')}` : '',
        warnings.length > 0 ? `\n注意：\n${warnings.map((line) => `· ${line}`).join('\n')}` : '',
        '\n草稿位置：inbox/' + batch.id + '/cards/。正式归档需要用户在「设置 → AI 错题本」里确认。',
      ].filter((line) => line !== '').join('\n')
      return { summary, drafted: drafted.map(({ ref, id, fileName }) => ({ ref, id, fileName })), warnings }
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
