/**
 * Site **frame**: a page-owned grid of cells (plain **text** with optional link + typography, HTML, image URL, tab text table, or empty).
 * Use `createDraggableGallery` only for strip/zoom **media** galleries (images / video-audio style playback).
 *
 * Staging UI for the frame grid is built by **`mountFrameStagingTestingGui`** in `staging-gui-settings.js`.
 *
 * Expects `[data-frame-cell-index]` mount nodes inside `root` and optional `data-site-frame-page` on `root`
 * for staging UI + API `GET /api/frame?page=…`.
 */

import { resolveAssetImageSrc } from "./frame-asset-images.js";
import {
  applyCellPaddingStyles,
  cellPaddingIsActive,
  syncCellPaddingOverrideClass,
} from "./frame-cell-padding.js";
import { renderBodyBlocksIntoParagraph, resolveBodyBlocks, sanitizeNavUrl } from "./frame-text-blocks.js";
import { applyTextLinkStyleToWrap, normalizeTextLinkStyle } from "./frame-text-link-style.js";
import { fetchBakedFrame } from "./layout-baked.js";
import { applyGridGapStyles } from "./frame-grid-gap.js";
import { buildTabTextTable } from "./frame-tab-table.js";
import { STAGING_FRAME_SETTINGS_EVENT, mountFrameStagingTestingGui } from "./staging-gui-settings.js";

export { STAGING_FRAME_SETTINGS_EVENT };
export { buildTabTextTable } from "./frame-tab-table.js";

function resolveFrameApiBase() {
  if (typeof window.__CUSTOMDEV_LAYOUT_API__ === "string" && window.__CUSTOMDEV_LAYOUT_API__.trim()) {
    return window.__CUSTOMDEV_LAYOUT_API__.trim().replace(/\/$/, "");
  }
  const m = document.querySelector('meta[name="customdev-layout-api"]');
  if (m && m.getAttribute("content") && String(m.getAttribute("content")).trim()) {
    return String(m.getAttribute("content")).trim().replace(/\/$/, "");
  }
  try {
    if (document.documentElement.classList.contains("official-live")) {
      return null;
    }
  } catch (_e) {
    return null;
  }
  return "http://127.0.0.1:8787";
}

function isHtmlStaging() {
  try {
    return (
      document.documentElement.classList.contains("staging") &&
      !document.documentElement.classList.contains("official-live")
    );
  } catch (_e) {
    return false;
  }
}

/** Remove legacy per-slot border styles (older site-frame builds used inline borders). */
function clearStagingColumnSlotDividerStyles(root) {
  if (!root) {
    return;
  }
  root.querySelectorAll(".column-slot").forEach((slot) => {
    slot.style.removeProperty("border-right");
    slot.style.removeProperty("border-bottom");
  });
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   gridGap?: string | object,
 *   columnCount?: number,
 *   rowCount?: number,
 * } | null} frame
 */
export function applyFrameRootLayout(root, frame) {
  if (!root) {
    return;
  }
  applyGridGapStyles(root, frame && frame.gridGap);

  if (frame && typeof frame === "object") {
    const rawC = Number(frame.columnCount);
    const rawR = Number(frame.rowCount);
    const c =
      Number.isFinite(rawC) && rawC >= 1 ? Math.min(24, Math.floor(rawC)) : null;
    const r =
      Number.isFinite(rawR) && rawR >= 1 ? Math.min(24, Math.floor(rawR)) : null;
    if (c != null) {
      root.style.setProperty("--columns-laptop", String(c));
      root.dataset.siteFrameCols = String(c);
    } else {
      root.style.removeProperty("--columns-laptop");
      delete root.dataset.siteFrameCols;
    }
    if (r != null) {
      root.style.setProperty("--site-frame-rows", String(r));
      root.dataset.siteFrameRows = String(r);
    } else {
      root.style.removeProperty("--site-frame-rows");
      delete root.dataset.siteFrameRows;
    }
  } else {
    root.style.removeProperty("--columns-laptop");
    root.style.removeProperty("--site-frame-rows");
    delete root.dataset.siteFrameCols;
    delete root.dataset.siteFrameRows;
  }
  clearStagingColumnSlotDividerStyles(root);

  if (frame && typeof frame === "object") {
    const rawC = Number(frame.columnCount);
    const rawR = Number(frame.rowCount);
    const c =
      Number.isFinite(rawC) && rawC >= 1 ? Math.min(24, Math.floor(rawC)) : null;
    const r =
      Number.isFinite(rawR) && rawR >= 1 ? Math.min(24, Math.floor(rawR)) : null;
    if (c != null && r != null) {
      syncFrameGridSlots(root, c, r);
    }
  }
}

