/**
 * Frame-grid placement for image/shape cells.
 *
 * Coordinate system (staging === live === publish):
 * - `placementLeftPct` / `placementTopPct` are % of `[data-site-frame-page]` (the frame root).
 * - Anchor: center of the layer at (left%, top%).
 * - CSS: frame root uses `position: relative` + fixed `100dvh` height on homepage (see site-frame.css).
 */

/** @typedef {{ placementLeftPct: number, placementTopPct: number }} FramePlacement */

const PLACEMENT_MIN = 0;
const PLACEMENT_MAX = 100;

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parsePlacementPct(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    return null;
  }
  return Math.min(PLACEMENT_MAX, Math.max(PLACEMENT_MIN, Math.round(v * 10) / 10));
}

/**
 * @param {unknown} style
 * @returns {FramePlacement | null}
 */
export function placementFromStyle(style) {
  if (!style || typeof style !== "object") {
    return null;
  }
  const o = /** @type {Record<string, unknown>} */ (style);
  const left = parsePlacementPct(o.placementLeftPct ?? o.placement_left_pct);
  const top = parsePlacementPct(o.placementTopPct ?? o.placement_top_pct);
  if (left === null || top === null) {
    return null;
  }
  return { placementLeftPct: left, placementTopPct: top };
}

/**
 * @param {unknown} style
 * @returns {boolean}
 */
export function placementIsActive(style) {
  return placementFromStyle(style) !== null;
}

/**
 * @param {FramePlacement | null} placement
 * @returns {{ placementLeftPct: number | null, placementTopPct: number | null }}
 */
export function placementForApi(placement) {
  if (!placement) {
    return { placementLeftPct: null, placementTopPct: null };
  }
  return {
    placementLeftPct: placement.placementLeftPct,
    placementTopPct: placement.placementTopPct,
  };
}

/**
 * Placement / scale measure box — always the frame root’s border box.
 * @param {HTMLElement} frameRoot `[data-site-frame-page]`
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function resolvePlacementMeasureRect(frameRoot) {
  const rect = frameRoot.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * @param {HTMLElement} frameRoot
 */
function ensurePlacementHost(frameRoot) {
  frameRoot.classList.add("site-frame--placement-host");
}

/**
 * @param {HTMLElement} wrap
 */
export function clearFramePlacementStyles(wrap) {
  wrap.classList.remove("site-frame__cell-placed-layer");
  wrap.style.removeProperty("position");
  wrap.style.removeProperty("left");
  wrap.style.removeProperty("top");
  wrap.style.removeProperty("transform");
  wrap.style.removeProperty("z-index");
  delete wrap.dataset.framePlacementCellIndex;
}

/**
 * Remove placed layers for a cell index before re-mounting that cell.
 * @param {HTMLElement} frameRoot
 * @param {string | null} cellIndex
 */
export function removePlacedLayersForCell(frameRoot, cellIndex) {
  if (!cellIndex) {
    return;
  }
  const sel = `.site-frame__cell-placed-layer[data-frame-placement-cell-index="${cellIndex}"]`;
  frameRoot.querySelectorAll(sel).forEach((el) => {
    el.remove();
  });
}

/**
 * Attach wrap to the frame root and position with % (center anchor).
 * Caller must not append the wrap to the cell mount afterward.
 * @param {HTMLElement} mountEl
 * @param {HTMLElement} wrap
 * @param {FramePlacement} placement
 */
export function applyFramePlacementToWrap(mountEl, wrap, placement) {
  const frameRoot =
    typeof mountEl.closest === "function" ? mountEl.closest("[data-site-frame-page]") : null;
  const ix = mountEl.getAttribute("data-frame-cell-index");
  if (ix != null) {
    wrap.dataset.framePlacementCellIndex = ix;
  } else {
    delete wrap.dataset.framePlacementCellIndex;
  }
  mountEl.classList.add("site-frame__cell-mount--frame-placed");
  wrap.classList.add("site-frame__cell-placed-layer");
  wrap.style.position = "absolute";
  wrap.style.left = `${placement.placementLeftPct}%`;
  wrap.style.top = `${placement.placementTopPct}%`;
  wrap.style.transform = "translate(-50%, -50%)";
  wrap.style.zIndex = "2";

  if (frameRoot instanceof HTMLElement) {
    ensurePlacementHost(frameRoot);
    frameRoot.appendChild(wrap);
  }
}

