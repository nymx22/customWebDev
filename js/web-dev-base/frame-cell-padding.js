/**
 * Frame cell mount padding: legacy CSS string or JSON `{ topPct, rightPct, bottomPct, leftPct }` (0–50).
 */

import { normalizeShapeStyle } from "./frame-cell-shape.js";

/** @typedef {{ type: 'css', css: string }} CssCellPadding */
/** @typedef {{ type: 'pct', topPct: number, rightPct: number, bottomPct: number, leftPct: number }} PctCellPadding */

const PCT_MAX = 50;

/** @type {WeakMap<HTMLElement, ResizeObserver>} */
const cellPaddingObservers = new WeakMap();

/**
 * @param {HTMLElement} mount
 */
function disconnectCellPaddingObserver(mount) {
  const ro = cellPaddingObservers.get(mount);
  if (ro) {
    ro.disconnect();
    cellPaddingObservers.delete(mount);
  }
}

/**
 * @param {HTMLElement} mount
 * @param {{ topPct: number, rightPct: number, bottomPct: number, leftPct: number }} spec
 */
function applyGridCellPadding(mount, spec) {
  const { topPct, rightPct, bottomPct, leftPct } = spec;
  const frameRoot =
    typeof mount.closest === "function" ? mount.closest("[data-site-frame-page]") : null;

  const applyMountFallback = () => {
    mount.style.padding = `${topPct}% ${rightPct}% ${bottomPct}% ${leftPct}%`;
  };

  const applyFromFrame = () => {
    if (!mount.isConnected) {
      disconnectCellPaddingObserver(mount);
      return;
    }
    if (!frameRoot) {
      applyMountFallback();
      return;
    }
    const rect = frameRoot.getBoundingClientRect();
    const fw = rect.width;
    const fh = rect.height;
    if (fw < 1 || fh < 1) {
      applyMountFallback();
      return;
    }
    const t = (fh * topPct) / 100;
    const r = (fw * rightPct) / 100;
    const b = (fh * bottomPct) / 100;
    const l = (fw * leftPct) / 100;
    mount.style.padding = `${t}px ${r}px ${b}px ${l}px`;
  };

  disconnectCellPaddingObserver(mount);
  applyFromFrame();
  if (frameRoot) {
    const ro = new ResizeObserver(applyFromFrame);
    ro.observe(frameRoot);
    cellPaddingObservers.set(mount, ro);
    if (frameRoot.getBoundingClientRect().width < 1) {
      requestAnimationFrame(applyFromFrame);
    }
  }
}

/**
 * @param {unknown} n
 * @returns {number}
 */
function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    return 0;
  }
  return Math.min(PCT_MAX, v);
}

/**
 * @param {unknown} raw
 * @returns {CssCellPadding | PctCellPadding}
 */
export function parseCellPadding(raw) {
  if (raw == null) {
    return { type: "pct", topPct: 0, rightPct: 0, bottomPct: 0, leftPct: 0 };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = /** @type {Record<string, unknown>} */ (raw);
    return {
      type: "pct",
      topPct: clampPct(o.topPct ?? o.top ?? o.upPct ?? o.up),
      rightPct: clampPct(o.rightPct ?? o.right),
      bottomPct: clampPct(o.bottomPct ?? o.bottom ?? o.downPct ?? o.down),
      leftPct: clampPct(o.leftPct ?? o.left),
    };
  }
  const s = String(raw).trim();
  if (!s) {
    return { type: "pct", topPct: 0, rightPct: 0, bottomPct: 0, leftPct: 0 };
  }
  if (s.startsWith("{")) {
    try {
      return parseCellPadding(JSON.parse(s));
    } catch (_e) {
      return { type: "css", css: s };
    }
  }
  return { type: "css", css: s };
}

/**
 * @param {unknown} raw
 * @returns {object | string}
 */
export function cellPaddingForApi(raw) {
  const spec = parseCellPadding(raw);
  if (spec.type === "css") {
    return spec.css;
  }
  if (!spec.topPct && !spec.rightPct && !spec.bottomPct && !spec.leftPct) {
    return "";
  }
  return {
    topPct: spec.topPct,
    rightPct: spec.rightPct,
    bottomPct: spec.bottomPct,
    leftPct: spec.leftPct,
  };
}

/**
 * Stable string for dirty comparison.
 * @param {unknown} raw
 * @returns {string}
 */
export function cellPaddingDirtyKey(raw) {
  const v = cellPaddingForApi(raw);
  if (v === "") {
    return "";
  }
  if (typeof v === "string") {
    return `css:${v}`;
  }
  return JSON.stringify(v);
}

/**
 * True when SQLite / staging has explicit padding for this cell (not “use page default”).
 * @param {unknown} cellPadding
 * @returns {boolean}
 */
export function cellPaddingIsActive(cellPadding) {
  const spec = parseCellPadding(cellPadding);
  if (spec.type === "css") {
    return !!String(spec.css || "").trim();
  }
  return !!(spec.topPct || spec.rightPct || spec.bottomPct || spec.leftPct);
}

/**
 * @param {HTMLElement} mount
 * @param {boolean} active
 */
export function syncCellPaddingOverrideClass(mount, active) {
  mount.classList.toggle("site-frame__cell-mount--cell-padding", active);
}

/**
 * @param {HTMLElement} mount
 * @param {unknown} cellPadding
 */
/**
 * @param {HTMLElement} mount
 * @param {unknown} cellPadding
 * @param {{ pageOverrideClass?: boolean }} [opts]
 */