/**
 * Ensure `root` has `columnCount * rowCount` `.column-slot` children with mounts (row-major indices).
 * Reuses existing mounts by `data-frame-cell-index` and preserves each slot's `class` when possible.
 *
 * @param {HTMLElement} root
 * @param {number} columnCount
 * @param {number} rowCount
 */
export function syncFrameGridSlots(root, columnCount, rowCount) {
  if (!root) {
    return;
  }
  const cols = Math.min(24, Math.max(1, Math.floor(columnCount) || 1));
  const rows = Math.min(24, Math.max(1, Math.floor(rowCount) || 1));
  const need = cols * rows;

  /** @type {Map<number, HTMLElement>} */
  const mountsByIndex = new Map();
  /** @type {Map<number, string>} */
  const slotClassByIndex = new Map();
  root.querySelectorAll(":scope > .column-slot").forEach((slot) => {
    const mount = slot.querySelector("[data-frame-cell-index]");
    if (!mount) {
      return;
    }
    const idx = parseInt(mount.getAttribute("data-frame-cell-index") || "", 10);
    if (!Number.isFinite(idx)) {
      return;
    }
    mountsByIndex.set(idx, /** @type {HTMLElement} */ (mount));
    slotClassByIndex.set(idx, slot.className);
  });

  const frag = document.createDocumentFragment();
  for (let i = 0; i < need; i++) {
    const slot = document.createElement("div");
    slot.className = slotClassByIndex.get(i) || "column-slot column-slot--spacer";
    let mount = mountsByIndex.get(i);
    if (!mount) {
      mount = document.createElement("div");
      mount.className = "site-frame__cell-mount";
      mount.dataset.frameCellIndex = String(i);
      mount.setAttribute("aria-hidden", "true");
    } else {
      mount.dataset.frameCellIndex = String(i);
    }
    slot.appendChild(mount);
    frag.appendChild(slot);
  }

  root.querySelectorAll(":scope > .column-slot").forEach((slot) => slot.remove());
  root.appendChild(frag);
}

/**
 * @param {HTMLElement} mountEl
 * @param {{
 *   id?: number,
 *   cellIndex?: number,
 *   contentType?: string,
 *   body?: string,
 *   cellRole?: string,
 *   cellPadding?: string,
 *   textStyle?: {
 *     fontFamily?: string,
 *     fontSize?: number,
 *     lineHeightPct?: number,
 *     padding?: string,
 *     navUrl?: string,
 *     navLabel?: string,
 *     bodyBlocks?: Array<{ type: string, value?: string, href?: string, label?: string }>,
 *   } | null,
 *   imageStyle?: {
 *     objectFit?: string,
 *     objectAlign?: string,
 *     maxWidth?: string,
 *     scalePct?: number,
 *   } | null,
 * }} cell
 */
