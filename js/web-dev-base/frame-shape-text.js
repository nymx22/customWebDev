/**
 * Text rendered inside a frame shape (shape layer owns body + textStyle).
 */

import {
  createShapeSvgElement,
  normalizeShapeStyle,
  resolveFixedPxShapeDimensions,
  sanitizeShapeColor,
  SHAPE_ALIGN_TO_FLEX,
} from "./frame-cell-shape.js";
import {
  bodyBlocksUseNamecardLayout,
  renderBodyBlocksIntoParagraph,
  resolveBodyBlocks,
  sanitizeNavUrl,
} from "./frame-text-blocks.js";
import { applyTextLinkStyleToWrap } from "./frame-text-link-style.js";

/** @param {string} objectAlign */
export function shapeObjectAlignToTransformOrigin(objectAlign) {
  const a = String(objectAlign || "center").toLowerCase();
  const map = {
    center: "50% 50%",
    top: "50% 0%",
    bottom: "50% 100%",
    left: "0% 50%",
    right: "100% 50%",
    "top-left": "0% 0%",
    "top-right": "100% 0%",
    "bottom-left": "0% 100%",
    "bottom-right": "100% 100%",
  };
  return map[a] || "50% 50%";
}

/**
 * Dark text on light fills; avoids white page copy on a white card.
 * @param {Record<string, unknown>} shapeStyle
 * @param {Record<string, unknown>} [textStyle]
 * @returns {string}
 */
export function resolveShapeTextColor(shapeStyle, textStyle) {
  const ss = normalizeShapeStyle(shapeStyle);
  const ts = textStyle && typeof textStyle === "object" ? textStyle : {};
  const explicit = sanitizeShapeColor(ts.color) || ss.textColor;
  if (explicit) {
    return explicit;
  }
  if (!ss.fillEnabled) {
    return "";
  }
  const fill = String(ss.fillColor || "").trim().toLowerCase();
  if (
    fill === "#fff" ||
    fill === "#ffffff" ||
    fill.startsWith("rgb(255") ||
    fill.startsWith("rgba(255")
  ) {
    return "#111111";
  }
  return "";
}

/** @param {string} objectAlign */
export function shapeObjectAlignToTextAlign(objectAlign) {
  const a = String(objectAlign || "center").toLowerCase();
  if (a === "left" || a === "top-left" || a === "bottom-left") {
    return "left";
  }
  if (a === "right" || a === "top-right" || a === "bottom-right") {
    return "right";
  }
  return "center";
}

/**
 * @param {string | undefined} body
 * @param {Record<string, unknown> | null | undefined} textStyle
 */
