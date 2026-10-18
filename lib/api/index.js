/**
 * `/mistake/api` method registry.
 *
 * Each method is a plain handler `(payload, deps) => value`. The transport layer in
 * `../server.js` builds `deps = { ctx, config, paths }` for every request — the
 * config is re-read live and the archive paths re-derived from it, so a settings
 * change takes effect without remounting the plugin — and wraps the returned value
 * in the `{ ok: true, value }` envelope (a throw becomes
 * `{ ok: false, error: { message } }`), exactly as the single-switch version did.
 *
 * Handlers never write HTTP themselves; they only return data or throw.
 */
import { batch, batches, status } from './batches.js'
import { archive, draft, draftDrop, draftUpdate } from './drafts.js'
import { card, deleteCards, library, reindex } from './library.js'
import { bin, binEmpty, binRestore } from './trash.js'
import { exportCards, exportDelete, exports as listExports } from './exports.js'
import {
  exportSettings,
  exportSettingsSave,
  templateSave,
  templateSaveAll,
  templates,
} from './settings.js'
import { render, revealArchiveRoot } from './misc.js'

/**
 * HTTP method name -> handler(payload, deps).
 *
 * Frozen, with own-property dispatch: request method names come from the URL, so
 * the lookup must not fall through to `Object.prototype` members.
 */
export const API = Object.freeze({
  // batches
  status,
  batches,
  batch,
  // drafts + archiving
  draft,
  draftUpdate,
  draftDrop,
  archive,
  // archived library
  library,
  reindex,
  card,
  delete: deleteCards,
  // recycle bin
  bin,
  binRestore,
  binEmpty,
  // exports
  export: exportCards,
  exports: listExports,
  exportDelete,
  // settings
  templates,
  templateSave,
  templateSaveAll,
  exportSettings,
  exportSettingsSave,
  // misc
  render,
  revealArchiveRoot,
})

/**
 * Run one API method.
 *
 * The unknown-method message is client-visible: `client.js` prints `error.message`
 * verbatim, which is how a stale host half is diagnosed after an update.
 */
export async function dispatch(method, payload, deps) {
  if (!Object.prototype.hasOwnProperty.call(API, method)) {
    throw new Error(`未知的接口方法：${method}`)
  }
  return await API[method](payload, deps)
}
