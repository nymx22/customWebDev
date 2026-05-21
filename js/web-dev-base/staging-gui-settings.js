/**
 * Staging-only UI builders shared across site features (frame grid editor, etc.).
 * Heavy gallery testing chrome stays in `gallery-core.js`; small reusable pieces live here.
 */

import { normalizeStoredAssetImagePath } from "./frame-asset-images.js";
import { cellDraftToPatchPayload, cellPaddingDirtyKey } from "./frame-cell-padding.js";
import { placementFromStyle } from "./frame-cell-placement.js";
import { clampFrameCellScalePct } from "./frame-cell-scale.js";
import { blocksToPlainBody, normalizeBodyBlocks, resolveBodyBlocks } from "./frame-text-blocks.js";
import { normalizeStackLayer } from "./frame-cell-layers.js";
import { normalizeShapeStyle } from "./frame-cell-shape.js";
import { normalizeTextLinkStyle } from "./frame-text-link-style.js";
import { createFrameCellStagingUi } from "./frame-staging-panel-ui.js";
import {
  fillGridGapPctInputs,
  gridGapForApi,
  parseGridGap,
  readGridGapPctFromInputs,
} from "./frame-grid-gap.js";
import {
  clearFramePageSession,
  flushAllFramePageSessionsToApi,
  persistFramePageSession,
} from "./frame-layout-persist.js";
import { flushGalleriesForPage, reloadGalleriesForPage } from "./gallery-core/gallery-core.js";
import { fetchBakedFrame } from "./layout-baked.js";
import {
  clampStagingPanelElement,
  setStagingPanelPosition,
} from "./staging-floating-panel.js";

/** `window` event after frame cells change in staging (no detail). */
export const STAGING_FRAME_SETTINGS_EVENT = "customdev-site-frame-settings";

/** @type {Set<{ savePageLayout: () => Promise<unknown> }>} */
const framePublishHandlers = new Set();

/** Save every mounted frame page layout to SQLite (used by **Publish** in `lib/staging/staging.js`). */
export async function flushAllFramesForPublish() {
  const list = [...framePublishHandlers];
  let skipPage = "";
  let api = "";
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (h.pageName) {
      skipPage = h.pageName;
    }
    if (h.api) {
      api = h.api;
    }
    await h.savePageLayout();
  }
  if (api) {
    await flushAllFramePageSessionsToApi(api, { skipPage });
  }
}

/** @type {string | null} */
let cachedAssetFontsApiBase = null;
/** @type {Promise<{ fonts: Array<{ file: string, cssFamily: string, label: string }> }> | null} */
let cachedAssetFontsPromise = null;

/**
 * @param {string} apiBase
 * @returns {Promise<{ fonts: Array<{ file: string, cssFamily: string, label: string }> }>}
 */
function loadLocalAssetFonts(apiBase) {
  const base = String(apiBase || "").trim();
  if (!base) {
    return Promise.resolve({ fonts: [] });
  }
  if (cachedAssetFontsPromise && cachedAssetFontsApiBase === base) {
    return cachedAssetFontsPromise;
  }
  cachedAssetFontsApiBase = base;
  cachedAssetFontsPromise = fetch(`${base}/api/fonts`, { mode: "cors" })
    .then((r) => (r.ok ? r.json() : { fonts: [] }))
    .catch(() => ({ fonts: [] }));
  return cachedAssetFontsPromise;
}

/** @type {string | null} */
let cachedAssetImagesApiBase = null;
/** @type {Promise<{ images: Array<{ path: string, label: string }> }> | null} */
let cachedAssetImagesPromise = null;

/**
 * @param {string} apiBase
 * @param {boolean} [forceRefresh]
 * @returns {Promise<{ images: Array<{ path: string, label: string }> }>}
 */
function loadLocalAssetImages(apiBase, forceRefresh = false) {
  const base = String(apiBase || "").trim();
  if (!base) {
    return Promise.resolve({ images: [] });
  }
  if (forceRefresh) {
    cachedAssetImagesPromise = null;
    cachedAssetImagesApiBase = null;
  }
  if (cachedAssetImagesPromise && cachedAssetImagesApiBase === base) {
    return cachedAssetImagesPromise;
  }
  cachedAssetImagesApiBase = base;
  cachedAssetImagesPromise = fetch(`${base}/api/asset-images`, { mode: "cors" })
    .then((r) => (r.ok ? r.json() : { images: [] }))
    .catch(() => ({ images: [] }));
  return cachedAssetImagesPromise;
}

const FONT_FAMILY_CUSTOM = "__custom__";

const FONT_FAMILY_PRESETS = [
  { value: "", label: "Default (inherit)" },
  { value: "system-ui, sans-serif", label: "System UI" },
  { value: "ui-sans-serif, system-ui, sans-serif", label: "UI Sans" },
  { value: "Georgia, \"Times New Roman\", serif", label: "Georgia" },
  { value: "\"Times New Roman\", Times, serif", label: "Times New Roman" },
  { value: "ui-monospace, SFMono-Regular, monospace", label: "Monospace" },
];

/**
 * @param {HTMLSelectElement} sel
 * @param {Array<{ file: string, cssFamily: string, label: string }>} assetFonts
 * @param {boolean} includeCustomOption
 */
function fillFontFamilySelect(sel, assetFonts, includeCustomOption) {
  sel.innerHTML = "";
  const gPre = document.createElement("optgroup");
  gPre.label = "Presets";
  FONT_FAMILY_PRESETS.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.value;
    o.textContent = p.label;
    gPre.appendChild(o);
  });
  sel.appendChild(gPre);
  if (assetFonts.length) {
    const gLoc = document.createElement("optgroup");
    gLoc.label = "Local (assets/fonts)";
    assetFonts.forEach((f) => {
      const o = document.createElement("option");
      o.value = f.cssFamily;
      o.textContent = f.label;
      gLoc.appendChild(o);
    });
    sel.appendChild(gLoc);
  }
  if (includeCustomOption) {
    const o = document.createElement("option");
    o.value = FONT_FAMILY_CUSTOM;
    o.textContent = "Custom…";
    sel.appendChild(o);
  }
}

/**
 * @param {HTMLSelectElement} sel
 * @param {HTMLInputElement} customIn
 */
function resolveFontFamilyFromSelect(sel, customIn) {
  if (sel.value === FONT_FAMILY_CUSTOM) {
    return String(customIn.value || "").trim();
  }
  return String(sel.value || "").trim();
}

/**
 * @param {HTMLSelectElement} sel
 * @param {HTMLInputElement} customIn
 * @param {string} familyValue
 * @param {Array<{ cssFamily: string }>} assetFonts
 */
function syncFontFamilySelectToValue(sel, customIn, familyValue, assetFonts) {
  const v = String(familyValue || "").trim();
  const presetVals = new Set(FONT_FAMILY_PRESETS.map((p) => p.value));
  const assetVals = new Set(assetFonts.map((f) => f.cssFamily));
  if (presetVals.has(v) || assetVals.has(v)) {
    sel.value = v;
    customIn.hidden = true;
    customIn.value = "";
    return;
  }
  sel.value = FONT_FAMILY_CUSTOM;
  customIn.hidden = false;
  customIn.value = v;
}

