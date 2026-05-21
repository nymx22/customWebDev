/**
 * Frame cells with content_type `stack`: multiple text / image / shape layers in one mount.
 */

import { resolveAssetImageSrc } from "./frame-asset-images.js";
import { applyImageGridDimensions } from "./frame-cell-image.js";
import { clampFrameCellScalePct } from "./frame-cell-scale.js";
import { applyCellPaddingStyles } from "./frame-cell-padding.js";
import { renderBodyBlocksIntoParagraph, resolveBodyBlocks, sanitizeNavUrl } from "./frame-text-blocks.js";
import { applyTextLinkStyleToWrap, normalizeTextLinkStyle } from "./frame-text-link-style.js";
import {
  createShapeSvgElement,
  normalizeShapeStyle,
  SHAPE_ALIGN_TO_FLEX,
} from "./frame-cell-shape.js";

const LAYER_TYPES = new Set(["text", "image", "shape"]);
const MAX_LAYERS = 24;

/** @param {unknown} layer */
export function normalizeStackLayer(layer) {
  if (!layer || typeof layer !== "object") {
    return null;
  }
  const o = /** @type {Record<string, unknown>} */ (layer);
  const t = String(o.type || o.contentType || "")
    .trim()
    .toLowerCase();
  if (!LAYER_TYPES.has(t)) {
    return null;
  }
  /** @type {Record<string, unknown>} */
  const out = { type: t, body: o.body != null ? String(o.body) : "" };
  if (t === "text" && o.textStyle && typeof o.textStyle === "object") {
    out.textStyle = o.textStyle;
  }
  if (t === "image" && o.imageStyle && typeof o.imageStyle === "object") {
    out.imageStyle = o.imageStyle;
  }
  if (t === "shape" && o.shapeStyle && typeof o.shapeStyle === "object") {
    out.shapeStyle = normalizeShapeStyle(o.shapeStyle);
  }
  return out;
}

/** @param {unknown} raw */
export function parseStackLayersFromBody(raw) {
  if (raw == null || raw === "") {
    return [];
  }
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      return [];
    }
  }
  let list = [];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(/** @type {object} */ (parsed).layers)) {
    list = /** @type {object} */ (parsed).layers;
  }
  /** @type {object[]} */
  const out = [];
  for (let i = 0; i < list.length && out.length < MAX_LAYERS; i++) {
    const norm = normalizeStackLayer(list[i]);
    if (norm) {
      out.push(norm);
    }
  }
  return out;
}

/** @param {{ body?: string, layers?: unknown[] } | null | undefined} cell */
export function parseStackLayersFromCell(cell) {
  if (!cell) {
    return [];
  }
  if (Array.isArray(cell.layers)) {
    return parseStackLayersFromBody({ layers: cell.layers });
  }
  return parseStackLayersFromBody(cell.body);
}

/** @param {object[]} layers */
export function serializeStackLayersBody(layers) {
  const clean = [];
  for (let i = 0; i < layers.length && clean.length < MAX_LAYERS; i++) {
    const norm = normalizeStackLayer(layers[i]);
    if (norm) {
      clean.push(norm);
    }
  }
  return JSON.stringify({ layers: clean });
}

/** @param {string} type */
export function createDefaultStackLayer(type) {
  const t = LAYER_TYPES.has(type) ? type : "text";
  if (t === "image") {
    return {
      type: "image",
      body: "",
      imageStyle: {
        objectFit: "contain",
        objectAlign: "center",
        maxWidth: "",
        scalePct: 100,
        linkHref: "",
      },
    };
  }
  if (t === "shape") {
    return { type: "shape", body: "", shapeStyle: normalizeShapeStyle({}) };
  }
  return {
    type: "text",
    body: "",
    textStyle: {
      fontFamily: "",
      fontSize: 16,
      lineHeightPct: 100,
      padding: "",
      navUrl: "",
      navLabel: "",
      bodyBlocks: [{ type: "text", value: "" }],
      linkStyle: {},
    },
  };
}

