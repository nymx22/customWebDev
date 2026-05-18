/**
 * Static layout JSON baked from SQLite (`data/layout/` via `lib/db/export_layout.py`).
 * Used on official-live and whenever API is unavailable but baked files exist.
 */

const OFFICIAL_LIVE_STORAGE_KEY = "customdev_official_live";

/**
 * @param {string | null | undefined} raw
 * @returns {boolean | null}
 */
function parseOfficialLiveFlag(raw) {
  if (raw == null) {
    return null;
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) {
    return true;
  }
  if (s === "true" || s === "1" || s === "yes" || s === "on") {
    return true;
  }
  if (s === "false" || s === "0" || s === "no" || s === "off") {
    return false;
  }
  return null;
}

function readOfficialLiveStorageOverride() {
  try {
    return parseOfficialLiveFlag(window.localStorage.getItem(OFFICIAL_LIVE_STORAGE_KEY));
  } catch (_e) {
    return null;
  }
}

/**
 * @returns {boolean}
 */
export function isOfficialLiveDocument() {
  const fromStorage = readOfficialLiveStorageOverride();
  if (fromStorage !== null) {
    return fromStorage;
  }
  try {
    const html = document.documentElement;
    if (html.classList.contains("official-live")) {
      return true;
    }
    if (html.hasAttribute("data-official-live")) {
      const fromAttr = parseOfficialLiveFlag(html.getAttribute("data-official-live"));
      if (fromAttr !== null) {
        return fromAttr;
      }
      return true;
    }
  } catch (_e) {
    /* ignore */
  }
  const m = document.querySelector('meta[name="customdev-official-live"]');
  if (m) {
    const fromMeta = parseOfficialLiveFlag(m.getAttribute("content"));
    if (fromMeta !== null) {
      return fromMeta;
    }
  }
  return false;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function resolveSiteRelativePath(path) {
  const raw = String(path || "").trim().replace(/\/$/, "");
  if (!raw) {
    return "";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (raw.startsWith("/")) {
    return raw;
  }
  const onSubpage =
    typeof location !== "undefined" && /\/pages\//i.test(location.pathname || "");
  const prefix = onSubpage ? "../" : "";
  return `${prefix}${raw}`.replace(/\/+/g, "/");
}

/**
 * Base URL/path for baked layout files (`data/layout` by default on official-live).
 * @returns {string | null}
 */
export function resolveBakedLayoutBase() {
  if (typeof document !== "undefined") {
    const m = document.querySelector('meta[name="customdev-layout-baked"]');
    const c = m && m.getAttribute("content");
    if (c && String(c).trim()) {
      return resolveSiteRelativePath(String(c).trim());
    }
  }
  if (isOfficialLiveDocument()) {
    return resolveSiteRelativePath("data/layout");
  }
  return null;
}

/**
 * @param {string} pageName
 * @returns {Promise<{ page?: object, frame?: object, cells?: object[] } | null>}
 */
export async function fetchBakedFrame(pageName) {
  const base = resolveBakedLayoutBase();
  const name = String(pageName || "").trim();
  if (!base || !name) {
    return null;
  }
  const url = `${base}/frame/${encodeURIComponent(name)}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch (_e) {
    return null;
  }
}

/**
 * @param {string} pageName
 * @param {string} galleryKey
 * @returns {Promise<{ page?: object, gallery?: object, font?: object } | null>}
 */
export async function fetchBakedGalleryLayout(pageName, galleryKey) {
  const base = resolveBakedLayoutBase();
  const page = String(pageName || "").trim();
  const key = String(galleryKey || "default").trim() || "default";
  if (!base || !page) {
    return null;
  }
  const url = `${base}/gallery/${encodeURIComponent(page)}/${encodeURIComponent(key)}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data && typeof data === "object" ? data : null;
  } catch (_e) {
    return null;
  }
}

/**
 * @param {{ layoutBaked?: boolean }} [opts]
 * @returns {boolean}
 */
export function shouldUseBakedLayout(opts) {
  if (opts && opts.layoutBaked === false) {
    return false;
  }
  if (opts && opts.layoutBaked === true) {
    return true;
  }
  return isOfficialLiveDocument();
}

/**
 * @param {{ layoutApiBase?: string | null, layoutBaked?: boolean }} [opts]
 * @param {{ staging?: boolean }} [ctx]
 * @returns {{ type: "api", base: string } | { type: "baked", base: string } | null}
 */
export function resolveGalleryLayoutSource(opts, ctx = {}) {
  if (opts && opts.layoutApiBase === null) {
    return null;
  }
  if (opts && typeof opts.layoutApiBase === "string" && opts.layoutApiBase.trim()) {
    return { type: "api", base: opts.layoutApiBase.trim().replace(/\/$/, "") };
  }
  if (ctx.staging === false) {
    if (shouldUseBakedLayout(opts)) {
      const baked = resolveBakedLayoutBase();
      return baked ? { type: "baked", base: baked } : null;
    }
    return null;
  }
  if (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("official-live")
  ) {
    const baked = resolveBakedLayoutBase();
    if (baked && shouldUseBakedLayout(opts)) {
      return { type: "baked", base: baked };
    }
    if (typeof window !== "undefined" && typeof window.__CUSTOMDEV_LAYOUT_API__ === "string") {
      const t = window.__CUSTOMDEV_LAYOUT_API__.trim();
      if (t) {
        return { type: "api", base: t.replace(/\/$/, "") };
      }
    }
    const m = document.querySelector('meta[name="customdev-layout-api"]');
    const c = m && m.getAttribute("content");
    if (c && String(c).trim()) {
      return { type: "api", base: String(c).trim().replace(/\/$/, "") };
    }
    return baked ? { type: "baked", base: baked } : null;
  }
  if (typeof window !== "undefined" && typeof window.__CUSTOMDEV_LAYOUT_API__ === "string") {
    const t = window.__CUSTOMDEV_LAYOUT_API__.trim();
    if (t) {
      return { type: "api", base: t.replace(/\/$/, "") };
    }
  }
  if (typeof document !== "undefined") {
    const m = document.querySelector('meta[name="customdev-layout-api"]');
    const c = m && m.getAttribute("content");
    if (c && String(c).trim()) {
      return { type: "api", base: String(c).trim().replace(/\/$/, "") };
    }
  }
  if (shouldUseBakedLayout(opts)) {
    const baked = resolveBakedLayoutBase();
    if (baked) {
      return { type: "baked", base: baked };
    }
  }
  return { type: "api", base: "http://127.0.0.1:8787" };
}

/**
 * @param {string} pageName
 * @param {string} galleryKey
 * @param {{ layoutApiBase?: string | null, layoutBaked?: boolean }} [opts]
 * @param {{ staging?: boolean }} [ctx]
 * @returns {Promise<{ page?: object, gallery?: object, font?: object } | null>}
 */
export async function fetchGalleryLayoutPayload(pageName, galleryKey, opts, ctx = {}) {
  const source = resolveGalleryLayoutSource(opts, ctx);
  if (!source) {
    return null;
  }
  if (source.type === "api") {
    try {
      const res = await fetch(
        `${source.base}/api/layout?page=${encodeURIComponent(pageName)}&galleryKey=${encodeURIComponent(galleryKey)}`,
        { mode: "cors" },
      );
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      return data && typeof data === "object" ? data : null;
    } catch (_e) {
      return null;
    }
  }
  return fetchBakedGalleryLayout(pageName, galleryKey);
}
