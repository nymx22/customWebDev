/**
 * Frame **shape** cells (`content_type` = `shape`, `frame_cell_shape` row).
 */

import { parsePlacementPct, resolvePlacementMeasureRect } from "./frame-cell-placement.js";
import { clampFrameCellScalePct } from "./frame-cell-scale.js";

/** @typedef {'square' | 'triangle' | 'circle'} ShapeKind */
/** @typedef {'keep_ratio' | 'stretch_grid'} ShapeSizeMode */

/**
 * @typedef {{
 *   shapeKind: ShapeKind,
 *   sizeMode: ShapeSizeMode,
 *   widthPct: number,
 *   heightPct: number,
 *   objectAlign: string,
 *   rotationDeg: number,
 *   cornerRadiusPct: number,
 *   fillEnabled: boolean,
 *   fillColor: string,
 *   fillOpacityPct: number,
 *   strokeEnabled: boolean,
 *   strokeColor: string,
 *   strokeOpacityPct: number,
 *   strokeWidthPx: number,
 *   linkHref: string,
 *   placementLeftPct: number | null,
 *   placementTopPct: number | null,
 * }} ShapeStyle
 */

export const SHAPE_KINDS = /** @type {const} */ (["square", "triangle", "circle"]);
export const SHAPE_SIZE_MODES = /** @type {const} */ (["keep_ratio", "stretch_grid"]);

export const DEFAULT_SHAPE_STYLE = /** @type {ShapeStyle} */ ({
  shapeKind: "square",
  sizeMode: "keep_ratio",
  widthPct: 40,
  heightPct: 40,
  objectAlign: "center",
  rotationDeg: 0,
  cornerRadiusPct: 0,
  fillEnabled: true,
  fillColor: "#000000",
  fillOpacityPct: 100,
  strokeEnabled: false,
  strokeColor: "#000000",
  strokeOpacityPct: 100,
  strokeWidthPx: 2,
  linkHref: "",
  placementLeftPct: null,
  placementTopPct: null,
});

