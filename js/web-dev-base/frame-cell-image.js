/**
 * Frame **image** cells: scale as % of the cell mount or the frame grid when placed.
 */

import { resolvePlacementMeasureRect } from "./frame-cell-placement.js";
import { clampFrameCellScalePct } from "./frame-cell-scale.js";

/** @type {WeakMap<HTMLImageElement, ResizeObserver>} */
const imageGridObservers = new WeakMap();

/**
 * @param {HTMLImageElement} img
 */
function disconnectImageGridObserver(img) {
  const ro = imageGridObservers.get(img);
  if (ro) {
    ro.disconnect();
    imageGridObservers.delete(img);
  }
}

/**
 * @param {string} maxWidth
 * @param {number} measureWidth
 * @returns {number | null}
 */
function resolveMaxWidthPx(maxWidth, measureWidth) {
  const s = String(maxWidth || "").trim();
  if (!s) {
    return null;
  }
  if (s.endsWith("%")) {
    const p = Number(s.slice(0, -1));
    if (Number.isFinite(p)) {
      return (measureWidth * p) / 100;
    }
    return null;
  }
  if (s.endsWith("px")) {
    const p = Number(s.slice(0, -2));
    return Number.isFinite(p) ? p : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {HTMLImageElement} img
 * @param {{
 *   scalePct?: number,
 *   maxWidth?: string,
 * }} imageStyle
 * @param {Element | null | undefined} contextEl
 * @param {boolean} [relativeToFrame] when true, % is of `[data-site-frame-page]`; else of the cell mount
 */
export function applyImageGridDimensions(img, imageStyle, contextEl, relativeToFrame = false) {
  disconnectImageGridObserver(img);
  const scalePct = clampFrameCellScalePct(imageStyle && imageStyle.scalePct, 100);
  const maxWidth = String((imageStyle && imageStyle.maxWidth) || "").trim();

  const frameRoot =
    contextEl && typeof contextEl.closest === "function"
      ? contextEl.closest("[data-site-frame-page]")
      : null;
  const mountEl =
    contextEl && typeof contextEl.closest === "function"
      ? contextEl.closest("[data-frame-cell-index]") || contextEl
      : contextEl;
  const measureRoot =
    relativeToFrame && frameRoot ? frameRoot : mountEl || frameRoot;

  const applyPctFallback = () => {
    img.classList.remove("site-frame__cell-image--grid-sized");
    if (maxWidth) {
      img.style.width = `min(${scalePct}%, ${maxWidth})`;
    } else {
      img.style.width = `${scalePct}%`;
    }
    img.style.height = `${scalePct}%`;
  };

  if (!(measureRoot instanceof Element)) {
    applyPctFallback();
    return;
  }

  const applyFromMeasureRoot = () => {
    if (!img.isConnected) {
      disconnectImageGridObserver(img);
      return;
    }
    const rect =
      relativeToFrame && frameRoot instanceof HTMLElement
        ? resolvePlacementMeasureRect(frameRoot)
        : measureRoot.getBoundingClientRect();
    const mw = rect.width;
    const mh = rect.height;
    if (mw < 1 || mh < 1) {
      applyPctFallback();
      return;
    }
    img.classList.add("site-frame__cell-image--grid-sized");
    let w = (mw * scalePct) / 100;
    const h = (mh * scalePct) / 100;
    const cap = resolveMaxWidthPx(maxWidth, mw);
    if (cap != null && cap > 0) {
      w = Math.min(w, cap);
    }
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
  };

  applyFromMeasureRoot();
  const ro = new ResizeObserver(applyFromMeasureRoot);
  ro.observe(/** @type {Element} */ (measureRoot));
  imageGridObservers.set(img, ro);
  if (measureRoot.getBoundingClientRect().width < 1) {
    requestAnimationFrame(applyFromMeasureRoot);
  }
}
