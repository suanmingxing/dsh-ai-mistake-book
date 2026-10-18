/**
 * Export files on disk: listing the exported PDFs with their sidecars, and deleting
 * a PDF/DOCX/sidecar triplet through the recycle bin.
 *
 * Split from `export.js` so opening the manage page never loads the DOCX/OMML/
 * LibreOffice side of the export feature.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathExists, readJson } from './paths.js'
import { moveToBin } from './trash.js'

const EXPORT_DIR = 'exports'

/**
 * 导出目录里的 PDF 清单（新的在前），并附上同名的 sidecar 元信息。
 * sidecar 缺失时 `meta` 为 null——老导出文件仍然要能列出来、能删。
 */
export async function listExports(paths) {
  const dir = join(paths.root, EXPORT_DIR)
  const names = await readdir(dir).catch(() => [])
  const files = []
  for (const name of names.filter((entry) => entry.toLowerCase().endsWith('.pdf'))) {
    const target = join(dir, name)
    const info = await stat(target).catch(() => null)
    if (info === null || !info.isFile()) continue
    const base = name.replace(/\.pdf$/i, '')
    const meta = await readJson(join(dir, `${base}.json`), null)
    files.push({
      file: `${EXPORT_DIR}/${name}`,
      absolute: target,
      name,
      bytes: info.size,
      at: info.mtime.toISOString(),
      hasDocx: await pathExists(join(dir, `${base}.docx`)),
      meta: meta === null || typeof meta !== 'object' ? null : meta,
    })
  }
  // 按修改时间倒序：导出名默认带时间戳，但用户改过标题时文件名就不一定有序了。
  files.sort((left, right) => String(right.at).localeCompare(String(left.at)))
  return files
}

/**
 * 删除一份导出：PDF、中间 DOCX 与 sidecar 一起处理。
 * 默认进回收站（和删卡片同一套机制），`permanent` 才真的销毁。
 */
export async function deleteExport(paths, relativeFile, options = {}) {
  const rel = String(relativeFile ?? '').replace(/\\/g, '/')
  if (!rel.startsWith(`${EXPORT_DIR}/`) || !rel.toLowerCase().endsWith('.pdf')) {
    throw new Error(`不是导出文件：${relativeFile}`)
  }
  const base = rel.replace(/\.pdf$/i, '')
  const result = await moveToBin(paths, [rel, `${base}.docx`, `${base}.json`], {
    permanent: options.permanent === true,
    note: '删除导出文件',
  })
  return { ...result, files: await listExports(paths) }
}