/**
 * @param {HTMLElement} frameRoot
 * @param {number} clientX
 * @param {number} clientY
 * @returns {FramePlacement | null}
 */
export function placementFromPointer(frameRoot, clientX, clientY) {
  const rect = resolvePlacementMeasureRect(frameRoot);
  if (rect.width < 1 || rect.height < 1) {
    return null;
  }
  const leftPct = ((clientX - rect.left) / rect.width) * 100;
  const topPct = ((clientY - rect.top) / rect.height) * 100;
  const l = parsePlacementPct(leftPct);
  const t = parsePlacementPct(topPct);
  if (l === null || t === null) {
    return null;
  }
  return { placementLeftPct: l, placementTopPct: t };
}

/**
 * @param {Element} target
 * @param {HTMLElement} root
 * @returns {HTMLElement | null}
 */
function resolvePlacementMountFromTarget(target, root) {
  if (!(target instanceof Element)) {
    return null;
  }
  const placedLayer = target.closest(".site-frame__cell-placed-layer");
  if (placedLayer instanceof HTMLElement) {
    const ix = placedLayer.getAttribute("data-frame-placement-cell-index");
    if (ix != null) {
      const mount = root.querySelector(`[data-frame-cell-index="${ix}"]`);
      if (mount instanceof HTMLElement) {
        return mount;
      }
    }
  }
  const hit = target.closest(
    ".site-frame__cell-image-wrap, .site-frame__cell-shape-wrap, .site-frame__cell-image, .site-frame__cell-shape, [data-frame-cell-index]",
  );
  if (!hit) {
    return null;
  }
  const mount = hit.closest("[data-frame-cell-index]");
  if (!(mount instanceof HTMLElement) || !root.contains(mount)) {
    return null;
  }
  return mount;
}

export function mountFrameCellPlacementDrag(options) {
  const { root, getSelectedCellIndex, onPlacementChange } = options;
  /** @type {boolean} */
  let dragging = false;
  /** @type {HTMLElement | null} */
  let dragFrameRoot = null;
  /** @type {HTMLElement | null} */
  let dragMount = null;

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e) {
    if (!document.documentElement.classList.contains("staging")) {
      return;
    }
    if (e.button !== 0) {
      return;
    }
    if (!(e.target instanceof Element)) {
      return;
    }
    if (e.target.closest(".site-frame__staging-label-row")) {
      return;
    }
    const mount = resolvePlacementMountFromTarget(e.target, root);
    if (!mount) {
      return;
    }
    const ct = String(mount.dataset.frameContentType || "").toLowerCase();
    if (ct !== "image" && ct !== "shape") {
      return;
    }
    const selected = getSelectedCellIndex();
    const ix = mount.getAttribute("data-frame-cell-index");
    if (selected == null || ix !== selected) {
      return;
    }
    if (e.target instanceof HTMLImageElement) {
      e.preventDefault();
    }
    const frameRoot = mount.closest("[data-site-frame-page]");
    if (!(frameRoot instanceof HTMLElement)) {
      return;
    }
    const placement = placementFromPointer(frameRoot, e.clientX, e.clientY);
    if (!placement) {
      return;
    }
    dragging = true;
    dragMount = mount;
    dragFrameRoot = frameRoot;
    mount.classList.add("site-frame__cell-mount--placement-dragging");
    const dragWrap = /** @type {HTMLElement | null} */ (
      frameRoot.querySelector(
        `.site-frame__cell-placed-layer[data-frame-placement-cell-index="${ix}"]`,
      ) || mount.querySelector(".site-frame__cell-placed-layer")
    );
    const captureEl = dragWrap || mount;
    try {
      captureEl.setPointerCapture(e.pointerId);
    } catch (_err) {
      /* ignore */
    }
    e.preventDefault();
    onPlacementChange(placement);
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    if (!dragging || !dragFrameRoot) {
      return;
    }
    const placement = placementFromPointer(dragFrameRoot, e.clientX, e.clientY);
    if (placement) {
      onPlacementChange(placement);
    }
  }

  /**
   * @param {PointerEvent} e
   */
  function endDrag() {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (dragMount) {
      dragMount.classList.remove("site-frame__cell-mount--placement-dragging");
    }
    dragMount = null;
    dragFrameRoot = null;
  }

  root.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", endDrag);
    document.removeEventListener("pointercancel", endDrag);
  };
}
