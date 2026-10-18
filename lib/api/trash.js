/**
 * Recycle-bin API methods: list, restore picked items, empty.
 */
import { buildIndex } from '../library.js'
import { emptyBin, listBin, restoreFromBin } from '../trash.js'

/** Every bin folder, newest first, plus the current delete mode. */
export async function bin(payload, { paths, config }) {
  return {
    bins: await listBin(paths),
    mode: config.deleteToTrash === false ? 'permanent' : 'trash',
    retentionDays: typeof config.trashRetentionDays === 'number' ? config.trashRetentionDays : 30,
  }
}

/** Move chosen items (or a whole bin) back and rebuild the index. */
export async function binRestore(payload, { paths }) {
  const result = await restoreFromBin(paths, String(payload.stamp ?? ''), Array.isArray(payload.files) ? payload.files : [])
  const index = await buildIndex(paths)
  return { ...result, totals: index.totals }
}

/** The only API operation that really destroys archived content. */
export async function binEmpty(payload, { paths }) {
  const result = await emptyBin(paths, typeof payload.stamp === 'string' && payload.stamp !== '' ? payload.stamp : undefined)
  return result
}
