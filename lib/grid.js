/**
 * Provider vision-budget geometry.
 *
 * The binding constraint on how much detail a model receives is NOT the 4 MP
 * attachment cap — it is the provider's per-image token grid. DSH's DeepSeek
 * adapter ports the published calculator (`dsh-llm-deepseek`, `v41` config):
 * a 14 px patch grid, downsampled 3:1 per axis into 42 px token cells, capped at
 * 1024 tokens per image. An image whose padded grid exceeds that cap is resized
 * DOWN before it is ever sent.
 *
 * Consequence that drives this plugin's whole image strategy:
 *   a crop small enough to fit the budget is delivered at native sampling;
 *   a larger image is downscaled and silently loses that detail.
 * So the plugin renders pages at high dpi, then hands the model crops sized to
 * fit the budget, instead of whole pages that get squeezed.
 *
 * Verified against this deployment: a 3395x1168 band is sent as 2184x751 and a
 * 1698x2337 page as 1088x1498 — both exactly what `requestImageDimensions`
 * predicts, and both downscaled to near the 1024-token cap.
 */

/** Vision patch edge in pixels. */
export const PATCH_SIZE = 14
/** Per-axis patch-to-token downsampling ratio. */
export const DOWNSAMPLE_RATIO = 3
/** Provider cap on tokens for one request image. */
export const MAX_IMAGE_TOKENS = 1024
/** Total-pixel floor; smaller images are scaled up before grid projection. */
export const MIN_PIXELS = 544 * 544
/** Pixels covered by one token cell along either axis. */
export const CELL_SIZE = PATCH_SIZE * DOWNSAMPLE_RATIO

const intDiv = (value, divisor) => Math.floor(value / divisor)
const ceilDiv = (value, divisor) => Math.floor((value + divisor - 1) / divisor)
const padTo = (value) => ceilDiv(value, PATCH_SIZE) * PATCH_SIZE

/** Token count of one grid: every row carries a separator, plus two framing tokens. */
export function gridTokens(gridHeight, gridWidth) {
  return gridHeight * (gridWidth + 1) + 2
}

/** Token-cell count along one padded pixel axis. */
export function gridCells(paddedLength) {
  return ceilDiv(intDiv(paddedLength, PATCH_SIZE), DOWNSAMPLE_RATIO)
}

/** Token-cell grid an image of this size projects onto. */
export function gridOf(width, height) {
  const gridWidth = gridCells(padTo(width))
  const gridHeight = gridCells(padTo(height))
  return { gridWidth, gridHeight, tokens: gridTokens(gridHeight, gridWidth) }
}

/** Vision tokens charged for one request image, at most `MAX_IMAGE_TOKENS`. */
export function imageTokens(width, height) {
  const solved = requestDimensionsInternal(width, height)
  return gridTokens(solved.gridHeight, solved.gridWidth)
}

function solveResizeRatio(height, width, budget) {
  const aspect = height / width
  const idealGridWidth = Math.sqrt((budget - 2) / aspect + 0.25) - 0.5
  const idealGridHeight = idealGridWidth * aspect
  let bestHeight
  let bestWidth
  if (idealGridWidth < 1) {
    const solvedGridWidth = 1
    const solvedGridHeight = intDiv(budget - 2, 2)
    bestWidth = solvedGridWidth * CELL_SIZE
    bestHeight = solvedGridHeight * CELL_SIZE
  } else if (idealGridHeight < 1) {
    const solvedGridHeight = 1
    bestWidth = (intDiv(budget - 2, solvedGridHeight) - 1) * CELL_SIZE
    bestHeight = solvedGridHeight * CELL_SIZE
  } else {
    const solvedGridWidth = Math.trunc(idealGridWidth)
    const solvedGridHeight = Math.trunc(idealGridHeight)
    const scale = Math.min((solvedGridWidth * CELL_SIZE) / width, (solvedGridHeight * CELL_SIZE) / height)
    bestWidth = Math.trunc((width * scale) / PATCH_SIZE) * PATCH_SIZE
    bestHeight = Math.trunc((height * scale) / PATCH_SIZE) * PATCH_SIZE
  }
  const gridHeight = gridCells(bestHeight)
  const gridWidth = gridCells(bestWidth)
  return { gridHeight, gridWidth, bestHeight, bestWidth, numTokens: gridTokens(gridHeight, gridWidth) }
}

