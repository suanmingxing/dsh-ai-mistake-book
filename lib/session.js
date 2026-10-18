/**
 * Creating and driving the analysis session.
 *
 * The session is an ordinary session attached to the archive workspace, so it
 * shows up in that workspace's session list and the user can keep talking to it.
 * `create` rejects `workspaceId` and `cwd` together, so only `workspaceId` is sent
 * and the working directory follows from the workspace path.
 */
import { randomUUID } from 'node:crypto'
import { messageOf } from './paths.js'

export const WORKSPACE_TITLE = 'AI 错题本'

/**
 * The analysis session reads a scan and reports; it is not a general agent.
 * Left unrestricted it reaches for a shell, tries to crop images by hand, and
 * ends up debugging the sandbox instead of reading the paper — observed live.
 * Restricting its tool surface is the fix, and it is also the clearest possible
 * signal to the model about what its job is.
 */
export const ANALYSIS_TOOL_ALLOWLIST = ['mistake_pages', 'mistake_stage', 'mistake_select', 'ask_user_question']

export function restrictAnalysisTools(ctx, sessionId) {
  try {
    const agent = ctx.get('agents')?.get?.(sessionId)
    const agentCtx = agent?.ctx
    if (agentCtx?.tools?.restrict === undefined) return { applied: false, reason: '分析会话的 agent context 尚不可用' }
    const dispose = agentCtx.tools.restrict({ allow: ANALYSIS_TOOL_ALLOWLIST })
    return { applied: true, dispose }
  } catch (error) {
    return { applied: false, reason: messageOf(error) }
  }
}

/**
 * Stop the running turn of an analysis session.
 *
 * Without this, a session that wandered off — or that is sitting on a question
 * nobody wants to answer — keeps occupying the workspace and its own inbox, and
 * the only way out is the DSH UI. Cancelling is paired with every discard.
 */
export async function cancelAnalysisSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return { cancelled: false, reason: '这个批次没有分析会话' }
  try {
    const result = await ctx.sessionController.cancel({ sessionId })
    return { cancelled: result?.accepted === true }
  } catch (error) {
    return { cancelled: false, reason: messageOf(error) }
  }
}

export async function ensureArchiveWorkspace(ctx, archiveRoot) {
  const existing = await ctx.workspaceRegistry.resolveByPath(archiveRoot)
  if (existing !== undefined) return { workspace: existing, created: false }
  const workspace = await ctx.workspaceRegistry.create(archiveRoot, WORKSPACE_TITLE)
  return { workspace, created: true }
}

/**
 * Which directory the calling session works in.
 *
 * The archive root doubles as a DSH workspace, and the analysis now runs in the
 * session that issued the command rather than in a new one. That makes the working
 * directory the guard rail: running /mistake from an unrelated session would mix a
 * long scan analysis into whatever the user is doing there, so it is refused.
 */
export function callerWorkspace(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

export function sameDirectory(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const normalize = (value) => value.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

/** Refuse to start unless the calling session already lives in the archive workspace. */
export function assertInsideArchiveWorkspace(agent, archiveRoot) {
  const cwd = callerWorkspace(agent)
  if (cwd !== undefined && sameDirectory(cwd, archiveRoot)) return cwd
  throw new Error([
    '这个命令只在「AI 错题本」工作区的会话里生效。',
    `· 归档工作区：${archiveRoot}`,
    cwd === undefined ? '· 当前会话没有工作目录' : `· 当前会话的工作目录：${cwd}`,
    '',
    '请在该工作区里打开或新建一个会话，再执行 /mistake。',
    '（这样扫描件的分析不会混进你正在做的事情里，而且分析期间该会话的工具会被收窄到 4 个。）',
  ].join('\n'))
}

/** The session the analysis should run in: the one that issued the command. */
export function requireCallerSessionId(agent) {
  const id = agent?.id ?? agent?.session?.id
  if (typeof id !== 'string' || id === '') throw new Error('无法确定当前会话，请从会话内执行。')
  return id
}

/**
 * Resolve the model the analysis session will use and refuse to start when it
 * cannot accept images — a text-only route would silently receive placeholders.
 */
export async function resolveVisionRoute(ctx, config) {
  const explicit = config.analysisProvider !== '' && config.analysisModel !== ''
  const selection = explicit
    ? { provider: config.analysisProvider, model: config.analysisModel }
    : ctx.agentDefaultModel.currentSelection()
  if (selection?.provider === undefined || selection?.model === undefined) {
    throw new Error('无法确定分析模型：既未在设置中指定，部署默认模型也不可用')
  }
  let info
  try {
    info = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
  } catch (error) {
    throw new Error(`分析模型 ${selection.provider}/${selection.model} 无法解析：${messageOf(error)}`)
  }
  const modalities = info?.inputModalities
  if (modalities === undefined || !modalities.includes('image')) {
    throw new Error(`模型 ${selection.provider}/${selection.model} 不支持图片输入，无法分析扫描件。请在插件设置里改用支持视觉的模型。`)
  }
  return { selection, explicit, info }
}

/**
 * 题目归档之后释放分析会话。
 *
 * 为什么是这个时机：归档之前用户还要回到会话里继续改卡片（待归档页的
 * 「打开分析会话」按钮），所以不能提前收掉；题目一旦落进 library/，会话就只剩
 * 历史价值，继续留在侧栏只会越积越多。
 *
 * 两步，各自容错：
 *   ① `cancel` 停掉可能还在跑的回合（空闲时是无害的 no-op）；
 *   ② `workspaceRegistry.archiveSession` 把它移出侧栏——DSH 没有把「硬删除会话」
 *      暴露给插件（宿主侧只有 archive），所以这就是插件能做到的"删除"。
 */
export async function releaseArchivedSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return { released: false, reason: '没有分析会话' }
  const outcome = { released: false, cancelled: false, archived: false }
  try {
    const result = await ctx.sessionController.cancel({ sessionId })
    outcome.cancelled = result?.accepted === true
  } catch {
    /* 会话可能已经结束；取消本来就不是必须成功的 */
  }
  try {
    const registry = ctx.workspaceRegistry
    if (registry !== undefined && typeof registry.archiveSession === 'function') {
      await registry.archiveSession(sessionId)
      outcome.archived = true
      outcome.released = true
    } else {
      outcome.reason = '宿主未提供 workspaceRegistry.archiveSession'
    }
  } catch (error) {
    outcome.reason = messageOf(error)
  }
  return outcome
}

/**
 * Admit the task brief. `prompt` takes a *required* AbortSignal (it is a Remote
 * method), so one is always supplied; the caller's signal is chained in so a
 * cancelled command does not still start an analysis run.
 */
export async function promptSession(ctx, sessionId, text, signal) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('任务书下发超时')), 120000)
  const forward = () => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', forward, { once: true })
  }
  try {
    await ctx.sessionController.prompt({
      requestId: `mistake-${randomUUID()}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }, controller.signal)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener?.('abort', forward)
  }
  return sessionId
}