export function applyCellPaddingStyles(mount, cellPadding, opts) {
  if (!mount) {
    return;
  }
  const pageOverrideClass = !opts || opts.pageOverrideClass !== false;
  mount.style.removeProperty("padding");
  delete mount.dataset.frameCellPadding;
  disconnectCellPaddingObserver(mount);

  const active = cellPaddingIsActive(cellPadding);
  if (pageOverrideClass) {
    syncCellPaddingOverrideClass(mount, active);
  }
  if (!active) {
    return;
  }

  const spec = parseCellPadding(cellPadding);
  if (spec.type === "css") {
    mount.style.padding = spec.css;
    try {
      mount.dataset.frameCellPadding = encodeURIComponent(spec.css);
    } catch (_e) {
      /* ignore */
    }
    return;
  }

  const { topPct, rightPct, bottomPct, leftPct } = spec;
  applyGridCellPadding(mount, { topPct, rightPct, bottomPct, leftPct });
  try {
    mount.dataset.frameCellPadding = encodeURIComponent(
      JSON.stringify({ topPct, rightPct, bottomPct, leftPct }),
    );
  } catch (_e) {
    /* ignore */
  }
}

/**
 * @param {HTMLInputElement} topIn
 * @param {HTMLInputElement} rightIn
 * @param {HTMLInputElement} bottomIn
 * @param {HTMLInputElement} leftIn
 * @returns {PctCellPadding}
 */
export function readCellPaddingPctFromInputs(topIn, rightIn, bottomIn, leftIn) {
  const parseIn = (el) => clampPct(parseFloat(String(el.value)));
  return {
    type: "pct",
    topPct: parseIn(topIn),
    rightPct: parseIn(rightIn),
    bottomPct: parseIn(bottomIn),
    leftPct: parseIn(leftIn),
  };
}

/**
 * @param {HTMLInputElement} uniformIn
 * @param {HTMLInputElement} topIn
 * @param {HTMLInputElement} rightIn
 * @param {HTMLInputElement} bottomIn
 * @param {HTMLInputElement} leftIn
 * @param {boolean} sidesExpanded
 */
export function readCellPaddingFromPanel(uniformIn, topIn, rightIn, bottomIn, leftIn, sidesExpanded) {
  if (!sidesExpanded) {
    const u = clampPct(parseFloat(String(uniformIn.value)));
    return cellPaddingForApi({ topPct: u, rightPct: u, bottomPct: u, leftPct: u });
  }
  return cellPaddingForApi(readCellPaddingPctFromInputs(topIn, rightIn, bottomIn, leftIn));
}

/**
 * @param {HTMLInputElement} uniformIn
 * @param {HTMLInputElement} topIn
 * @param {HTMLInputElement} rightIn
 * @param {HTMLInputElement} bottomIn
 * @param {HTMLInputElement} leftIn
 * @param {unknown} cellPadding
 */
export function fillCellPaddingInputs(uniformIn, topIn, rightIn, bottomIn, leftIn, cellPadding) {
  const spec = parseCellPadding(cellPadding);
  if (spec.type === "css") {
    uniformIn.value = "";
    topIn.value = "";
    rightIn.value = "";
    bottomIn.value = "";
    leftIn.value = "";
    return;
  }
  const { topPct, rightPct, bottomPct, leftPct } = spec;
  const uniform = topPct === rightPct && rightPct === bottomPct && bottomPct === leftPct;
  if (uniform && topPct) {
    uniformIn.value = String(topPct);
    topIn.value = "";
    rightIn.value = "";
    bottomIn.value = "";
    leftIn.value = "";
    return;
  }
  uniformIn.value = "";
  topIn.value = topPct ? String(topPct) : "";
  rightIn.value = rightPct ? String(rightPct) : "";
  bottomIn.value = bottomPct ? String(bottomPct) : "";
  leftIn.value = leftPct ? String(leftPct) : "";
}

/**
 * @param {object | null | undefined} draft
 * @returns {Record<string, unknown> | null}
 */
export function cellDraftToPatchPayload(draft) {
  if (!draft || typeof draft !== "object" || typeof draft.id !== "number") {
    return null;
  }
  const ct = String(draft.contentType || "empty")
    .trim()
    .toLowerCase();
  /** @type {Record<string, unknown>} */
  const payload = {
    id: draft.id,
    contentType: ct === "table" ? "html" : ct,
    body: draft.body != null ? String(draft.body) : "",
    cellRole: draft.cellRole != null ? String(draft.cellRole) : "",
    cellPadding: cellPaddingForApi(draft.cellPadding),
  };
  if (payload.contentType === "text" && draft.textStyle && typeof draft.textStyle === "object") {
    payload.textStyle = draft.textStyle;
  }
  if (payload.contentType === "image" && draft.imageStyle && typeof draft.imageStyle === "object") {
    payload.imageStyle = draft.imageStyle;
  }
  if (payload.contentType === "shape") {
    payload.shapeStyle = normalizeShapeStyle(
      draft.shapeStyle && typeof draft.shapeStyle === "object" ? draft.shapeStyle : {},
    );
  }
  if (payload.contentType === "stack" && Array.isArray(draft.layers)) {
    payload.layers = draft.layers;
    if (draft.body != null && String(draft.body).trim()) {
      payload.body = String(draft.body);
    }
  }
  return payload;
}

export function cellPaddingSidesDiffer(cellPadding) {
  const spec = parseCellPadding(cellPadding);
  if (spec.type !== "pct") {
    return false;
  }
  const { topPct, rightPct, bottomPct, leftPct } = spec;
  return !(
    topPct === rightPct &&
    rightPct === bottomPct &&
    bottomPct === leftPct
  );
}