function stagingSafeIdPart(name) {
  const s = String(name || "").replace(/[^a-zA-Z0-9_-]+/g, "-");
  return s.replace(/^-+|-+$/g, "") || "page";
}

function frameChipTitle(pageName, frameLabel) {
  const chip = frameLabel && String(frameLabel).trim() ? String(frameLabel).trim() : "frame";
  return `${pageName} / ${chip}`;
}

function normalizeFontFamilyForCompare(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** @param {object} cell @param {object} frame */
function cellUsesLayoutTypo(cell, frame) {
  if (!cell || (cell.contentType || "").toLowerCase() !== "text") {
    return false;
  }
  const ts = cell.textStyle || {};
  const cellFam = normalizeFontFamilyForCompare(ts.fontFamily);
  const frameFam = normalizeFontFamilyForCompare(frame.defaultTextFontFamily);
  const cellSize = Math.min(288, Math.max(8, Number(ts.fontSize) || 16));
  const frameSize = Math.min(288, Math.max(8, Number(frame.defaultTextFontSize) || 16));
  return cellFam === frameFam && cellSize === frameSize;
}

/** @param {object | null | undefined} cell */
function normalizeCellForDirty(cell) {
  if (!cell || typeof cell !== "object") {
    return null;
  }
  const ct = String(cell.contentType || "empty")
    .trim()
    .toLowerCase();
  /** @type {Record<string, unknown>} */
  const out = {
    contentType: ct === "table" ? "html" : ct,
    body: String(cell.body || ""),
    cellRole: String(cell.cellRole || "").trim(),
    cellPadding: cellPaddingDirtyKey(cell.cellPadding),
  };
  if (out.contentType === "text") {
    const ts = cell.textStyle || {};
    const blocks = normalizeBodyBlocks(resolveBodyBlocks(ts, out.body));
    out.body = blocksToPlainBody(blocks);
    out.textStyle = {
      fontFamily: String(ts.fontFamily || "").trim(),
      fontSize: Math.min(288, Math.max(8, Number(ts.fontSize) || 16)),
      lineHeightPct: Math.min(250, Math.max(50, Number(ts.lineHeightPct) || 100)),
      padding: String(ts.padding || "").trim(),
      navUrl: "",
      navLabel: "",
      bodyBlocks: blocks,
      linkStyle: normalizeTextLinkStyle(ts.linkStyle),
    };
  }
  if (out.contentType === "image") {
    out.body = normalizeStoredAssetImagePath(out.body);
    const is = cell.imageStyle || {};
    const placement = placementFromStyle(is);
    out.imageStyle = {
      objectFit: String(is.objectFit || "contain"),
      objectAlign: String(is.objectAlign || "center"),
      maxWidth: String(is.maxWidth || "").trim(),
      scalePct: clampFrameCellScalePct(is.scalePct, 100),
      linkHref: String(is.linkHref || "").trim(),
      placementLeftPct: placement ? placement.placementLeftPct : null,
      placementTopPct: placement ? placement.placementTopPct : null,
    };
  }
  if (out.contentType === "shape") {
    out.body = "";
    out.shapeStyle = normalizeShapeStyle(cell.shapeStyle);
  }
  if (out.contentType === "stack" && Array.isArray(cell.layers)) {
    out.body = String(cell.body || "");
    out.layers = cell.layers
      .map((layer) => {
        const n = normalizeStackLayer(layer);
        return n ? JSON.parse(JSON.stringify(n)) : null;
      })
      .filter(Boolean);
  }
  return out;
}

/** @param {object} cell */
function cloneCellDraft(cell) {
  return JSON.parse(JSON.stringify(cell));
}

function frameCellSummarySnippet(contentType, taValue) {
  const ty = (contentType || "empty").toLowerCase();
  const raw = String(taValue || "");
  if (ty === "empty") {
    return "empty";
  }
  if (ty === "image") {
    const s = raw.trim().replace(/\s+/g, " ");
    return s.length <= 80 ? s || "(no URL)" : s.slice(0, 79) + "…";
  }
  if (ty === "shape") {
    return "shape";
  }
  if (ty === "html") {
    const s = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return s.length <= 72 ? s || "(no HTML)" : s.slice(0, 71) + "…";
  }
  if (ty === "text") {
    const s = raw.replace(/\s+/g, " ").trim();
    return s.length <= 72 ? s || "(no text)" : s.slice(0, 71) + "…";
  }
  if (ty === "stack") {
    return "stack layers";
  }
  return raw.slice(0, 72);
}

/**
 * @param {{
 *   pageName: string,
 *   root: HTMLElement,
 *   api: string,
 *   applyCellToMount: (mount: HTMLElement, cell: object) => void,
 *   dispatchFrameSettings: () => void,
 *   applyFrameRootLayout: (frame: object | null) => void,
 *     Bound wrapper: pass layout object only (not the frame root element).
 *   initialFrame?: object | null,
 *   requestRegistryRefresh?: () => void,
 * }} opts
 * @returns {{ teardown: () => void } | null}
 */
export function mountFrameStagingTestingGui(opts) {
  const pageName =
    opts && typeof opts.pageName === "string" ? opts.pageName.trim() : "";
  const root = opts && opts.root;
  const api = opts && typeof opts.api === "string" ? opts.api.trim().replace(/\/$/, "") : "";
  const applyCellToMount = opts && typeof opts.applyCellToMount === "function" ? opts.applyCellToMount : null;
  const dispatchFrameSettings =
    opts && typeof opts.dispatchFrameSettings === "function" ? opts.dispatchFrameSettings : () => {};
  const applyFrameRootLayout =
    opts && typeof opts.applyFrameRootLayout === "function" ? opts.applyFrameRootLayout : () => {};
  const initialFrame = opts && opts.initialFrame != null ? opts.initialFrame : null;
  const requestRegistryRefresh =
    opts && typeof opts.requestRegistryRefresh === "function" ? opts.requestRegistryRefresh : null;
  if (!pageName || !root || !api || !applyCellToMount) {
    return null;
  }
  /** @type {{ fontSize: number, fontFamily: string } | null} */
  let pageFontDefaultsCache = null;
  function loadPageFontDefaults() {
    if (pageFontDefaultsCache) {
      return Promise.resolve(pageFontDefaultsCache);
    }
    return fetch(`${api}/api/layout?page=${encodeURIComponent(pageName)}&galleryKey=default`, { mode: "cors" })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        const f = d && d.font;
        pageFontDefaultsCache = {
          fontSize: f && typeof f.fontSize === "number" ? f.fontSize : 16,
          fontFamily: f && typeof f.fontFamily === "string" ? f.fontFamily : "system-ui, sans-serif",
        };
        return pageFontDefaultsCache;
      })
      .catch(() => {
        pageFontDefaultsCache = { fontSize: 16, fontFamily: "system-ui, sans-serif" };
        return pageFontDefaultsCache;
      });
  }
  let lastAssetFontsList = [];
  let lastAssetImagesList = [];
  /** Last saved frame fields (from API / Save); used when syncing published layout from SQLite. */
  let lastSavedFrameSnapshot = null;
  /** Live cols/rows/gap while the panel is open; not reset when font lists reload (avoids snapping back to DB 4×2 on Save). */
  let panelLayoutDraft = null;
  let suppressFrameFontSelChange = false;
  /** @type {Map<string, { save: () => Promise<{ cell?: object }> }>} */
  const cellSaveHandlers = new Map();
  /** @type {Map<string, object>} */
  const cellDrafts = new Map();
  /** Cell indices whose text typography tracks frame layout defaults (live). */
  const layoutTypoBound = new Set();
  /** @type {{ frame: object, cells: Map<string, object> } | null} */
  let publishedBaseline = null;
  let panelCloseInFlight = false;

  const idPart = stagingSafeIdPart(pageName);
  function framePanelPosStorageKey() {
    return `customdev_staging_frame_panel_pos_${idPart}`;
  }
  const labelId = `staging-frame-label-${idPart}`;
  if (document.getElementById(labelId) || root.dataset.siteFrameStagingGui === "1") {
    return null;
  }
  root.dataset.siteFrameStagingGui = "1";
  root.classList.add("site-frame--staging");

  let stagingTitle = frameChipTitle(pageName, "");
  const panelId = `staging-frame-panel-${idPart}`;

  const labelRow = document.createElement("div");
  labelRow.className = "site-frame__staging-label-row";
  const labelBtn = document.createElement("button");
  labelBtn.type = "button";
  labelBtn.className = "site-frame__staging-frame-label";
  labelBtn.id = labelId;
  labelBtn.textContent = stagingTitle;
  labelBtn.setAttribute("aria-expanded", "false");
  labelBtn.setAttribute("aria-controls", panelId);
  labelBtn.setAttribute("aria-label", `Open or close frame editor for ${stagingTitle}`);
  labelBtn.setAttribute("title", `${stagingTitle} — SQLite frame / frame_cell`);
  labelRow.appendChild(labelBtn);
  root.insertBefore(labelRow, root.firstChild);

  const panel = document.createElement("div");
  panel.id = panelId;
  panel.className = "staging-frame-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", labelId);
  panel.setAttribute("aria-label", stagingTitle);

  const head = document.createElement("div");
  head.className = "staging-frame-panel__header";
  const title = document.createElement("span");
  title.className = "staging-frame-panel__title";
  title.textContent = stagingTitle;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "staging-frame-panel__close";
  closeBtn.setAttribute("aria-label", "Close frame panel");
  closeBtn.innerHTML = "&times;";
  head.appendChild(title);
  head.appendChild(closeBtn);

  const status = document.createElement("p");
  status.className = "staging-frame-panel__status";

  const bodyEl = document.createElement("div");
  bodyEl.className = "staging-frame-panel__body";

  const frameStrip = document.createElement("div");
  frameStrip.className = "staging-frame-panel__strip";

  const labelField = document.createElement("label");
  labelField.className = "staging-frame-panel__field-label";
  labelField.textContent = "Label (staging chip)";
  const frameLabelIn = document.createElement("input");
  frameLabelIn.type = "text";
  frameLabelIn.className = "staging-frame-panel__input";
  frameLabelIn.autocomplete = "off";
  frameLabelIn.placeholder = "e.g. home";
  labelField.appendChild(frameLabelIn);

  const gapLeg = document.createElement("div");
  gapLeg.className = "staging-frame-panel__field-label";
  gapLeg.textContent = "Grid gap (% of frame — up / right / down / left)";

  const gapPctGrid = document.createElement("div");
  gapPctGrid.className = "staging-frame-panel__gap-pct-grid";

  function makeGapPctField(caption, ariaLabel) {
    const col = document.createElement("div");
    col.className = "staging-frame-panel__figma-field";
    const cap = document.createElement("span");
    cap.className = "staging-frame-panel__figma-caption";
    cap.textContent = caption;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "staging-frame-panel__input staging-frame-panel__input--gap-pct";
    inp.min = "0";
    inp.max = "50";
    inp.step = "0.5";
    inp.placeholder = "0";
    inp.setAttribute("aria-label", ariaLabel);
    col.appendChild(cap);
    col.appendChild(inp);
    return { col, inp };
  }

  const gapUp = makeGapPctField("Up", "Grid gap top (percent of frame)");
  const gapRight = makeGapPctField("Right", "Grid gap right (percent of frame)");
  const gapDown = makeGapPctField("Down", "Grid gap bottom (percent of frame)");
  const gapLeft = makeGapPctField("Left", "Grid gap left (percent of frame)");
  const frameGapTopIn = gapUp.inp;
  const frameGapRightIn = gapRight.inp;
  const frameGapBottomIn = gapDown.inp;
  const frameGapLeftIn = gapLeft.inp;
  gapPctGrid.appendChild(gapUp.col);
  gapPctGrid.appendChild(gapRight.col);
  gapPctGrid.appendChild(gapDown.col);
  gapPctGrid.appendChild(gapLeft.col);

  const gapLegacyHint = document.createElement("p");
  gapLegacyHint.className = "staging-frame-panel__gap-legacy-hint";
  gapLegacyHint.hidden = true;
  gapLegacyHint.textContent =
    "Legacy CSS gap is stored for this frame. Enter % per side and Save to switch.";

  const frameTypLeg = document.createElement("div");
  frameTypLeg.className = "staging-frame-panel__cell-legend staging-frame-panel__cell-legend--layout-typography";
  frameTypLeg.textContent = "Layout · Typography";

  const frameTypGrid = document.createElement("div");
  frameTypGrid.className = "staging-frame-panel__figma-typography";

  const frameFfCol = document.createElement("div");
  frameFfCol.className = "staging-frame-panel__figma-field";
  const frameFfCap = document.createElement("span");
  frameFfCap.className = "staging-frame-panel__figma-caption";
  frameFfCap.textContent = "Font";
  const frameFontSel = document.createElement("select");
  frameFontSel.className = "staging-frame-panel__select staging-frame-panel__select--figma-font";
  frameFontSel.setAttribute("aria-label", "Default text font for frame");
  const frameFontCustomIn = document.createElement("input");
  frameFontCustomIn.type = "text";
  frameFontCustomIn.className = "staging-frame-panel__input staging-frame-panel__input--figma-custom-font";
  frameFontCustomIn.autocomplete = "off";
  frameFontCustomIn.placeholder = "e.g. Inter, sans-serif";
  frameFontCustomIn.hidden = true;
  frameFfCol.appendChild(frameFfCap);
  frameFfCol.appendChild(frameFontSel);
  frameFfCol.appendChild(frameFontCustomIn);

  const frameFsCol = document.createElement("div");
  frameFsCol.className = "staging-frame-panel__figma-field";
  const frameFsCap = document.createElement("span");
  frameFsCap.className = "staging-frame-panel__figma-caption";
  frameFsCap.textContent = "Size";
  const frameTextSizeIn = document.createElement("input");
  frameTextSizeIn.type = "number";
  frameTextSizeIn.className = "staging-frame-panel__input staging-frame-panel__input--figma-size";
  frameTextSizeIn.min = "8";
  frameTextSizeIn.max = "288";
  frameTextSizeIn.step = "1";
  frameTextSizeIn.value = "16";
  frameTextSizeIn.setAttribute("aria-label", "Default text font size (px)");
  frameFsCol.appendChild(frameFsCap);
  frameFsCol.appendChild(frameTextSizeIn);

  frameTypGrid.appendChild(frameFfCol);
  frameTypGrid.appendChild(frameFsCol);

  fillFontFamilySelect(frameFontSel, [], true);
  frameFontSel.addEventListener("change", () => {
    if (suppressFrameFontSelChange) {
      return;
    }
    frameFontCustomIn.hidden = frameFontSel.value !== FONT_FAMILY_CUSTOM;
    if (frameFontSel.value !== FONT_FAMILY_CUSTOM) {
      frameFontCustomIn.value = "";
    }
    scheduleFrameLivePreview();
  });

  const dimWrap = document.createElement("div");
  dimWrap.className = "staging-frame-panel__dim-row";
  const colLab = document.createElement("label");
  colLab.className = "staging-frame-panel__field-label staging-frame-panel__field-label--inline";
  colLab.textContent = "Cols";
  const frameColsIn = document.createElement("input");
  frameColsIn.type = "number";
  frameColsIn.min = "1";
  frameColsIn.max = "24";
  frameColsIn.className = "staging-frame-panel__input staging-frame-panel__input--num";
  colLab.appendChild(frameColsIn);

  const rowLab = document.createElement("label");
  rowLab.className = "staging-frame-panel__field-label staging-frame-panel__field-label--inline";
  rowLab.textContent = "Rows";
  const frameRowsIn = document.createElement("input");
  frameRowsIn.type = "number";
  frameRowsIn.min = "1";
  frameRowsIn.max = "24";
  frameRowsIn.className = "staging-frame-panel__input staging-frame-panel__input--num";
  rowLab.appendChild(frameRowsIn);
  dimWrap.appendChild(colLab);
  dimWrap.appendChild(rowLab);

  frameStrip.appendChild(dimWrap);
  frameStrip.appendChild(gapLeg);
  frameStrip.appendChild(gapPctGrid);
  frameStrip.appendChild(gapLegacyHint);
  frameStrip.appendChild(labelField);
  frameStrip.appendChild(frameTypLeg);
  frameStrip.appendChild(frameTypGrid);

  const cellPickSection = document.createElement("div");
  cellPickSection.className = "staging-frame-panel__cell-pick";
  const cellPickHeading = document.createElement("div");
  cellPickHeading.className = "staging-frame-panel__cell-legend";
  cellPickHeading.textContent = "Click a cell on the page, or pick below";
  cellPickSection.appendChild(cellPickHeading);

  const cellEditorHost = document.createElement("div");
  cellEditorHost.className = "staging-frame-panel__cell-editor-host";

  const cellListDetails = document.createElement("details");
  cellListDetails.className = "staging-frame-panel__cell-list-details";
  const cellListSum = document.createElement("summary");
  cellListSum.className = "staging-frame-panel__cell-list-summary";
  cellListSum.textContent = "All cells";
  const cellListInner = document.createElement("div");
  cellListInner.className = "staging-frame-panel__cell-list";
  cellListDetails.appendChild(cellListSum);
  cellListDetails.appendChild(cellListInner);

  const saveFooter = document.createElement("div");
  saveFooter.className = "staging-frame-panel__save-footer";
  const saveAllBtn = document.createElement("button");
  saveAllBtn.type = "button";
  saveAllBtn.className = "staging-frame-panel__save staging-frame-panel__save--all";
  saveAllBtn.textContent = "Save";
  saveFooter.appendChild(saveAllBtn);

  bodyEl.appendChild(frameStrip);
  bodyEl.appendChild(cellPickSection);
  bodyEl.appendChild(cellEditorHost);
  bodyEl.appendChild(cellListDetails);
  bodyEl.appendChild(saveFooter);

  function readPanelFrameState() {
    const cols = parseInt(String(frameColsIn.value), 10) || 1;
    const rows = parseInt(String(frameRowsIn.value), 10) || 1;
    return normalizeFrameSnapshot({
      label: frameLabelIn.value,
      gridGap: readGridGapFromPanel(),
      columnCount: cols,
      rowCount: rows,
      defaultTextFontFamily: resolveFontFamilyFromSelect(frameFontSel, frameFontCustomIn),
      defaultTextFontSize: Math.min(288, Math.max(8, parseInt(String(frameTextSizeIn.value), 10) || 16)),
    });
  }

  function isPanelDirty() {
    if (!publishedBaseline) {
      return false;
    }
    const frameNow = readPanelFrameState();
    if (JSON.stringify(frameNow) !== JSON.stringify(publishedBaseline.frame)) {
      return true;
    }
    const indices = new Set([...cellDrafts.keys(), ...publishedBaseline.cells.keys()]);
    for (const ix of indices) {
      const now = normalizeCellForDirty(cellDrafts.get(ix));
      const base = normalizeCellForDirty(publishedBaseline.cells.get(ix));
      if (JSON.stringify(now) !== JSON.stringify(base)) {
        return true;
      }
    }
    return false;
  }

  function updateChipDirtyState() {
    const lab = frameLabelIn.value;
    const baseTitle = frameChipTitle(pageName, lab);
    const dirty = isPanelDirty();
    stagingTitle = dirty ? `${baseTitle} • unsaved` : baseTitle;
    labelBtn.textContent = stagingTitle;
    labelBtn.setAttribute("aria-label", `Open or close frame editor for ${stagingTitle}`);
    labelBtn.setAttribute(
      "title",
      `${baseTitle} — SQLite frame / frame_cell${dirty ? " (unsaved changes)" : ""}`,
    );
    title.textContent = stagingTitle;
    panel.setAttribute("aria-label", stagingTitle);
    labelBtn.classList.toggle("site-frame__staging-frame-label--unsaved", dirty);
  }

  function buildFrameSessionSnapshot() {
    const fid = parseInt(root.dataset.siteFrameId || "", 10);
    if (!fid) {
      return null;
    }
    const layout = readPanelFrameState();
    return {
      frame: {
        id: fid,
        label: frameLabelIn.value,
        gridGap: layout.gridGap,
        columnCount: layout.columnCount,
        rowCount: layout.rowCount,
        defaultTextFontFamily: resolveFontFamilyFromSelect(frameFontSel, frameFontCustomIn),
        defaultTextFontSize: Math.min(
          288,
          Math.max(8, parseInt(String(frameTextSizeIn.value), 10) || 16),
        ),
      },
      cells: Array.from(cellDrafts.values()).filter((c) => c && typeof c.id === "number"),
    };
  }

  function persistFrameSessionDraft() {
    const snap = buildFrameSessionSnapshot();
    if (snap) {
      persistFramePageSession(pageName, snap);
    }
  }

  function applyAllCellDraftsToPage() {
    root.querySelectorAll("[data-frame-cell-index]").forEach((m) => {
      const ix = m.getAttribute("data-frame-cell-index");
      if (ix == null) {
        return;
      }
      const draft = cellDrafts.get(ix);
      if (draft) {
        applyCellToMount(/** @type {HTMLElement} */ (m), draft);
      }
    });
    persistFrameSessionDraft();
  }

  function commitPublishedCell(cell) {
    if (!publishedBaseline || !cell || typeof cell.cellIndex !== "number") {
      return;
    }
    publishedBaseline.cells.set(String(cell.cellIndex), cloneCellDraft(cell));
    updateChipDirtyState();
  }

  function syncCellDraftsFromApi(cells, fr) {
    cellDrafts.clear();
    layoutTypoBound.clear();
    const frameSnap = fr ? normalizeFrameSnapshot(fr) : readPanelFrameState();
    /** @type {Map<string, object>} */
    const baseCells = new Map();
    const list = Array.isArray(cells) ? cells : [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || typeof c.cellIndex !== "number") {
        continue;
      }
      const ix = String(c.cellIndex);
      const copy = cloneCellDraft(c);
      cellDrafts.set(ix, copy);
      baseCells.set(ix, cloneCellDraft(c));
      if (fr && cellUsesLayoutTypo(c, fr)) {
        layoutTypoBound.add(ix);
      }
    }
    publishedBaseline = { frame: frameSnap, cells: baseCells };
    applyAllCellDraftsToPage();
    updateChipDirtyState();
  }

  function updateLayoutTypoBindingForCell(ix, cell) {
    const frame = readPanelFrameState();
    if (cellUsesLayoutTypo(cell, frame)) {
      layoutTypoBound.add(ix);
    } else {
      layoutTypoBound.delete(ix);
    }
  }

  function applyLayoutTypographyToBoundCells() {
    const frame = readPanelFrameState();
    const fam = frame.defaultTextFontFamily || "";
    const size = frame.defaultTextFontSize || 16;
    layoutTypoBound.forEach((ix) => {
      const draft = cellDrafts.get(ix);
      if (!draft || (draft.contentType || "").toLowerCase() !== "text") {
        return;
      }
      const ts = { ...(draft.textStyle || {}) };
      ts.fontFamily = fam;
      ts.fontSize = size;
      const next = { ...draft, textStyle: ts };
      cellDrafts.set(ix, next);
      const mount = root.querySelector(`[data-frame-cell-index="${ix}"]`);
      if (mount) {
        applyCellToMount(/** @type {HTMLElement} */ (mount), next);
      }
    });
  }

  const cellUi = createFrameCellStagingUi({
    root,
    cellEditorHost,
    cellListInner,
    cellPickHeading,
    api,
    applyCellToMount,
    cellDrafts,
    layoutTypoBound,
    cellSaveHandlers,
    getFonts: () => lastAssetFontsList,
    fillFontFamilySelect,
    syncFontFamilySelectToValue,
    resolveFontFamilyFromSelect,
    fontFamilyCustomValue: FONT_FAMILY_CUSTOM,
    frameFontSel,
    frameFontCustomIn,
    frameTextSizeIn,
    copyFrameTypographyToCell,
    updateLayoutTypoBindingForCell,
    updateChipDirtyState,
    loadPageFontDefaults,
    frameCellSummarySnippet,
    syncTaPlaceholder,
    getAssetImages: () => lastAssetImagesList,
    refreshAssetImages: () =>
      loadLocalAssetImages(api, true).then((data) => {
        lastAssetImagesList = Array.isArray(data && data.images) ? data.images : [];
        return lastAssetImagesList;
      }),
    onCellSaved: commitPublishedCell,
  });

  cellUi.wireMountClick(() => panel.hasAttribute("hidden"));

  function readGridGapFromPanel() {
    return gridGapForApi(
      readGridGapPctFromInputs(frameGapTopIn, frameGapRightIn, frameGapBottomIn, frameGapLeftIn),
    );
  }

  function layoutFromFrameObject(fr) {
    const cols = Math.min(24, Math.max(1, Number(fr.columnCount) || 4));
    const rows = Math.min(24, Math.max(1, Number(fr.rowCount) || 2));
    return {
      columnCount: cols,
      rowCount: rows,
      gridGap: fr.gridGap != null ? fr.gridGap : "",
    };
  }

  function updatePanelLayoutDraftFromInputs() {
    const cols = parseInt(String(frameColsIn.value), 10);
    const rows = parseInt(String(frameRowsIn.value), 10);
    if (!Number.isFinite(cols) || cols < 1 || !Number.isFinite(rows) || rows < 1) {
      return;
    }
    panelLayoutDraft = {
      columnCount: Math.min(24, Math.max(1, cols)),
      rowCount: Math.min(24, Math.max(1, rows)),
      gridGap: readGridGapFromPanel(),
    };
  }

  /**
   * Live preview while the panel is open (may differ from SQLite until Save).
   * Prefer draft, then panel inputs, then CSS vars already on the frame root.
   */
  function readPanelFrameLayout() {
    if (panelLayoutDraft) {
      return { ...panelLayoutDraft };
    }
    let cols = parseInt(String(frameColsIn.value), 10);
    let rows = parseInt(String(frameRowsIn.value), 10);
    if (!Number.isFinite(cols) || cols < 1) {
      cols = parseInt(root.dataset.siteFrameCols || "", 10);
    }
    if (!Number.isFinite(rows) || rows < 1) {
      rows = parseInt(root.dataset.siteFrameRows || "", 10);
    }
    if (!Number.isFinite(cols) || cols < 1) {
      cols = 4;
    }
    if (!Number.isFinite(rows) || rows < 1) {
      rows = 2;
    }
    return {
      columnCount: Math.min(24, Math.max(1, cols)),
      rowCount: Math.min(24, Math.max(1, rows)),
      gridGap: readGridGapFromPanel(),
    };
  }

  function applyPanelFrameLayout() {
    const layout = readPanelFrameLayout();
    const prevCols = parseInt(root.dataset.siteFrameCols || "", 10);
    const prevRows = parseInt(root.dataset.siteFrameRows || "", 10);
    applyFrameRootLayout(layout);
    applyAllCellDraftsToPage();
    const gridResized =
      layout.columnCount !== prevCols ||
      layout.rowCount !== prevRows ||
      !Number.isFinite(prevCols) ||
      !Number.isFinite(prevRows);
    if (gridResized) {
      cellUi.refreshEditor();
    }
    updateChipDirtyState();
  }

  function cancelFrameLivePreviewRaf() {
    if (frameLivePreviewRaf) {
      cancelAnimationFrame(frameLivePreviewRaf);
      frameLivePreviewRaf = 0;
    }
  }

  /** Apply SQLite-published frame + cells to the page (source of truth when toggling the panel). */
  function applyPublishedFrameData(data) {
    if (!data || typeof data !== "object") {
      return;
    }
    const fr = data.frame;
    if (fr && typeof fr === "object") {
      fillFrameFields(fr, true);
      commitFrameSnapshotFrom(fr);
      applyFrameRootLayout(fr);
    }
    syncCellDraftsFromApi(Array.isArray(data.cells) ? data.cells : [], fr || null);
  }

  function fillFrameFields(fr, syncDimensionsFromApi = false) {
    if (!fr) {
      return;
    }
    frameLabelIn.value = fr.label != null ? String(fr.label) : "";
    fillGridGapPctInputs(
      frameGapTopIn,
      frameGapRightIn,
      frameGapBottomIn,
      frameGapLeftIn,
      fr.gridGap,
    );
    gapLegacyHint.hidden = parseGridGap(fr.gridGap).type !== "css";
    if (syncDimensionsFromApi) {
      const layout = layoutFromFrameObject(fr);
      frameColsIn.value = String(layout.columnCount);
      frameRowsIn.value = String(layout.rowCount);
      panelLayoutDraft = layout;
    }
    const dts = Math.min(288, Math.max(8, Number(fr.defaultTextFontSize) || 16));
    frameTextSizeIn.value = String(dts);
    suppressFrameFontSelChange = true;
    try {
      syncFontFamilySelectToValue(
        frameFontSel,
        frameFontCustomIn,
        fr.defaultTextFontFamily != null ? String(fr.defaultTextFontFamily) : "",
        lastAssetFontsList,
      );
    } finally {
      suppressFrameFontSelChange = false;
    }
    frameFontCustomIn.hidden = frameFontSel.value !== FONT_FAMILY_CUSTOM;
    updateChipDirtyState();
  }

  /**
   * @param {object | null} fr
   * @returns {object | null}
   */
  function normalizeFrameSnapshot(fr) {
    if (!fr || typeof fr !== "object") {
      return null;
    }
    return {
      label: fr.label != null ? String(fr.label) : "",
      gridGap: fr.gridGap != null ? fr.gridGap : "",
      columnCount: fr.columnCount != null ? Number(fr.columnCount) : 4,
      rowCount: fr.rowCount != null ? Number(fr.rowCount) : 2,
      defaultTextFontFamily:
        fr.defaultTextFontFamily != null ? String(fr.defaultTextFontFamily) : "",
      defaultTextFontSize: Math.min(288, Math.max(8, Number(fr.defaultTextFontSize) || 16)),
    };
  }

  function commitFrameSnapshotFrom(fr) {
    lastSavedFrameSnapshot = normalizeFrameSnapshot(fr);
  }

  let frameLivePreviewRaf = 0;
  function scheduleFrameLivePreview() {
    if (frameLivePreviewRaf) {
      cancelAnimationFrame(frameLivePreviewRaf);
    }
    frameLivePreviewRaf = requestAnimationFrame(() => {
      frameLivePreviewRaf = 0;
      applyPanelFrameLayout();
      applyLayoutTypographyToBoundCells();
    });
  }

  function wireFrameLivePreviewInputs() {
    const run = () => {
      scheduleFrameLivePreview();
    };
    const runLayout = () => {
      updatePanelLayoutDraftFromInputs();
      scheduleFrameLivePreview();
    };
    frameLabelIn.addEventListener("input", run);
    frameGapTopIn.addEventListener("input", runLayout);
    frameGapRightIn.addEventListener("input", runLayout);
    frameGapBottomIn.addEventListener("input", runLayout);
    frameGapLeftIn.addEventListener("input", runLayout);
    frameColsIn.addEventListener("input", runLayout);
    frameRowsIn.addEventListener("input", runLayout);
    frameFontCustomIn.addEventListener("input", run);
    frameTextSizeIn.addEventListener("input", run);
  }

  wireFrameLivePreviewInputs();

  function reloadAssetCatalogs() {
    return Promise.all([
      loadLocalAssetFonts(api).then((fd) => {
        lastAssetFontsList = Array.isArray(fd && fd.fonts) ? fd.fonts : [];
        return lastAssetFontsList;
      }),
      loadLocalAssetImages(api).then((id) => {
        lastAssetImagesList = Array.isArray(id && id.images) ? id.images : [];
        return lastAssetImagesList;
      }),
    ]);
  }

  void reloadAssetCatalogs().then(() => {
    const fd = { fonts: lastAssetFontsList };
    const preservedLayoutFont = resolveFontFamilyFromSelect(frameFontSel, frameFontCustomIn);
    suppressFrameFontSelChange = true;
    try {
      fillFontFamilySelect(frameFontSel, lastAssetFontsList, true);
      syncFontFamilySelectToValue(
        frameFontSel,
        frameFontCustomIn,
        preservedLayoutFont,
        lastAssetFontsList,
      );
    } finally {
      suppressFrameFontSelChange = false;
    }
    frameFontCustomIn.hidden = frameFontSel.value !== FONT_FAMILY_CUSTOM;
    cellUi.refreshAssetImagePickers();
  });

  async function pullFrameFromApi() {
    const res = await fetch(`${api}/api/frame?page=${encodeURIComponent(pageName)}`, { mode: "cors" });
    if (res.ok) {
      return res.json();
    }
    return fetchBakedFrame(pageName);
  }

  function placeFramePanelNearRootIfNeeded() {
    try {
      const posRaw = sessionStorage.getItem(framePanelPosStorageKey());
      if (posRaw) {
        const pos = JSON.parse(posRaw);
        if (pos && typeof pos.left === "string" && typeof pos.top === "string") {
          panel.style.left = pos.left;
          panel.style.top = pos.top;
          panel.style.right = "auto";
          panel.style.bottom = "auto";
          clampStagingPanelElement(panel);
          return;
        }
      }
    } catch (_e) {
      /* ignore */
    }
    const r = root.getBoundingClientRect();
    setStagingPanelPosition(panel, Math.round(r.left), Math.round(r.bottom + 8));
  }

  function requestClosePanel() {
    if (panelCloseInFlight || panel.hasAttribute("hidden")) {
      return Promise.resolve();
    }
    panelCloseInFlight = true;
    status.textContent = "Reloading saved frame…";
    labelBtn.disabled = true;
    closeBtn.disabled = true;
    return pullFrameFromApi()
      .then((data) => {
        if (!data || typeof data !== "object") {
          throw new Error("no_data");
        }
        cancelFrameLivePreviewRaf();
        panelLayoutDraft = null;
        applyPublishedFrameData(data);
        panel.setAttribute("hidden", "");
        labelBtn.setAttribute("aria-expanded", "false");
        status.textContent = "";
      })
      .catch(() => {
        status.textContent =
          "Could not reload saved frame. Fix the API (npm run dev:api) and try closing again.";
        return Promise.reject(new Error("close_failed"));
      })
      .finally(() => {
        panelCloseInFlight = false;
        labelBtn.disabled = false;
        closeBtn.disabled = false;
      });
  }

  function revealFramePanel() {
    panel.removeAttribute("hidden");
    placeFramePanelNearRootIfNeeded();
    clampStagingPanelElement(panel);
  }

  function setOpen(open) {
    if (open) {
      cancelFrameLivePreviewRaf();
      labelBtn.setAttribute("aria-expanded", "true");
      status.textContent = "Loading…";
      pullFrameFromApi()
        .then((data) => {
          status.textContent = "";
          applyPublishedFrameData(data);
          revealFramePanel();
          reloadAssetCatalogs().then(() => {
            suppressFrameFontSelChange = true;
            try {
              fillFontFamilySelect(frameFontSel, lastAssetFontsList, true);
            } finally {
              suppressFrameFontSelChange = false;
            }
            void loadPageFontDefaults();
            cellUi.refreshAssetImagePickers();
            cellUi.refreshEditor();
          });
        })
        .catch(() => {
          status.textContent = "Could not load frame (API?).";
          revealFramePanel();
          reloadAssetCatalogs().then(() => {
            fillFontFamilySelect(frameFontSel, lastAssetFontsList, true);
            cellUi.refreshAssetImagePickers();
            cellUi.refreshEditor();
          });
        });
    } else {
      requestClosePanel().catch(() => {
        /* panel stays open until reload succeeds */
      });
    }
  }

  function buildFramePatchPayload() {
    const fid = parseInt(root.dataset.siteFrameId || "", 10);
    if (!fid) {
      return null;
    }
    const base = publishedBaseline ? publishedBaseline.frame : null;
    const now = readPanelFrameState();
    /** @type {Record<string, unknown>} */
    const body = { id: fid };
    let hasField = false;
    if (!base || now.label !== base.label) {
      body.label = frameLabelIn.value;
      hasField = true;
    }
    if (!base || JSON.stringify(now.gridGap) !== JSON.stringify(base.gridGap)) {
      body.gridGap = readGridGapFromPanel();
      hasField = true;
    }
    if (!base || now.columnCount !== base.columnCount || now.rowCount !== base.rowCount) {
      body.columnCount = now.columnCount;
      body.rowCount = now.rowCount;
      hasField = true;
    }
    if (!base || now.defaultTextFontFamily !== base.defaultTextFontFamily) {
      body.defaultTextFontFamily = resolveFontFamilyFromSelect(frameFontSel, frameFontCustomIn);
      hasField = true;
    }
    if (!base || now.defaultTextFontSize !== base.defaultTextFontSize) {
      body.defaultTextFontSize = Math.min(
        288,
        Math.max(8, parseInt(String(frameTextSizeIn.value), 10) || 16),
      );
      hasField = true;
    }
    return hasField ? body : null;
  }

  function buildFullFramePatchPayload() {
    const fid = parseInt(root.dataset.siteFrameId || "", 10);
    if (!fid) {
      return null;
    }
    const now = readPanelFrameState();
    return {
      id: fid,
      label: frameLabelIn.value,
      gridGap: readGridGapFromPanel(),
      columnCount: now.columnCount,
      rowCount: now.rowCount,
      defaultTextFontFamily: resolveFontFamilyFromSelect(frameFontSel, frameFontCustomIn),
      defaultTextFontSize: Math.min(
        288,
        Math.max(8, parseInt(String(frameTextSizeIn.value), 10) || 16),
      ),
    };
  }

  function frameDimensionsWillResize() {
    if (!publishedBaseline) {
      return false;
    }
    const now = readPanelFrameState();
    return (
      now.columnCount !== publishedBaseline.frame.columnCount ||
      now.rowCount !== publishedBaseline.frame.rowCount
    );
  }

  function patchFrameToApi(frameBody) {
    const fid = parseInt(root.dataset.siteFrameId || "", 10);
    if (!fid) {
      return Promise.reject(new Error("no_frame_id"));
    }
    const body = frameBody || buildFramePatchPayload();
    if (!body) {
      return pullFrameFromApi();
    }
    return fetch(api + "/api/frame", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        throw new Error(errText || "HTTP " + r.status);
      }
      return r.json();
    });
  }

  function patchCellDraftToApi(draft) {
    const payload = cellDraftToPatchPayload(draft);
    if (!payload) {
      return Promise.resolve(null);
    }
    return fetch(api + "/api/frame/cell", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify(payload),
    }).then(async (r) => {
      if (!r.ok) {
        throw new Error("HTTP " + r.status);
      }
      return r.json();
    });
  }

  async function patchAllCellDraftsAfterGridResize(draftsSnapshot) {
    const fresh = await pullFrameFromApi();
    if (!fresh || !Array.isArray(fresh.cells)) {
      return;
    }
    /** @type {Map<number, number>} */
    const idByIndex = new Map();
    for (let i = 0; i < fresh.cells.length; i++) {
      const c = fresh.cells[i];
      if (c && typeof c.cellIndex === "number" && typeof c.id === "number") {
        idByIndex.set(c.cellIndex, c.id);
      }
    }
    const list = draftsSnapshot ? Array.from(draftsSnapshot.entries()) : [];
    for (let i = 0; i < list.length; i++) {
      const ix = parseInt(list[i][0], 10);
      const draft = list[i][1];
      if (!Number.isFinite(ix) || !draft) {
        continue;
      }
      const newId = idByIndex.get(ix);
      if (!newId) {
        continue;
      }
      const out = await patchCellDraftToApi({ ...draft, id: newId });
      const cell = out && out.cell;
      if (cell && typeof cell.cellIndex === "number") {
        cellDrafts.set(String(cell.cellIndex), cell);
      }
    }
  }

  async function savePageLayoutToApi() {
    if (typeof cellUi.flushActiveCellDraft === "function") {
      cellUi.flushActiveCellDraft();
    }

    if (!publishedBaseline) {
      const boot = await pullFrameFromApi();
      if (boot && typeof boot === "object" && boot.frame) {
        applyPublishedFrameData(boot);
      }
    }

    let fid = parseInt(root.dataset.siteFrameId || "", 10);
    if (!fid) {
      const boot = await pullFrameFromApi();
      if (boot && boot.frame && typeof boot.frame.id === "number") {
        root.dataset.siteFrameId = String(boot.frame.id);
        fid = boot.frame.id;
        if (!publishedBaseline) {
          applyPublishedFrameData(boot);
        }
      }
    }
    if (!fid) {
      throw new Error(`no_frame_for_page:${pageName}`);
    }

    if (!publishedBaseline) {
      throw new Error(`no_frame_for_page:${pageName}`);
    }

    const willResizeGrid = frameDimensionsWillResize();
    await flushGalleriesForPage(pageName);

    const draftsBeforeResize = willResizeGrid ? new Map(cellDrafts) : null;
    const fullFrameBody = buildFullFramePatchPayload();

    try {
      if (willResizeGrid) {
        await patchFrameToApi(fullFrameBody);
        if (draftsBeforeResize) {
          await patchAllCellDraftsAfterGridResize(draftsBeforeResize);
        }
      } else {
        for (const draft of cellDrafts.values()) {
          if (!draft || typeof draft.id !== "number") {
            continue;
          }
          const out = await patchCellDraftToApi(draft);
          const cell = out && out.cell;
          if (cell && typeof cell.cellIndex === "number") {
            cellDrafts.set(String(cell.cellIndex), cell);
          }
        }
        await patchFrameToApi(fullFrameBody);
      }
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
        _cellSave: true,
      });
    }

    const data = await pullFrameFromApi();
    if (!data) {
      throw new Error("no_frame_reload");
    }
    applyPublishedFrameData(data);
    dispatchFrameSettings();
    await reloadGalleriesForPage(pageName);
    cellUi.refreshEditor();
    updateChipDirtyState();
    clearFramePageSession(pageName);
    if (requestRegistryRefresh) {
      requestRegistryRefresh();
    }
    return { saved: true };
  }

  const publishHandle = { savePageLayout: savePageLayoutToApi, pageName, api };
  framePublishHandlers.add(publishHandle);

  saveAllBtn.addEventListener("click", () => {
    const saveLabel = saveAllBtn.textContent;
    status.textContent = "Saving…";
    saveAllBtn.disabled = true;
    saveAllBtn.textContent = "Saving…";

    const savingWillResizeGrid = frameDimensionsWillResize();
    savePageLayoutToApi()
      .then(() => {
        status.textContent = savingWillResizeGrid
          ? "Saved — frame, all cells, and galleries on this page (grid resized)."
          : "Saved — frame, all cells, and galleries on this page.";
      })
      .catch((err) => {
        if (err && err._cellSave) {
          const detail = err && err.message ? String(err.message).trim() : "";
          status.textContent =
            detail && detail !== "HTTP 400" && detail !== "HTTP 404" && detail !== "HTTP 500"
              ? "Could not save layout: " + detail
              : "Could not save layout (is npm run dev:api running?).";
        } else if (err && String(err.message || "").startsWith("no_frame_for_page:")) {
          status.textContent =
            "No frame in SQLite for this page (\"" +
            pageName +
            "\"). In Pages: page name must match data-site-frame-page, or use Add frame.";
        } else if (err && err.message === "no_frame_id") {
          status.textContent = "No frame id on page (GET /api/frame failed?).";
        } else if (err && String(err.message || "").startsWith("gallery_patch_")) {
          status.textContent = "Could not save a gallery on this page (check dev API logs).";
        } else if (err && String(err.message || "").startsWith("font_patch_")) {
          status.textContent = "Could not save page font (check dev API logs).";
        } else {
          status.textContent = "Could not save layout (check dev API logs).";
        }
      })
      .finally(() => {
        saveAllBtn.disabled = false;
        saveAllBtn.textContent = saveLabel;
      });
  });

  function syncTaPlaceholder(typeSel, ta) {
    const v = typeSel.value;
    if (v === "html") {
      ta.placeholder = "<p>…</p>";
      ta.spellcheck = false;
    } else if (v === "image") {
      ta.placeholder = "https://…";
      ta.spellcheck = false;
    } else if (v === "text") {
      ta.placeholder = "Visible copy for this cell…";
      ta.spellcheck = true;
    } else {
      ta.placeholder = "";
      ta.spellcheck = false;
    }
  }

  function copyFrameTypographyToCell(fontSel, fontCustomIn, sizeIn) {
    const fam = resolveFontFamilyFromSelect(frameFontSel, frameFontCustomIn);
    syncFontFamilySelectToValue(fontSel, fontCustomIn, fam, lastAssetFontsList);
    fontCustomIn.hidden = fontSel.value !== FONT_FAMILY_CUSTOM;
    sizeIn.value = frameTextSizeIn.value;
  }


  function onLabelClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!panel.hasAttribute("hidden")) {
      requestClosePanel().catch(() => {});
      return;
    }
    setOpen(true);
  }
  labelBtn.addEventListener("click", onLabelClick);

  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!panel.hasAttribute("hidden")) {
      requestClosePanel().catch(() => {});
    }
  });

  let framePanelDrag = false;
  let framePanelStartX = 0;
  let framePanelStartY = 0;
  let framePanelStartLeft = 0;
  let framePanelStartTop = 0;

  function onFramePanelDragMove(ev) {
    if (!framePanelDrag) {
      return;
    }
    const dx = ev.clientX - framePanelStartX;
    const dy = ev.clientY - framePanelStartY;
    setStagingPanelPosition(panel, framePanelStartLeft + dx, framePanelStartTop + dy);
  }

  function onFramePanelDragUp() {
    if (!framePanelDrag) {
      return;
    }
    framePanelDrag = false;
    try {
      sessionStorage.setItem(
        framePanelPosStorageKey(),
        JSON.stringify({ left: panel.style.left, top: panel.style.top }),
      );
    } catch (_e) {
      /* ignore */
    }
    window.removeEventListener("mousemove", onFramePanelDragMove);
    window.removeEventListener("mouseup", onFramePanelDragUp);
  }

  function onFramePanelHeaderMouseDown(ev) {
    if (ev.button !== 0 || ev.target.closest(".staging-frame-panel__close")) {
      return;
    }
    framePanelDrag = true;
    framePanelStartX = ev.clientX;
    framePanelStartY = ev.clientY;
    const rect = panel.getBoundingClientRect();
    framePanelStartLeft = rect.left;
    framePanelStartTop = rect.top;
    setStagingPanelPosition(panel, framePanelStartLeft, framePanelStartTop);
    const snapped = panel.getBoundingClientRect();
    framePanelStartLeft = snapped.left;
    framePanelStartTop = snapped.top;
    ev.preventDefault();
    window.addEventListener("mousemove", onFramePanelDragMove);
    window.addEventListener("mouseup", onFramePanelDragUp);
  }

  head.addEventListener("mousedown", onFramePanelHeaderMouseDown);

  panel.appendChild(head);
  panel.appendChild(status);
  panel.appendChild(bodyEl);
  document.body.appendChild(panel);

  void pullFrameFromApi().then((data) => {
    if (data && typeof data === "object" && data.frame) {
      applyPublishedFrameData(data);
    } else if (initialFrame && typeof initialFrame === "object") {
      fillFrameFields(initialFrame, true);
      status.textContent =
        "Frame layout not in SQLite for \"" +
        pageName +
        "\" — edits may not save until the page name matches the registry.";
      updateChipDirtyState();
    }
  });

  function teardown() {
    framePublishHandlers.delete(publishHandle);
    cellUi.teardownMountClick();
    if (typeof cellUi.teardownPlacementDrag === "function") {
      cellUi.teardownPlacementDrag();
    }
    labelBtn.removeEventListener("click", onLabelClick);
    head.removeEventListener("mousedown", onFramePanelHeaderMouseDown);
    window.removeEventListener("mousemove", onFramePanelDragMove);
    window.removeEventListener("mouseup", onFramePanelDragUp);
    labelRow.remove();
    panel.remove();
    root.classList.remove("site-frame--staging");
    delete root.dataset.siteFrameStagingGui;
    cachedAssetFontsPromise = null;
    cachedAssetFontsApiBase = null;
    cachedAssetImagesPromise = null;
    cachedAssetImagesApiBase = null;
  }

  return { teardown };
}

if (typeof window !== "undefined") {
  window.__customdevPublishFlushFrames = flushAllFramesForPublish;
}
