/**
 * Identity + mapping: SQLite / layout API ↔ createDraggableGallery layout fields.
 * Interaction prefs (gestures, scroll, zoom open/close anim, stripClosedAlign) stay in gallery-core session/publish.
 */

/**
 * @param {string} [pathname]
 * @returns {string}
 */
export function pageNameFromPathname(pathname) {
  const p =
    (pathname != null && String(pathname)) ||
    (typeof location !== "undefined" ? location.pathname : "") ||
    "";
  const trimmed = p.replace(/\/+$/, "") || "/";
  const parts = trimmed.split("/").filter(Boolean);
  let base = parts.length ? parts[parts.length - 1] : "index";
  if (base.endsWith(".html")) {
    base = base.slice(0, -5);
  }
  return base || "index";
}

/**
 * @param {HTMLElement} root
 * @returns {string}
 */
export function galleryKeyFromRoot(root) {
  if (!root || !root.dataset) {
    return "default";
  }
  const k = String(root.dataset.galleryKey ?? "").trim();
  return k || "default";
}

/**
 * @returns {string}
 */
export function resolveDefaultLayoutApiBase() {
  if (typeof window !== "undefined" && typeof window.__CUSTOMDEV_LAYOUT_API__ === "string") {
    const t = window.__CUSTOMDEV_LAYOUT_API__.trim();
    if (t) {
      return t.replace(/\/$/, "");
    }
  }
  if (typeof document !== "undefined") {
    const m = document.querySelector('meta[name="customdev-layout-api"]');
    const c = m && m.getAttribute("content");
    if (c && String(c).trim()) {
      return String(c).trim().replace(/\/$/, "");
    }
  }
  return "http://127.0.0.1:8787";
}

/**
 * @param {{ layoutApiBase?: string | null }} opts
 * @param {{ staging?: boolean }} [ctx]
 * @returns {string | null}
 */
export function resolveLayoutApiBaseForGallery(opts, ctx = {}) {
  if (opts && opts.layoutApiBase === null) {
    return null;
  }
  if (opts && typeof opts.layoutApiBase === "string" && opts.layoutApiBase.trim()) {
    return opts.layoutApiBase.trim().replace(/\/$/, "");
  }
  const staging =
    ctx.staging != null
      ? ctx.staging
      : typeof document !== "undefined" &&
          document.documentElement.classList.contains("staging") &&
          !document.documentElement.classList.contains("official-live");
  if (!staging) {
    return null;
  }
  return resolveDefaultLayoutApiBase();
}

const ZOOM_STYLE_TO_TRANSITION = {
  "": "none",
  none: "none",
  crossfade: "crossfade",
  bookflip: "bookflip",
  book: "bookflip",
};

/**
 * @param {unknown} zoomStyle
 * @returns {"none" | "crossfade" | "bookflip"}
 */
export function mapZoomStyleToSlideTransition(zoomStyle) {
  const z = String(zoomStyle == null ? "" : zoomStyle)
    .trim()
    .toLowerCase();
  const v = ZOOM_STYLE_TO_TRANSITION[z];
  if (v === "none" || v === "crossfade" || v === "bookflip") {
    return v;
  }
  return "none";
}

/**
 * @param {number} columnCount
 * @returns {{ count: number, ratioCsv: string }}
 */
export function zoomOpenDividersFromColumnCount(columnCount) {
  const n = Math.max(2, Math.min(8, Math.floor(Number(columnCount)) || 2));
  const ratioCsv = n === 2 ? "1,3" : Array(n).fill("1").join(",");
  return { count: n, ratioCsv };
}

/**
 * @param {string} raw
 * @returns {string}
 */
function slugLayoutToken(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return t;
}

/**
 * @param {HTMLElement} root
 * @param {unknown} galleryStyle
 * @param {unknown} thumbnailStyle
 */
export function applyLayoutStyleTokens(root, galleryStyle, thumbnailStyle) {
  if (!root || !root.classList) {
    return;
  }
  for (const c of [...root.classList]) {
    if (c.startsWith("draggable-gallery--layout-g-") || c.startsWith("draggable-gallery--layout-t-")) {
      root.classList.remove(c);
    }
  }
  const g = slugLayoutToken(galleryStyle);
  if (g) {
    root.classList.add(`draggable-gallery--layout-g-${g}`);
  }
  const th = slugLayoutToken(thumbnailStyle);
  if (th) {
    root.classList.add(`draggable-gallery--layout-t-${th}`);
  }
}

/**
 * @param {HTMLElement} root
 * @param {{ thumbnail: number, zoom: number }} flags
 */
export function applyGalleryLayoutClasses(root, flags) {
  if (!root || !root.classList) {
    return;
  }
  root.classList.toggle("draggable-gallery--layout-no-strip", flags.thumbnail === 0);
  root.classList.toggle("draggable-gallery--layout-no-zoom", flags.zoom === 0);
}

/**
 * @param {Record<string, unknown>} row — gallery object from GET /api/layout (camelCase)
 * @returns {{
 *   zoomThumbFill: boolean,
 *   zoomOpenDividers: { count: number, ratioCsv: string },
 *   slideTransition: "none" | "crossfade" | "bookflip",
 *   layoutThumbnail: number,
 *   layoutZoom: number,
 * }}
 */
export function mapGalleryRowToInitialOptions(row) {
  if (!row || typeof row !== "object") {
    return {
      zoomThumbFill: false,
      zoomOpenDividers: { count: 2, ratioCsv: "1,3" },
      slideTransition: "none",
      layoutThumbnail: 1,
      layoutZoom: 1,
    };
  }
  const thumbnail = Number(row.thumbnail) === 1 ? 1 : 0;
  const zoom = Number(row.zoom) === 1 ? 1 : 0;
  const zoomOpenDividers = zoomOpenDividersFromColumnCount(row.columnCount);
  const thumbStyle = String(row.thumbnailStyle ?? "")
    .trim()
    .toLowerCase();
  const zoomThumbFill = thumbStyle === "fill" || thumbStyle === "cover";
  return {
    zoomThumbFill,
    zoomOpenDividers,
    slideTransition: mapZoomStyleToSlideTransition(row.zoomStyle),
    layoutThumbnail: thumbnail,
    layoutZoom: zoom,
  };
}

/**
 * Strip draggable-gallery--layout-* classes from root (destroy / reset).
 * @param {HTMLElement} root
 */
export function clearGalleryLayoutClasses(root) {
  if (!root || !root.classList) {
    return;
  }
  for (const c of [...root.classList]) {
    if (
      c.startsWith("draggable-gallery--layout-g-") ||
      c.startsWith("draggable-gallery--layout-t-") ||
      c === "draggable-gallery--layout-no-strip" ||
      c === "draggable-gallery--layout-no-zoom"
    ) {
      root.classList.remove(c);
    }
  }
}