function safeResize(height, width, paddedHeight, paddedWidth) {
  const gridHeight = gridCells(paddedHeight)
  const gridWidth = gridCells(paddedWidth)
  const direct = { gridHeight, gridWidth, bestHeight: paddedHeight, bestWidth: paddedWidth, numTokens: gridTokens(gridHeight, gridWidth) }
  if (direct.numTokens <= MAX_IMAGE_TOKENS) return direct
  return solveResizeRatio(height, width, MAX_IMAGE_TOKENS)
}

/**
 * Dimensions the harness actually sends for a source of this size: the source
 * itself when its padded grid fits the cap, otherwise the solved grid's long edge
 * at the source aspect ratio.
 */
function requestDimensionsInternal(width, height) {
  const paddedWidth = padTo(width)
  const paddedHeight = padTo(height)
  if (gridTokens(gridCells(paddedHeight), gridCells(paddedWidth)) <= MAX_IMAGE_TOKENS) {
    return { bestWidth: width, bestHeight: height, gridWidth: gridCells(paddedWidth), gridHeight: gridCells(paddedHeight) }
  }
  const solved = solveResizeRatio(height, width, MAX_IMAGE_TOKENS)
  const longEdgeIsWidth = width >= height
  const targetLongEdge = longEdgeIsWidth ? solved.bestWidth : solved.bestHeight
  const scale = targetLongEdge / (longEdgeIsWidth ? width : height)
  const bestWidth = Math.max(1, Math.round(longEdgeIsWidth ? targetLongEdge : width * scale))
  const bestHeight = Math.max(1, Math.round(longEdgeIsWidth ? height * scale : targetLongEdge))
  return { bestWidth, bestHeight, gridWidth: gridCells(padTo(bestWidth)), gridHeight: gridCells(padTo(bestHeight)) }
}

/** What the harness will actually send for this source size. */
export function requestDimensions(width, height) {
  const sent = requestDimensionsInternal(width, height)
  return {
    width: sent.bestWidth,
    height: sent.bestHeight,
    gridWidth: sent.gridWidth,
    gridHeight: sent.gridHeight,
    tokens: gridTokens(sent.gridHeight, sent.gridWidth),
    downscaled: sent.bestWidth < width || sent.bestHeight < height,
  }
}

/**
 * How many token cells land on one source inch. This is the number that decides
 * whether handwriting is legible, and it is bounded by `dpi / CELL_SIZE`.
 */
export function samplingDensity(width, height, dpi) {
  const sent = requestDimensions(width, height)
  const inchesWide = width / dpi
  const inchesTall = height / dpi
  return {
    cellsPerInchWide: sent.gridWidth / inchesWide,
    cellsPerInchTall: sent.gridHeight / inchesTall,
    ceiling: dpi / CELL_SIZE,
    tokens: sent.tokens,
    downscaled: sent.downscaled,
  }
}

/**
 * Largest height for a given width that still fits the token budget, so the crop
 * is delivered at native sampling instead of being downscaled.
 */
export function maxNativeHeight(width, budget = MAX_IMAGE_TOKENS) {
  const gridWidth = gridCells(padTo(width))
  // gridTokens(gh, gw) = gh * (gw + 1) + 2 <= budget
  const maxRows = intDiv(budget - 2, gridWidth + 1)
  if (maxRows < 1) return 0
  // A padded height of maxRows * DOWNSAMPLE_RATIO * PATCH_SIZE maps to exactly maxRows cells.
  return maxRows * DOWNSAMPLE_RATIO * PATCH_SIZE
}