export function hasShapeTextContent(body, textStyle) {
  if (String(body || "").trim()) {
    return true;
  }
  const blocks = resolveBodyBlocks(textStyle || {}, body || "");
  for (let i = 0; i < blocks.length; i++) {
    if (String(blocks[i].value || "").trim()) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} body
 * @param {Record<string, unknown>} textStyle
 * @param {Record<string, unknown>} [shapeStyle]
 * @returns {HTMLElement}
 */
export function buildShapeTextWrap(body, textStyle, shapeStyle) {
  const ts = textStyle || {};
  const wrap = document.createElement("div");
  wrap.className = "site-frame__cell-text site-frame__cell-text--in-shape";
  const textColor = resolveShapeTextColor(shapeStyle || {}, ts);
  if (textColor) {
    wrap.style.color = textColor;
  }
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
  if (bodyBlocksUseNamecardLayout(bodyBlocks)) {
    wrap.classList.add("site-frame__cell-text--namecard");
    p.classList.add("site-frame__cell-text-body--namecard");
  }
  if (bodyBlocks.length) {
    renderBodyBlocksIntoParagraph(p, bodyBlocks);
  } else {
    p.textContent = String(body || "");
  }
  wrap.appendChild(p);
  applyTextLinkStyleToWrap(wrap, ts.linkStyle);
  return wrap;
}

/** @type {WeakMap<HTMLElement, ResizeObserver>} */
const shapeCardTextObservers = new WeakMap();

/**
 * @param {HTMLElement} card
 */
function disconnectShapeCardTextObserver(card) {
  const ro = shapeCardTextObservers.get(card);
  if (ro) {
    ro.disconnect();
    shapeCardTextObservers.delete(card);
  }
}

/**
 * Shrink in-shape text when fixed_px shapes are scaled down.
 * @param {HTMLElement} card
 * @param {SVGElement} svg
 * @param {ReturnType<typeof normalizeShapeStyle>} ss
 * @param {HTMLElement} textScaleEl element that should be scaled
 */
function syncFixedPxTextScale(card, svg, ss, textScaleEl) {
  disconnectShapeCardTextObserver(card);
  if (ss.sizeMode !== "fixed_px") {
    textScaleEl.style.transform = "";
    textScaleEl.style.transformOrigin = "";
    return;
  }

  const apply = () => {
    if (!card.isConnected) {
      disconnectShapeCardTextObserver(card);
      return;
    }
    const rect = svg.getBoundingClientRect();
    const mw = rect.width;
    const mh = rect.height;
    if (mw < 1 || mh < 1) {
      return;
    }
    const dim = resolveFixedPxShapeDimensions(ss.widthPx, ss.heightPx, mw, mh);
    const scale = ss.widthPx > 0 ? Math.min(1, dim.width / ss.widthPx, dim.height / ss.heightPx) : 1;
    textScaleEl.style.transformOrigin = shapeObjectAlignToTransformOrigin(ss.objectAlign);
    textScaleEl.style.transform = scale < 0.999 ? `scale(${scale})` : "";
  };

  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(svg);
  shapeCardTextObservers.set(card, ro);
};

/**
 * @param {{
 *   shapeStyle?: Record<string, unknown>,
 *   body?: string,
 *   textStyle?: Record<string, unknown> | null,
 * }} layer
 * @param {Element | null | undefined} contextEl
 * @param {{ relativeToFrame?: boolean }} [options]
 * @returns {HTMLElement}
 */
export function createShapeCardElement(layer, contextEl, options = {}) {
  const ss = normalizeShapeStyle(layer.shapeStyle || {});
  const body = layer.body != null ? String(layer.body) : "";
  const textStyle = layer.textStyle && typeof layer.textStyle === "object" ? layer.textStyle : null;
  const hasText = hasShapeTextContent(body, textStyle);
  const relativeToFrame = options.relativeToFrame === true;

  const card = document.createElement("div");
  card.className = "site-frame__cell-shape-card";
  const svg = createShapeSvgElement(ss, contextEl, { relativeToFrame });
  const linkHref = sanitizeNavUrl(ss.linkHref);

  if (!hasText) {
    if (linkHref) {
      const a = document.createElement("a");
      a.href = linkHref;
      a.className = "site-frame__cell-image-link";
      if (/^https?:/i.test(linkHref)) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.appendChild(svg);
      card.appendChild(a);
    } else {
      card.appendChild(svg);
    }
    return card;
  }

  card.classList.add("site-frame__cell-shape-card--has-text");
  if (linkHref) {
    const a = document.createElement("a");
    a.href = linkHref;
    a.className = "site-frame__cell-image-link";
    if (/^https?:/i.test(linkHref)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.appendChild(svg);
    card.appendChild(a);
  } else {
    card.appendChild(svg);
  }

  const alignKey = ss.objectAlign in SHAPE_ALIGN_TO_FLEX ? ss.objectAlign : "center";
  const flexAlign = SHAPE_ALIGN_TO_FLEX[alignKey] || SHAPE_ALIGN_TO_FLEX.center;
  const overlay = document.createElement("div");
  overlay.className = "site-frame__cell-shape-text";
  overlay.style.zIndex = "1";
  overlay.style.display = "flex";
  overlay.style.alignItems = flexAlign[0];
  overlay.style.justifyContent = flexAlign[1];
  const textPad = String(ss.textPadding || "").trim();
  const textScaleEl = document.createElement("div");
  textScaleEl.className = "site-frame__cell-shape-text-scale";
  if (bodyBlocksUseNamecardLayout(resolveBodyBlocks(textStyle || {}, body))) {
    textScaleEl.classList.add("site-frame__cell-shape-text-scale--namecard");
  }
  if (textPad) {
    textScaleEl.style.padding = textPad;
    textScaleEl.style.boxSizing = "border-box";
  }
  const textWrap = buildShapeTextWrap(body, textStyle || {}, ss);
  const p = textWrap.querySelector(".site-frame__cell-text-body");
  if (p instanceof HTMLElement) {
    p.style.textAlign = shapeObjectAlignToTextAlign(alignKey);
  }
  textScaleEl.appendChild(textWrap);
  overlay.appendChild(textScaleEl);
  card.appendChild(overlay);
  syncFixedPxTextScale(card, svg, ss, textScaleEl);
  return card;
}
