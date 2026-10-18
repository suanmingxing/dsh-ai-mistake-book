/**
 * Client-facing HTTP transport.
 *
 * Three Host routes: the JSON API (`/mistake/api`), archived assets
 * (`/mistake/asset`) and question crops (`/mistake/crop`). This file is only the
 * transport layer: loopback / same-origin checks, POST-only, body parsing, the
 * response envelope and content types. The API methods themselves live in
 * `./api/` and are dispatched through a registry; every request re-reads the live
 * config and re-derives the archive paths from it, so a settings change takes
 * effect without remounting the plugin.
 *
 * Archiving and deleting are user decisions: they are reachable from the plugin
 * page (see `api/drafts.js` `archive` and `api/library.js` `delete`) and
 * deliberately NOT exposed as agent tools.
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { URL } from 'node:url'
import { dispatch } from './api/index.js'
import { CELLS_PER_BAND, cellRectangle } from './grid.js'
import { archivePaths, messageOf, resolveInside } from './paths.js'
import { cropPng, decodePng } from './png.js'

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

export function registerRoutes(ctx, readConfig) {
  const disposers = []

  /** Build the per-request dependencies, then hand off to the method registry. */
  const api = async (method, payload) => {
    const config = readConfig()
    const paths = archivePaths(config.archiveRoot)
    return dispatch(method, payload, { ctx, config, paths })
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