/** @type {ReadonlySet<string>} */
const ALIGN_ALLOWED = new Set([
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

/** Flex [alignItems, justifyContent] for `.site-frame__cell-shape-wrap`. */
export const SHAPE_ALIGN_TO_FLEX = {
  center: ["center", "center"],
  top: ["flex-start", "center"],
  bottom: ["flex-end", "center"],
  left: ["center", "flex-start"],
  right: ["center", "flex-end"],
  "top-left": ["flex-start", "flex-start"],
  "top-right": ["flex-start", "flex-end"],
  "bottom-left": ["flex-end", "flex-start"],
  "bottom-right": ["flex-end", "flex-end"],
};

/**
 * @param {unknown} raw
 * @returns {ShapeSizeMode}
 */
export function parseShapeSizeMode(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return s === "stretch_grid" || s === "stretch" ? "stretch_grid" : "keep_ratio";
}

/**
 * @param {ShapeStyle | Record<string, unknown>} style
 * @returns {boolean}
 */
export function isShapeKeepRatio(style) {
  return parseShapeSizeMode(style && style.sizeMode) === "keep_ratio";
}

/**
 * @param {ShapeStyle | Record<string, unknown>} style
 * @returns {number}
 */
export function shapeScalePctFromStyle(style) {
  const s = normalizeShapeStyle(style);
  return Math.max(s.widthPct, s.heightPct);
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeShapeColor(raw) {
  const s = String(raw || "").trim().slice(0, 120);
  if (!s || s === "inherit" || s === "currentColor") {
    return "";
  }
  const low = s.toLowerCase();
  if (low.startsWith("javascript:") || low.startsWith("data:")) {
    return "";
  }
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    return s;
  }
  if (/^(rgb|rgba|hsl|hsla)\([^)]+\)$/i.test(s)) {
    return s;
  }
  return "";
}

/**
 * @param {unknown} raw
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * @param {unknown} raw
 * @returns {ShapeStyle}
 */
export function normalizeShapeStyle(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const kindRaw = String(o.shapeKind || o.shape_kind || "square").toLowerCase();
  /** @type {ShapeKind} */
  const shapeKind = SHAPE_KINDS.includes(/** @type {ShapeKind} */ (kindRaw)) ? /** @type {ShapeKind} */ (kindRaw) : "square";
  const sizeMode = parseShapeSizeMode(o.sizeMode ?? o.size_mode);
  const alignRaw = String(o.objectAlign || o.object_align || "center")
    .toLowerCase()
    .replace(/\s+/g, "-");
  const objectAlign = ALIGN_ALLOWED.has(alignRaw) ? alignRaw : "center";
  const fillColor = sanitizeShapeColor(o.fillColor || o.fill_color) || "#000000";
  const strokeColor = sanitizeShapeColor(o.strokeColor || o.stroke_color) || "#000000";
  let widthPct = clampFrameCellScalePct(o.widthPct ?? o.width_pct, DEFAULT_SHAPE_STYLE.widthPct);
  let heightPct = clampFrameCellScalePct(o.heightPct ?? o.height_pct, DEFAULT_SHAPE_STYLE.heightPct);
  if (sizeMode === "keep_ratio") {
    const scale = clampFrameCellScalePct(
      o.scalePct ?? Math.max(widthPct, heightPct),
      Math.max(widthPct, heightPct),
    );
    widthPct = scale;
    heightPct = scale;
  }
  return {
    shapeKind,
    sizeMode,
    widthPct,
    heightPct,
    objectAlign,
    rotationDeg: clampInt(o.rotationDeg ?? o.rotation_deg, 0, 360, 0),
    cornerRadiusPct: clampInt(o.cornerRadiusPct ?? o.corner_radius_pct, 0, 50, 0),
    fillEnabled:
      o.fillEnabled === false ||
      o.fill_enabled === 0 ||
      o.fill_enabled === false ||
      o.fill_enabled === "0"
        ? false
        : o.fillEnabled != null || o.fill_enabled != null
          ? Boolean(o.fillEnabled ?? o.fill_enabled)
          : true,
    fillColor,
    fillOpacityPct: clampInt(o.fillOpacityPct ?? o.fill_opacity_pct, 0, 100, 100),
    strokeEnabled: Boolean(o.strokeEnabled ?? o.stroke_enabled),
    strokeColor,
    strokeOpacityPct: clampInt(o.strokeOpacityPct ?? o.stroke_opacity_pct, 0, 100, 100),
    strokeWidthPx: clampInt(o.strokeWidthPx ?? o.stroke_width_px, 0, 48, 2),
    linkHref: String(o.linkHref || o.link_href || "").trim(),
    placementLeftPct: parsePlacementPct(o.placementLeftPct ?? o.placement_left_pct),
    placementTopPct: parsePlacementPct(o.placementTopPct ?? o.placement_top_pct),
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** @type {WeakMap<SVGElement, ResizeObserver>} */
const shapeGridObservers = new WeakMap();

/**
 * @param {SVGElement} svg
 */
function disconnectShapeGridObserver(svg) {
  const ro = shapeGridObservers.get(svg);
  if (ro) {
    ro.disconnect();
    shapeGridObservers.delete(svg);
  }
}

/**
 * Size shape as % of the frame grid (`[data-site-frame-page]`), not the cell mount.
 * @param {SVGElement} svg
 * @param {ShapeStyle} style
 * @param {Element | null | undefined} contextEl
 * @param {boolean} [relativeToFrame] when true, % is of `[data-site-frame-page]`; else of the cell mount
 */
export function applyShapeGridDimensions(svg, style, contextEl, relativeToFrame = false) {
  disconnectShapeGridObserver(svg);
  const s = normalizeShapeStyle(style);
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
    svg.classList.remove("site-frame__cell-shape--grid-sized");
    svg.style.width = `${s.widthPct}%`;
    svg.style.height = `${s.heightPct}%`;
  };

  if (!(measureRoot instanceof Element)) {
    applyPctFallback();
    svg.setAttribute("width", `${s.widthPct}%`);
    svg.setAttribute("height", `${s.heightPct}%`);
    return;
  }

  const applyFromMeasureRoot = () => {
    if (!svg.isConnected) {
      disconnectShapeGridObserver(svg);
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
    svg.classList.add("site-frame__cell-shape--grid-sized");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = `${(mw * s.widthPct) / 100}px`;
    svg.style.height = `${(mh * s.heightPct) / 100}px`;
  };

  applyFromMeasureRoot();
  const ro = new ResizeObserver(applyFromMeasureRoot);
  ro.observe(/** @type {Element} */ (measureRoot));
  shapeGridObservers.set(svg, ro);
  if (measureRoot.getBoundingClientRect().width < 1) {
    requestAnimationFrame(applyFromMeasureRoot);
  }
}

/**
 * @param {ShapeStyle} s
 * @param {Element | null | undefined} [contextEl] mount or ancestor for frame root lookup
 * @param {{ relativeToFrame?: boolean }} [options]
 * @returns {SVGElement}
 */
export function createShapeSvgElement(s, contextEl, options = {}) {
  const style = normalizeShapeStyle(s);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "site-frame__cell-shape");
  svg.setAttribute("viewBox", "0 0 100 100");
  if (style.sizeMode === "stretch_grid") {
    svg.setAttribute("preserveAspectRatio", "none");
  } else {
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }
  applyShapeGridDimensions(svg, style, contextEl, options.relativeToFrame === true);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const g = document.createElementNS(SVG_NS, "g");
  if (style.rotationDeg) {
    g.setAttribute("transform", `rotate(${style.rotationDeg} 50 50)`);
  }

  /** @type {SVGGeometryElement} */
  let geom;
  if (style.shapeKind === "circle") {
    const el = document.createElementNS(SVG_NS, "ellipse");
    el.setAttribute("cx", "50");
    el.setAttribute("cy", "50");
    el.setAttribute("rx", "50");
    el.setAttribute("ry", "50");
    geom = el;
  } else if (style.shapeKind === "triangle") {
    const el = document.createElementNS(SVG_NS, "polygon");
    el.setAttribute("points", "50,6 94,94 6,94");
    geom = el;
  } else {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("x", "0");
    el.setAttribute("y", "0");
    el.setAttribute("width", "100");
    el.setAttribute("height", "100");
    const r = (style.cornerRadiusPct / 100) * 50;
    if (r > 0) {
      el.setAttribute("rx", String(r));
      el.setAttribute("ry", String(r));
    }
    geom = el;
  }

  if (style.fillEnabled) {
    geom.setAttribute("fill", style.fillColor);
    geom.setAttribute("fill-opacity", String(style.fillOpacityPct / 100));
  } else {
    geom.setAttribute("fill", "none");
  }

  if (style.strokeEnabled && style.strokeWidthPx > 0) {
    geom.setAttribute("stroke", style.strokeColor);
    geom.setAttribute("stroke-opacity", String(style.strokeOpacityPct / 100));
    geom.setAttribute("stroke-width", String(style.strokeWidthPx));
    geom.setAttribute("vector-effect", "non-scaling-stroke");
  } else {
    geom.setAttribute("stroke", "none");
  }

  g.appendChild(geom);
  svg.appendChild(g);
  return svg;
}
