/**
 * AI 错题本 — host half.
 *
 * `/mistake` (or the `mistake_ingest` tool) turns an attached scan into:
 *   a batch under <archiveRoot>/inbox/<batchId>, and
 *   a new analysis session attached to the <archiveRoot> workspace.
 * The session reads the pages through `mistake_pages`, so nothing is ever parsed
 * from a raw file path by the model itself.
 */
import { Config, liveConfig } from './lib/config.js'
import { ingestBatch } from './lib/ingest.js'
import { archivePaths, messageOf } from './lib/paths.js'
import { registerRoutes } from './lib/server.js'
import { reconcileBatch } from './lib/store.js'
import { registerTools } from './lib/tools.js'

export const name = 'ai-mistake-book'

/** Hard dependencies: without any of these the plugin must not pretend to work. */
export const inject = [
  'commands',
  'tools',
  'attachments',
  'workspaceRegistry',
  'sessionController',
  'agents',
  'llm',
  'agentDefaultModel',
  'webServer',
]

export { Config }

export function apply(ctx, config) {
  const state = { lastDelivery: null, analysisSessions: new Map(), toolRestrictions: new Map() }
  const readConfig = () => liveConfig(ctx, config)
  const trackSession = (sessionId, batchId) => state.analysisSessions.set(sessionId, batchId)
  const trackRestriction = (sessionId, dispose) => state.toolRestrictions.set(sessionId, dispose)

  /** Give a session its tools back once its analysis has settled. */
  const liftRestriction = (sessionId) => {
    const dispose = state.toolRestrictions.get(sessionId)
    if (dispose === undefined) return
    state.toolRestrictions.delete(sessionId)
    try {
      dispose()
    } catch {
      /* already gone with the agent */
    }
  }

  ctx.effect(() => registerTools(ctx, readConfig, state), 'ai-mistake-book: agent tools')
  ctx.effect(() => registerRoutes(ctx, readConfig), 'ai-mistake-book: client routes')

  /**
   * Settle a batch when its session finishes a turn, and hand the session its
   * normal tools back. Without the settle, a session that ends without extracting
   * anything leaves the batch stuck on "analyzing" and the review page keeps
   * showing a run that is long over.
   */
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    const batchId = state.analysisSessions.get(session?.id)
    if (batchId === undefined) return
    reconcileBatch(archivePaths(readConfig().archiveRoot), batchId)
      .then((status) => {
        if (status === 'awaiting-confirmation' || status === 'analysis-ended' || status === 'archived') liftRestriction(session.id)
      })
      .catch((error) => ctx.logger?.warn?.(`ai-mistake-book: 批次状态收口失败 ${batchId}: ${messageOf(error)}`))
  }), 'ai-mistake-book: batch lifecycle')

  ctx.effect(() => ctx.commands.register({
    name: 'mistake',
    description: 'AI 错题本：把扫描试卷建成一个批次，并在当前会话里分析（只在本插件工作区的会话里生效）。',
    input: {
      hint: '错题题号（如 5,9,12）或说明；也可直接给 PDF/图片的绝对路径',
      attachments: true,
    },
    handler: async (invocation) => {
      const started = Date.now()
      try {
        const { batch, sessionId, workspace } = await ingestBatch(ctx, readConfig(), {
          attachments: invocation.attachments,
          hint: invocation.rawInput,
          origin: 'command',
          signal: invocation.signal,
          agent: invocation.agent,
          requireArchiveWorkspace: true,
          onSession: trackSession,
          onRestriction: trackRestriction,
        })
        const bands = batch.pages[0]?.bands?.length ?? 0
        const text = [
          `已建立批次 ${batch.id}`,
          `· 来源：${batch.sources.map((source) => source.name).join('、')}`,
          `· 页面：${batch.pages.length} 页，每页投喂 ${1 + bands} 张图（1 张整页 + ${bands} 条高清横带）`,
          `· 分析就在本会话继续进行（会话 ${sessionId}）`,
          `· 工作区：${workspace.path}`,
          `· 用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`,
          '',
          '分析期间本会话的工具会被临时收窄到 4 个（读页面、提交候选、提交决定、问你确认），结束或停止后自动恢复。',
          '分析完成后，回到「设置 → AI 错题本」确认归档。',
        ].join('\n')
        return { kind: 'success', text }
      } catch (error) {
        return { kind: 'error', text: `AI 错题本：${messageOf(error)}` }
      }
    },
  }), 'ai-mistake-book: /mistake command')
}