/** A band is offered to the model as a 3x3 grid of cells, numbered left-to-right then top-to-bottom. */
export const CELL_COLUMNS = 3
export const CELL_ROWS = 3
export const CELLS_PER_BAND = CELL_COLUMNS * CELL_ROWS

/** Band-relative rectangle of one cell. Shared by the re-cut tool and the review UI. */
export function cellRectangle(band, cell) {
  if (!Number.isInteger(cell) || cell < 1 || cell > CELLS_PER_BAND) {
    throw new Error(`cell 必须是 1..${CELLS_PER_BAND}（3×3 分格，左→右、上→下），收到 ${cell}`)
  }
  const index = cell - 1
  const column = index % CELL_COLUMNS
  const row = Math.floor(index / CELL_COLUMNS)
  const cellWidth = Math.floor(band.width / CELL_COLUMNS)
  const cellHeight = Math.floor(band.height / CELL_ROWS)
  const x = column * cellWidth
  const y = row * cellHeight
  return {
    x,
    y,
    width: column === CELL_COLUMNS - 1 ? band.width - x : cellWidth,
    height: row === CELL_ROWS - 1 ? band.height - y : cellHeight,
  }
}

/**
 * Largest token grid that fits the budget while staying as close as possible to a
 * target aspect ratio. Returned in cells, so callers multiply by `CELL_SIZE`.
 */
export function largestGridForAspect(aspect, budget = MAX_IMAGE_TOKENS) {
  const maxCells = budget - 2
  let best = null
  for (let gridWidth = 1; gridWidth <= maxCells; gridWidth += 1) {
    const gridHeight = Math.floor(maxCells / (gridWidth + 1))
    if (gridHeight < 1) break
    const score = Math.abs(Math.log(gridHeight / gridWidth / aspect))
    if (best === null || score < best.score - 1e-9) best = { gridWidth, gridHeight, score }
  }
  return best === null ? null : { gridWidth: best.gridWidth, gridHeight: best.gridHeight }
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(value, high))
}

/**
 * Plan one re-cut: the largest native-sampling window that still contains the
 * focus, centred on it in BOTH axes.
 *
 * Centring on both axes matters. An earlier version always used the full band
 * width and only shifted vertically, so pointing at two cells in the same row
 * returned two identical images; the model noticed ("The cell re-cuts returned
 * identical images") and stopped trusting the tool.
 */
export function planRecut({ bandWidth, bandHeight, focusLeft, focusRight, focusTop, focusBottom, budget = MAX_IMAGE_TOKENS }) {
  const focusWidth = Math.max(1, focusRight - focusLeft)
  const focusHeight = Math.max(1, focusBottom - focusTop)
  const grid = largestGridForAspect(focusHeight / focusWidth, budget)
  if (grid === null) return null

  const width = Math.max(CELL_SIZE, Math.min(bandWidth, grid.gridWidth * CELL_SIZE))
  const height = Math.max(CELL_SIZE, Math.min(bandHeight, maxNativeHeight(width, budget), grid.gridHeight * CELL_SIZE))

  const centerX = (focusLeft + focusRight) / 2
  const centerY = (focusTop + focusBottom) / 2
  const x = clamp(Math.round(centerX - width / 2), 0, Math.max(0, bandWidth - width))
  const y = clamp(Math.round(centerY - height / 2), 0, Math.max(0, bandHeight - height))

  const before = samplingDensity(bandWidth, bandHeight, 400)
  const after = samplingDensity(width, height, 400)
  return {
    rect: { x, y, width, height },
    focusWidth,
    focusHeight,
    gain: after.cellsPerInchWide / before.cellsPerInchWide,
    fromTokens: before.tokens,
    toTokens: after.tokens,
  }
}
