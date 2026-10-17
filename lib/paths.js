/**
 * Archive-root layout, path safety, and small filesystem helpers.
 *
 * Everything the plugin writes lives under one configurable root. Every path that
 * arrives from the Client or from a model tool call is re-derived from that root
 * and rejected if it escapes, so the HTTP surface can never read or write elsewhere.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

/**
 * 默认归档根：放在 DSH home 下，跨机器可移植。
 * 想放到别处就在插件设置里改 `archiveRoot`（也可以是 `~` 开头的路径）。
 */
export const DEFAULT_ARCHIVE_ROOT = join(homedir(), '.dsh', 'ai-mistake-book')

/** Directory names inside the archive root. */
export const DIRS = {
  library: 'library',
  inbox: 'inbox',
  templates: 'templates',
  trash: '_trash',
  vendor: 'vendor',
}

/** Expand `~`, make absolute, and normalize separators. */
export function normalizeRoot(input) {
  const raw = typeof input === 'string' && input.trim() !== '' ? input.trim() : DEFAULT_ARCHIVE_ROOT
  const expanded = raw === '~' ? homedir() : raw.startsWith('~/') || raw.startsWith('~\\') ? join(homedir(), raw.slice(2)) : raw
  return normalize(isAbsolute(expanded) ? expanded : resolve(expanded))
}

export function archivePaths(root) {
  const base = normalizeRoot(root)
  return {
    root: base,
    library: join(base, DIRS.library),
    inbox: join(base, DIRS.inbox),
    templates: join(base, DIRS.templates),
    trash: join(base, DIRS.trash),
    indexMd: join(base, 'index.md'),
    indexJson: join(base, 'index.json'),
    batchDir: (batchId) => join(base, DIRS.inbox, batchId),
    trashBatchDir: (stamp) => join(base, DIRS.trash, stamp),
  }
}

export async function ensureArchiveLayout(paths) {
  for (const dir of [paths.root, paths.library, paths.inbox, paths.templates]) {
    await mkdir(dir, { recursive: true })
  }
  return paths
}

/** True when `candidate` is the root itself or a descendant of it. */
export function isInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Resolve a Client-supplied relative path against the root, refusing escapes. */
export function resolveInside(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new Error('路径为空')
  if (isAbsolute(relativePath)) throw new Error(`只接受归档根目录内的相对路径：${relativePath}`)
  const target = resolve(root, relativePath)
  if (!isInside(root, target)) throw new Error(`路径越出归档目录：${relativePath}`)
  return target
}

/** Convert an absolute path under the root into the relative form the Client uses. */
export function toRelative(root, absolutePath) {
  const rel = relative(resolve(root), resolve(absolutePath))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

export function nowStamp(date = new Date()) {
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Stable, sortable batch identity: b-YYYYMMDD-HHMMSS-xxxx */
export function newBatchId(date = new Date()) {
  return `b-${nowStamp(date)}-${randomUUID().slice(0, 4)}`
}

export function slugify(text, fallback = 'item', maxLength = 60) {
  const cleaned = String(text ?? '')
    // Keep CJK, letters and digits; collapse everything else into single dashes.
    .replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
  return cleaned === '' ? fallback : cleaned
}

export function shortHash(input, length = 12) {
  return createHash('sha256').update(String(input), 'utf8').digest('hex').slice(0, length)
}

export async function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

/** Write JSON atomically so a crashed write never leaves a half-parsed batch. */
export async function writeJson(file, value) {
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return value
}

export async function pathExists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export async function removeIfExists(target) {
  await rm(target, { recursive: true, force: true })
}

export function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
