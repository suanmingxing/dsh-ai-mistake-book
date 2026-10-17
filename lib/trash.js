/**
 * Recycle bin for archived cards.
 *
 * Deleting a mistake is destructive and the archive is the user's own folder, so
 * the default delete moves files into `<root>/_trash/<stamp>/`, preserving their
 * paths inside the archive, and writes a manifest next to them. Restoring moves
 * them back. Only emptying the bin actually destroys data.
 */
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { messageOf, nowStamp, pathExists, readJson, resolveInside, toRelative, writeJson } from './paths.js'

const MANIFEST = 'manifest.json'

function uniqueStamp(existing, date) {
  const base = nowStamp(date)
  if (!existing.includes(base)) return base
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = `${base}-${String(suffix).padStart(2, '0')}`
    if (!existing.includes(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

async function listChildNames(dir) {
  try {
    return await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Move archive-relative paths into a fresh bin folder.
 *
 * @returns {{ stamp: string, moved: string[], missing: string[], permanent: string[] }}
 */
export async function moveToBin(paths, relPaths, options = {}) {
  const permanent = options.permanent === true
  const existing = await listChildNames(paths.trash)
  const stamp = uniqueStamp(existing, new Date())
  const binDir = paths.trashBatchDir(stamp)
  const moved = []
  const missing = []
  const destroyed = []

  for (const rel of relPaths) {
    const source = resolveInside(paths.root, rel)
    if (!(await pathExists(source))) {
      missing.push(rel)
      continue
    }
    if (permanent) {
      await rm(source, { recursive: true, force: true })
      destroyed.push(rel)
      continue
    }
    const target = join(binDir, rel.replace(/\//g, '\\'))
    await mkdir(dirname(target), { recursive: true })
    await rename(source, target)
    moved.push(rel)
  }

  if (permanent) {
    await pruneEmptyDirs(paths, relPaths)
    return { stamp: null, moved: [], missing, permanent: destroyed }
  }

  await writeJson(join(binDir, MANIFEST), {
    stamp,
    at: new Date().toISOString(),
    note: options.note ?? '',
    items: moved,
  })
  await pruneEmptyDirs(paths, moved)
  return { stamp, moved, missing, permanent: [] }
}

/** Remove now-empty `cards` folders (and paper folders left with nothing but them). */
export async function pruneEmptyDirs(paths, relPaths) {
  const candidates = new Set()
  for (const rel of relPaths) {
    let current = dirname(resolveInside(paths.root, rel))
    while (current.length > paths.library.length) {
      candidates.add(current)
      current = dirname(current)
    }
  }
  // Deepest first, so a paper folder is only considered after its cards folder went.
  const ordered = [...candidates].sort((left, right) => right.length - left.length)
  for (const dir of ordered) {
    const entries = await listChildNames(dir)
    if (entries.length === 0) await rm(dir, { recursive: true, force: true })
  }
}

/** Every bin folder, newest first, with the relative paths it holds. */
export async function listBin(paths) {
  const names = (await listChildNames(paths.trash)).sort().reverse()
  const bins = []
  for (const stamp of names) {
    const binDir = paths.trashBatchDir(stamp)
    const info = await stat(binDir).catch(() => null)
    if (info === null || !info.isDirectory()) continue
    const manifest = await readJson(join(binDir, MANIFEST), undefined)
    bins.push({
      stamp,
      at: manifest?.at ?? info.mtime.toISOString(),
      note: manifest?.note ?? '',
      items: Array.isArray(manifest?.items) ? manifest.items : await scanBin(binDir, paths),
    })
  }
  return bins
}

/**
 * Fall back to walking the bin when its manifest is missing or unreadable.
 *
 * 返回的路径必须是**归档根相对**的（`library/xxx.md`），因为批次目录内部保留了
 * 被删文件原来的目录结构。早先这里用 `toRelative(paths.root, …)`，得到的是
 * `_trash/<stamp>/library/xxx.md`——带上了批次前缀，restore 时拼出来的源路径
 * 就不存在了，文件会被当成 missing 跳过。
 */
async function scanBin(dir, paths) {
  const found = []
  const walk = async (current) => {
    for (const entry of await listChildNames(current)) {
      const full = join(current, entry)
      const info = await stat(full).catch(() => null)
      if (info === null) continue
      if (info.isDirectory()) await walk(full)
      else {
        const rel = toRelative(dir, full)
        if (rel !== undefined && entry !== MANIFEST) found.push(rel)
      }
    }
  }
  await walk(dir)
  return found
}

/** Move chosen items (or a whole bin) back to where they came from. */
export async function restoreFromBin(paths, stamp, relPaths) {
  const binDir = paths.trashBatchDir(stamp)
  if (!(await pathExists(binDir))) throw new Error(`回收站里没有这一批：${stamp}`)
  const manifest = await readJson(join(binDir, MANIFEST), undefined)
  const available = Array.isArray(manifest?.items) && manifest.items.length > 0 ? manifest.items : await scanBin(binDir, paths)
  const wanted = Array.isArray(relPaths) && relPaths.length > 0
    ? available.filter((rel) => relPaths.includes(rel))
    : available

  const restored = []
  const conflicts = []
  const skipped = []
  for (const rel of wanted) {
    const source = join(binDir, rel.replace(/\//g, '\\'))
    if (!(await pathExists(source))) {
      skipped.push(rel)
      continue
    }
    const target = resolveInside(paths.root, rel)
    // Never overwrite a card that exists again: the user may have re-filed it.
    if (await pathExists(target)) {
      conflicts.push(rel)
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await rename(source, target)
    restored.push(rel)
  }
  await pruneBin(paths, stamp)
  return { restored, conflicts, skipped }
}

async function pruneBin(paths, stamp) {
  const binDir = paths.trashBatchDir(stamp)
  const remaining = await scanBin(binDir, paths)
  if (remaining.length === 0) {
    await rm(binDir, { recursive: true, force: true })
    return remaining
  }
  // 清单必须跟着实际内容走：只还原其中几项时，旧 manifest 仍列着已经回到原位的
  // 文件（listBin 优先读 manifest），界面就会显示早已不在回收站的条目。
  // 以磁盘扫描结果为准回写，并保留原来的 at —— 那是这一批被删的时间。
  const previous = await readJson(join(binDir, MANIFEST), undefined)
  await writeJson(join(binDir, MANIFEST), {
    stamp,
    at: previous?.at ?? new Date().toISOString(),
    note: previous?.note ?? '',
    items: remaining,
  })
  return remaining
}

/** The only operation that really destroys archived content. */
export async function emptyBin(paths, stamp) {
  if (typeof stamp === 'string' && stamp !== '') {
    const binDir = paths.trashBatchDir(stamp)
    if (!(await pathExists(binDir))) throw new Error(`回收站里没有这一批：${stamp}`)
    const items = await scanBin(binDir, paths)
    await rm(binDir, { recursive: true, force: true })
    return { emptied: [stamp], items: items.length }
  }
  const bins = await listBin(paths)
  let items = 0
  for (const bin of bins) items += bin.items.length
  await rm(paths.trash, { recursive: true, force: true })
  return { emptied: bins.map((bin) => bin.stamp), items }
}

export function describeBinError(error) {
  return messageOf(error)
}
