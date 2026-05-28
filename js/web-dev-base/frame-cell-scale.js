/**
 * Shared scale range for image `scalePct` and shape width/height (% of frame grid).
 */

export const FRAME_CELL_SCALE_MIN = 1;
export const FRAME_CELL_SCALE_MAX = 250;

/**
 * @param {unknown} raw
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampFrameCellScalePct(raw, fallback = 100) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(FRAME_CELL_SCALE_MAX, Math.max(FRAME_CELL_SCALE_MIN, Math.round(n)));
}