/** @param {object} layer */
export function stackLayerToCell(layer) {
  const norm = normalizeStackLayer(layer);
  if (!norm) {
    return { contentType: "empty", body: "" };
  }
  return {
    contentType: norm.type,
    body: norm.body != null ? String(norm.body) : "",
    textStyle: norm.textStyle || null,
    imageStyle: norm.imageStyle || null,
    shapeStyle: norm.shapeStyle || null,
  };
}

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

/**
 * Render one layer into `container` (text / image / shape only).
 * @param {HTMLElement} container
 * @param {object} layer
 */
export function renderFrameLayerInto(container, layer) {
  container.textContent = "";
  const cell = stackLayerToCell(layer);
  const t = (cell.contentType || "empty").toLowerCase();
  const body = cell.body || "";

  if (t === "image" && String(body).trim()) {
    const is = cell.imageStyle || {};
    const fitRaw = String(is.objectFit || "contain").toLowerCase();
    const fitAllowed = new Set(["contain", "cover", "fill", "scale-down", "none"]);
    const fit = fitAllowed.has(fitRaw) ? fitRaw : "contain";
    const alignRaw = String(is.objectAlign || "center").toLowerCase().replace(/\s+/g, "-");
    const alignKey = alignRaw in alignToPosition ? alignRaw : "center";
    const pos = alignToPosition[alignKey];
    const flexAlign = alignToFlex[alignKey] || alignToFlex.center;
    const mw = String(is.maxWidth || "").trim();
    const scalePct = clampFrameCellScalePct(is.scalePct, 100);
    const wrap = document.createElement("div");
    wrap.className = "site-frame__cell-image-wrap";
    wrap.style.alignItems = flexAlign[0];
    wrap.style.justifyContent = flexAlign[1];
    wrap.style.width = "100%";
    wrap.style.height = "100%";
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
    applyImageGridDimensions(img, { scalePct, maxWidth: mw }, container, false);
    const linkHref = sanitizeNavUrl(String(is.linkHref || ""));
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
    container.appendChild(wrap);
    return;
  }

  if (t === "shape") {
    const ss = normalizeShapeStyle(cell.shapeStyle || {});
    const alignKey = ss.objectAlign in SHAPE_ALIGN_TO_FLEX ? ss.objectAlign : "center";
    const flexAlign = SHAPE_ALIGN_TO_FLEX[alignKey] || SHAPE_ALIGN_TO_FLEX.center;
    const wrap = document.createElement("div");
    wrap.className = "site-frame__cell-shape-wrap";
    wrap.style.alignItems = flexAlign[0];
    wrap.style.justifyContent = flexAlign[1];
    wrap.style.width = "100%";
    wrap.style.height = "100%";
    const svg = createShapeSvgElement(ss, container);
    const linkHref = sanitizeNavUrl(ss.linkHref);
    if (linkHref) {
      const a = document.createElement("a");
      a.href = linkHref;
      a.className = "site-frame__cell-image-link";
      if (/^https?:/i.test(linkHref)) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.appendChild(svg);
      wrap.appendChild(a);
    } else {
      wrap.appendChild(svg);
    }
    container.appendChild(wrap);
    return;
  }

  if (t === "text") {
    const ts = cell.textStyle || {};
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
    container.appendChild(wrap);
  }
}

/**
 * @param {HTMLElement} mountEl
 * @param {{ body?: string, layers?: unknown[], cellPadding?: unknown }} cell
 */
export function applyStackLayersToMount(mountEl, cell) {
  const layers = parseStackLayersFromCell(cell);
  mountEl.classList.add("site-frame__cell-mount--stack");
  const stack = document.createElement("div");
  stack.className = "site-frame__cell-stack";
  for (let i = 0; i < layers.length; i++) {
    const layerEl = document.createElement("div");
    layerEl.className = "site-frame__cell-layer";
    layerEl.dataset.layerIndex = String(i);
    const inner = document.createElement("div");
    inner.className = "site-frame__cell-layer-inner";
    renderFrameLayerInto(inner, layers[i]);
    layerEl.appendChild(inner);
    stack.appendChild(layerEl);
  }
  mountEl.appendChild(stack);
  try {
    mountEl.dataset.frameLayers = encodeURIComponent(JSON.stringify({ layers }));
  } catch (_e) {
    delete mountEl.dataset.frameLayers;
  }
}