function applyCellToMount(mountEl, cell) {
  if (cell && typeof cell.id === "number") {
    mountEl.dataset.frameCellId = String(cell.id);
  } else {
    delete mountEl.dataset.frameCellId;
  }
  mountEl.removeAttribute("aria-hidden");
  mountEl.textContent = "";
  delete mountEl.dataset.frameTableBody;
  delete mountEl.dataset.frameCellRole;
  delete mountEl.dataset.frameImageStyle;
  delete mountEl.dataset.frameCellPadding;
  mountEl.className = "site-frame__cell-mount";
  mountEl.removeAttribute("aria-label");
  mountEl.style.removeProperty("padding");
  const role = (cell && String(cell.cellRole || "").trim()) || "";
  if (role) {
    mountEl.dataset.frameCellRole = role.slice(0, 120);
  }
  const t = ((cell && cell.contentType) || "empty").toLowerCase();
  mountEl.dataset.frameContentType = t;
  const body = (cell && cell.body) || "";
  const cellPad = cell && cell.cellPadding;
  const isImageCell = t === "image" && String(body).trim();
  if (!isImageCell) {
    applyCellPaddingStyles(mountEl, cellPad);
  } else {
    syncCellPaddingOverrideClass(mountEl, cellPaddingIsActive(cellPad));
  }
  delete mountEl.dataset.frameTextStyle;
  /** @type {Record<string, string>} */
  const alignToPosition = {
    center: "center center",
    top: "center top",
    bottom: "center bottom",
    left: "left center",
    right: "right center",
    "top-left": "left top",
    "top-right": "right top",
    "bottom-left": "left bottom",
    "bottom-right": "right bottom",
  };
  const alignToFlex = {
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
  if (isImageCell) {
    mountEl.classList.add("site-frame__cell-mount--image");
    const is = (cell && cell.imageStyle) || {};
    const fitRaw = String(is.objectFit || "contain").toLowerCase();
    const fitAllowed = new Set(["contain", "cover", "fill", "scale-down", "none"]);
    const fit = fitAllowed.has(fitRaw) ? fitRaw : "contain";
    const alignRaw = String(is.objectAlign || "center").toLowerCase().replace(/\s+/g, "-");
    const alignKey = alignRaw in alignToPosition ? alignRaw : "center";
    const pos = alignToPosition[alignKey];
    const flexAlign = alignToFlex[alignKey] || alignToFlex.center;
    const mw = String(is.maxWidth || "").trim();
    const scaleRaw = Number(is.scalePct);
    const scalePct = Number.isFinite(scaleRaw) ? Math.min(250, Math.max(25, Math.round(scaleRaw))) : 100;
    const wrap = document.createElement("div");
    wrap.className = "site-frame__cell-image-wrap";
    wrap.style.alignItems = flexAlign[0];
    wrap.style.justifyContent = flexAlign[1];
    applyCellPaddingStyles(wrap, cellPad, { pageOverrideClass: false });

    const img = document.createElement("img");
    img.src = resolveAssetImageSrc(String(body).trim());
    img.alt = "";
    img.className = "site-frame__cell-image";
    img.decoding = "async";
    img.style.objectFit = fit;
    img.style.objectPosition = pos;
    img.style.flexShrink = "0";
    img.style.maxWidth = mw || "100%";
    img.style.maxHeight = "100%";
    if (mw) {
      img.style.width = `min(${scalePct}%, ${mw})`;
    } else {
      img.style.width = `${scalePct}%`;
    }
    img.style.height = `${scalePct}%`;
    img.style.removeProperty("transform");
    img.style.removeProperty("transform-origin");
    const linkHref = sanitizeNavUrl(String(is.linkHref || is.link_href || ""));
    if (linkHref) {
      const a = document.createElement("a");
      a.href = linkHref;
      a.className = "site-frame__cell-image-link";
      if (/^https?:/i.test(linkHref)) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.appendChild(img);
      wrap.appendChild(a);
    } else {
      wrap.appendChild(img);
    }
    mountEl.appendChild(wrap);
    try {
      mountEl.dataset.frameImageStyle = encodeURIComponent(
        JSON.stringify({
          objectFit: fit,
          objectAlign: alignKey,
          maxWidth: mw,
          scalePct,
          linkHref,
        }),
      );
    } catch (_e) {
      delete mountEl.dataset.frameImageStyle;
    }
  } else if (t === "html") {
    mountEl.innerHTML = body;
  } else if (t === "table") {
    mountEl.dataset.frameTableBody = encodeURIComponent(String(body));
    const tbl = buildTabTextTable(body);
    if (!tbl) {
      mountEl.innerHTML = "";
      mountEl.setAttribute("aria-hidden", "true");
    } else {
      const wrap = document.createElement("div");
      wrap.className = "site-frame__cell-table-wrap";
      wrap.appendChild(tbl);
      mountEl.appendChild(wrap);
    }
  } else if (t === "text") {
    const ts = (cell && cell.textStyle) || {};
    const wrap = document.createElement("div");
    wrap.className = "site-frame__cell-text";
    const ff = String(ts.fontFamily || "").trim();
    const fs = Number(ts.fontSize);
    const fontSizePx = Number.isFinite(fs) && fs > 0 ? Math.min(288, Math.max(8, fs)) : 16;
    const pad = String(ts.padding || "").trim();
    const lhRaw = Number(ts.lineHeightPct);
    const lineHeightPct = Number.isFinite(lhRaw) ? Math.min(250, Math.max(50, lhRaw)) : 100;
    if (ff) {
      wrap.style.fontFamily = ff;
    }
    wrap.style.fontSize = `${fontSizePx}px`;
    wrap.style.lineHeight = `${lineHeightPct}%`;
    if (pad) {
      wrap.style.padding = pad;
    }
    const p = document.createElement("p");
    p.className = "site-frame__cell-text-body";
    if (ff) {
      p.style.fontFamily = ff;
    }
    const bodyBlocks = resolveBodyBlocks(ts, body);
    if (bodyBlocks.length) {
      renderBodyBlocksIntoParagraph(p, bodyBlocks);
    } else {
      p.textContent = String(body || "");
    }
    wrap.appendChild(p);
    applyTextLinkStyleToWrap(wrap, ts.linkStyle);
    mountEl.appendChild(wrap);
    try {
      mountEl.dataset.frameTextStyle = encodeURIComponent(
        JSON.stringify({
          fontFamily: ff,
          fontSize: fontSizePx,
          lineHeightPct,
          padding: pad,
          navUrl: "",
          navLabel: "",
          bodyBlocks,
          linkStyle: normalizeTextLinkStyle(ts.linkStyle),
        }),
      );
    } catch (_e) {
      delete mountEl.dataset.frameTextStyle;
    }
  } else {
    mountEl.innerHTML = "";
    mountEl.setAttribute("aria-hidden", "true");
    mountEl.dataset.frameContentType = "empty";
  }
}

function dispatchFrameSettings() {
  try {
    window.dispatchEvent(new CustomEvent(STAGING_FRAME_SETTINGS_EVENT));
  } catch (_e) {
    /* ignore */
  }
}

/**
 * @param {{ pageName: string, rootSelector: string }} options
 */
export async function mountSiteFramePage(options) {
  const pageName =
    options && typeof options.pageName === "string" ? options.pageName.trim() : "";
  const rootSel = options && typeof options.rootSelector === "string" ? options.rootSelector.trim() : "";
  if (!pageName || !rootSel) {
    return;
  }
  const root = document.querySelector(rootSel);
  if (!root) {
    return;
  }

  const api = resolveFrameApiBase();

  /** @type {object | null} */
  let initialFrame = null;

  async function loadAndApply() {
    /** @type {{ page?: object, frame?: object, cells?: object[] } | null} */
    let data = null;
    if (api) {
      try {
        const res = await fetch(`${api}/api/frame?page=${encodeURIComponent(pageName)}`, {
          mode: "cors",
        });
        if (res.ok) {
          data = await res.json();
        }
      } catch (_e) {
        data = null;
      }
    }
    if (!data) {
      data = await fetchBakedFrame(pageName);
    }
    if (!data) {
      initialFrame = null;
      return;
    }
    const frame = data.frame;
    initialFrame = frame && typeof frame === "object" ? frame : null;
    const cells = Array.isArray(data.cells) ? data.cells : [];
    if (frame && typeof frame.id === "number") {
      root.dataset.siteFrameId = String(frame.id);
    } else {
      delete root.dataset.siteFrameId;
    }
    applyFrameRootLayout(/** @type {HTMLElement} */ (root), frame);
    const byIdx = new Map();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c && typeof c.cellIndex === "number") {
        byIdx.set(c.cellIndex, c);
      }
    }
    root.querySelectorAll("[data-frame-cell-index]").forEach((mount) => {
      const idx = parseInt(mount.getAttribute("data-frame-cell-index") || "", 10);
      if (!Number.isFinite(idx)) {
        return;
      }
      const cell = byIdx.get(idx);
      if (cell) {
        applyCellToMount(/** @type {HTMLElement} */ (mount), cell);
      }
    });
    dispatchFrameSettings();
  }

  await loadAndApply();

  if (!isHtmlStaging() || !api) {
    return;
  }

  mountFrameStagingTestingGui({
    pageName,
    root: /** @type {HTMLElement} */ (root),
    api,
    applyCellToMount,
    dispatchFrameSettings,
    applyFrameRootLayout: (frame) => applyFrameRootLayout(/** @type {HTMLElement} */ (root), frame),
    initialFrame,
    requestRegistryRefresh: () => {
      try {
        window.dispatchEvent(new CustomEvent("customdev-request-registry-refresh"));
      } catch (_e) {
        /* ignore */
      }
    },
  });
}
