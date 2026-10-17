/**
 * PDF → PNG rasterization through the LibreOffice kit's PDFium backend.
 *
 * DSH has no PDF-to-image tool of its own, but the kit that ships with the
 * deployment renders PDF pages directly (`rasterEngine: "pdfium"`). Its native
 * worker expects a standalone Node executable, so the kit is invoked through the
 * CLI rather than imported in-process.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { messageOf, removeIfExists } from './paths.js'

const KIT_PACKAGE = '@deepseek-ai/libreoffice-kit'

function candidateNodes() {
  const list = []
  if (process.env.DSH_NODE_EXECUTABLE) list.push(process.env.DSH_NODE_EXECUTABLE)
  if (typeof process.resourcesPath === 'string') {
    list.push(join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'))
  }
  list.push(join(homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'))
  if (process.versions.electron === undefined && process.execPath) list.push(process.execPath)
  return list
}

function candidateCliPaths() {
  const list = []
  try {
    const resolved = import.meta.resolve(`${KIT_PACKAGE}/package.json`)
    list.push(join(dirname(fileURLToPath(resolved)), 'lib', 'cli.js'))
  } catch {
    /* fall through to the filesystem candidates below */
  }
  try {
    const require = createRequire(import.meta.url)
    list.push(join(dirname(require.resolve(`${KIT_PACKAGE}/package.json`)), 'lib', 'cli.js'))
  } catch {
    /* not resolvable from here */
  }
  if (typeof process.resourcesPath === 'string') {
    list.push(join(process.resourcesPath, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'))
  }
  // `resourcesPath` is only injected by some Electron launches; the same directory
  // is derivable from the executable, which keeps this working either way.
  if (typeof process.execPath === 'string' && process.execPath !== '') {
    list.push(join(dirname(process.execPath), 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'))
  }
  return list
}

/** Report exactly which executable and CLI this deployment will use. */
export function describeRasterToolchain() {
  const node = candidateNodes().find((candidate) => existsSync(candidate))
  const cli = candidateCliPaths().find((candidate) => existsSync(candidate))
  return {
    node,
    cli,
    nodeCandidates: candidateNodes(),
    cliCandidates: candidateCliPaths(),
    electron: process.versions.electron ?? null,
    execPath: process.execPath,
  }
}

/**
 * Convert an Office document (here: a generated DOCX) to PDF with the same
 * LibreOffice engine, and return the parsed CLI report.
 *
 * The kit refuses to overwrite, so the target is removed first — the caller owns
 * that file and passes a unique name.
 */
export async function convertOfficeToPdf(inputPath, outputPath, { signal, timeoutMs = 300000 } = {}) {
  const toolchain = describeRasterToolchain()
  if (toolchain.node === undefined) {
    throw new Error(`找不到可用的 Node 可执行文件，无法调用 ${KIT_PACKAGE}。候选路径：${toolchain.nodeCandidates.join(' , ')}`)
  }
  if (toolchain.cli === undefined) {
    throw new Error(`找不到 ${KIT_PACKAGE} 的 CLI。候选路径：${toolchain.cliCandidates.join(' , ')}`)
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await removeIfExists(outputPath)
  const { stdout } = await run(toolchain.node, [toolchain.cli, 'convert', '--input', inputPath, '--output', outputPath], { timeoutMs, signal })
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    report = { raw: stdout }
  }
  return { ...report, outputPath }
}

function run(command, args, { timeoutMs = 300000, signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, signal }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} ${args.slice(0, 3).join(' ')} 失败：${messageOf(error)}${stderr ? ` | stderr: ${String(stderr).slice(0, 800)}` : ''}`))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/**
 * Render every page of `inputPath` into `outputDir` as page-0001.png… and return
 * the parsed manifest. The kit requires a fresh, absolute output directory.
 */
export async function rasterizePdf(inputPath, outputDir, { dpi, maxPages, signal, timeoutMs } = {}) {
  const toolchain = describeRasterToolchain()
  if (toolchain.node === undefined) {
    throw new Error(`找不到可用的 Node 可执行文件，无法调用 ${KIT_PACKAGE}。候选路径：${toolchain.nodeCandidates.join(' , ')}`)
  }
  if (toolchain.cli === undefined) {
    throw new Error(`找不到 ${KIT_PACKAGE} 的 CLI。候选路径：${toolchain.cliCandidates.join(' , ')}`)
  }
  // The kit creates the output directory itself and fails with EEXIST when it is
  // already there, so only the parent is ensured and the target is cleared.
  await mkdir(dirname(outputDir), { recursive: true })
  await removeIfExists(outputDir)
  const args = [
    toolchain.cli,
    'render',
    '--input', inputPath,
    '--output-dir', outputDir,
    '--pages', 'all',
    '--dpi', String(dpi),
  ]
  if (typeof maxPages === 'number' && maxPages > 0) args.push('--max-pages', String(maxPages))
  const { stdout } = await run(toolchain.node, args, { timeoutMs, signal })
  const manifestText = stdout.trim()
  const start = manifestText.indexOf('{')
  if (start === -1) throw new Error(`光栅化未返回 manifest：${manifestText.slice(0, 400)}`)
  const manifest = JSON.parse(manifestText.slice(start))
  if (!Array.isArray(manifest.images) || manifest.images.length === 0) {
    throw new Error(`光栅化结果为空（pageCount=${manifest.pageCount ?? '?'}）`)
  }
  return { manifest, toolchain }
}

/** Read one rendered page back as bytes plus its manifest entry. */
export async function readRenderedPage(manifest, index) {
  const entry = manifest.images.find((image) => image.index === index)
  if (entry === undefined) throw new Error(`manifest 中缺少第 ${index} 页`)
  return { entry, bytes: await readFile(entry.path) }
}

export function isPdfName(name) {
  return typeof name === 'string' && /\.pdf$/i.test(name)
}
