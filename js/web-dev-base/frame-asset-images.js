/**
 * Frame image cells: paths stored relative to `assets/` (e.g. `images/foo.png`).
 */

export const ASSET_IMAGE_PATH_PREFIX = "images/";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/**
 * Encode each segment of a relative asset URL (spaces, etc.) while keeping `/` and `..`.
 * @param {string} relativeUrl
 * @returns {string}
 */
export function encodeRelativeAssetUrl(relativeUrl) {
  const s = String(relativeUrl || "").trim();
  if (!s || /^https?:\/\//i.test(s)) {
    return s;
  }
  return s
    .split("/")
    .map((seg) => {
      if (seg === "" || seg === "." || seg === "..") {
        return seg;
      }
      return encodeURIComponent(seg);
    })
    .join("/");
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeStoredAssetImagePath(raw) {
  let s = String(raw || "").trim();
  if (!s) {
    return "";
  }
  if (/^https?:\/\//i.test(s)) {
    return s;
  }
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch (_e) {
      /* keep raw */
    }
  }
  s = s.replace(/\\/g, "/");
  const q = s.indexOf("?");
  if (q >= 0) {
    s = s.slice(0, q);
  }
  const h = s.indexOf("#");
  if (h >= 0) {
    s = s.slice(0, h);
  }
  const low = s.toLowerCase();
  for (const marker of ["assets/images/", "/assets/images/"]) {
    const idx = low.indexOf(marker);
    if (idx >= 0) {
      const rest = s.slice(idx + marker.length).replace(/^\/+/, "");
      if (!rest || rest.includes("..")) {
        return "";
      }
      return ASSET_IMAGE_PATH_PREFIX + rest;
    }
  }
  if (low.startsWith("../assets/images/")) {
    const rest = s.slice("../assets/images/".length).replace(/^\/+/, "");
    if (!rest || rest.includes("..")) {
      return "";
    }
    return ASSET_IMAGE_PATH_PREFIX + rest;
  }
  if (low.startsWith(ASSET_IMAGE_PATH_PREFIX)) {
    const rest = s.slice(ASSET_IMAGE_PATH_PREFIX.length);
    if (!rest || rest.split("/").some((p) => p === "..")) {
      return "";
    }
    return ASSET_IMAGE_PATH_PREFIX + rest.replace(/^\/+/, "");
  }
  if (!s.includes("/") && IMAGE_EXT.test(s)) {
    return ASSET_IMAGE_PATH_PREFIX + s;
  }
  if (s.includes("..") || s.includes("://")) {
    return "";
  }
  const stripped = s.replace(/^\/+/, "");
  if (!low.startsWith(ASSET_IMAGE_PATH_PREFIX)) {
    if (stripped.toLowerCase().startsWith("assets/images/")) {
      return normalizeStoredAssetImagePath(stripped);
    }
    return ASSET_IMAGE_PATH_PREFIX + stripped;
  }
  return "";
}

/**
 * @param {string} stored Path relative to `assets/` (e.g. `images/foo.png`).
 * @param {Location | undefined} [loc]
 * @returns {string}
 */
export function resolveAssetImageSrc(stored, loc) {
  const norm = normalizeStoredAssetImagePath(stored);
  if (!norm) {
    return "";
  }
  if (/^https?:\/\//i.test(norm)) {
    return norm;
  }
  const location = loc || (typeof window !== "undefined" ? window.location : null);
  const pathname = location && location.pathname ? location.pathname : "";
  const prefix = /\/pages\//i.test(pathname) ? "../assets/" : "assets/";
  return encodeRelativeAssetUrl(prefix + norm);
}

/**
 * @param {HTMLSelectElement} sel
 * @param {Array<{ path: string, label?: string }>} images
 * @param {string} [selectedPath]
 */
export function fillAssetImageSelect(sel, images, selectedPath) {
  const prev = selectedPath != null ? selectedPath : sel.value;
  sel.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "(none)";
  sel.appendChild(none);
  const list = Array.isArray(images) ? images : [];
  list.forEach((img) => {
    const path = String(img.path || "").trim();
    if (!path) {
      return;
    }
    const o = document.createElement("option");
    o.value = path;
    o.textContent = img.label != null ? String(img.label) : path;
    sel.appendChild(o);
  });
  const norm = normalizeStoredAssetImagePath(prev);
  if (norm && [...sel.options].some((o) => o.value === norm)) {
    sel.value = norm;
  } else if (norm) {
    const o = document.createElement("option");
    o.value = norm;
    o.textContent = norm + " (not in list)";
    sel.appendChild(o);
    sel.value = norm;
  } else {
    sel.value = "";
  }
}

/**
 * @param {string} stored
 * @returns {string}
 */
export function assetImageSummary(stored) {
  const p = normalizeStoredAssetImagePath(stored);
  if (!p) {
    return "(no image)";
  }
  const s = p.replace(/\s+/g, " ");
  return s.length <= 72 ? s : s.slice(0, 71) + "…";
}
