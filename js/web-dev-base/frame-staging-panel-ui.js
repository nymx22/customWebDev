/**
 * Phase 2 frame panel: click-to-select / cell list + single cell editor host.
 */

import {
  cellPaddingForApi,
  cellPaddingSidesDiffer,
  fillCellPaddingInputs,
  readCellPaddingFromPanel,
} from "./frame-cell-padding.js";
import {
  assetImageSummary,
  fillAssetImageSelect,
  normalizeStoredAssetImagePath,
} from "./frame-asset-images.js";
import {
  blocksToPlainBody,
  bodyBlocksSummary,
  expandMultilineTextBlocks,
  mountTextBodyBlocksEditor,
  normalizeBodyBlocks,
  resolveBodyBlocks,
  sanitizeNavUrl,
} from "./frame-text-blocks.js";
import {
  fillSitePageSelect,
  invalidateSitePageChoicesCache,
  loadSitePageChoices,
} from "./frame-site-pages.js";
import {
  DEFAULT_SHAPE_STYLE,
  normalizeShapeStyle,
  sanitizeShapeColor,
  SHAPE_KINDS,
  shapeScalePctFromStyle,
} from "./frame-cell-shape.js";
import { mountTextLinkStyleEditor } from "./frame-text-link-style.js";
import { mountStackLayerControls } from "./frame-stack-cell-editor.js";
import { normalizeStackLayer } from "./frame-cell-layers.js";
import {
  mountFrameCellPlacementDrag,
  placementForApi,
  placementFromStyle,
  parsePlacementPct,
} from "./frame-cell-placement.js";
import { clampFrameCellScalePct, FRAME_CELL_SCALE_MAX, FRAME_CELL_SCALE_MIN } from "./frame-cell-scale.js";

/**
 * @param {{
 *   root: HTMLElement,
 *   cellEditorHost: HTMLElement,
 *   cellListInner: HTMLElement,
 *   cellPickHeading: HTMLElement,
 *   api: string,
 *   applyCellToMount: (mount: HTMLElement, cell: object) => void,
 *   cellDrafts: Map<string, object>,
 *   layoutTypoBound: Set<string>,
 *   cellSaveHandlers: Map<string, { save: () => Promise<object> }>,
 *   getFonts: () => Array<object>,
 *   fillFontFamilySelect: (sel: HTMLSelectElement, fonts: Array<object>, includeCustom: boolean) => void,
 *   syncFontFamilySelectToValue: (
 *     sel: HTMLSelectElement,
 *     customIn: HTMLInputElement,
 *     value: string,
 *     fonts: Array<object>,
 *   ) => void,
 *   resolveFontFamilyFromSelect: (sel: HTMLSelectElement, customIn: HTMLInputElement) => string,
 *   fontFamilyCustomValue: string,
 *   frameFontSel: HTMLSelectElement,
 *   frameFontCustomIn: HTMLInputElement,
 *   frameTextSizeIn: HTMLInputElement,
 *   copyFrameTypographyToCell: (
 *     fontSel: HTMLSelectElement,
 *     fontCustomIn: HTMLInputElement,
 *     sizeIn: HTMLInputElement,
 *   ) => void,
 *   updateLayoutTypoBindingForCell: (ix: string, cell: object) => void,
 *   updateChipDirtyState: () => void,
 *   loadPageFontDefaults: () => Promise<{ fontSize: number, fontFamily: string }>,
 *   frameCellSummarySnippet: (contentType: string, taValue: string) => string,
 *   syncTaPlaceholder: (typeSel: HTMLSelectElement, ta: HTMLTextAreaElement) => void,
 *   getAssetImages: () => Array<{ path: string, label?: string }>,
 *   refreshAssetImages: () => Promise<Array<{ path: string, label?: string }>>,
 *   onCellSaved?: (cell: object) => void,
 * }} deps
 */
export function createFrameCellStagingUi(deps) {
  const {
    root,
    cellEditorHost,
    cellListInner,
    cellPickHeading,
    api,
    applyCellToMount,
    cellDrafts,
    layoutTypoBound,
    cellSaveHandlers,
    onCellSaved,
    getFonts,
    fillFontFamilySelect,
    syncFontFamilySelectToValue,
    resolveFontFamilyFromSelect,
    fontFamilyCustomValue,
    copyFrameTypographyToCell,
    updateLayoutTypoBindingForCell,
    updateChipDirtyState,
    loadPageFontDefaults,
    frameCellSummarySnippet,
    syncTaPlaceholder,
    getAssetImages,
    refreshAssetImages,
  } = deps;

  let selectedCellIndex = null;
  /** @type {HTMLInputElement | null} */
  let placementPosXIn = null;
  /** @type {HTMLInputElement | null} */
  let placementPosYIn = null;
  /** @type {HTMLElement | null} */
  let placementWrap = null;
  /** @type {(() => void) | null} */
  let flushActiveCellDraft = null;
  /** @type {(() => void) | null} */
  let refreshImagePickerFn = null;
  const cellPadSidesExpandedByIndex = new Map();

  function updateMountSelectionHighlight() {
    root.querySelectorAll("[data-frame-cell-index]").forEach((m) => {
      m.classList.toggle(
        "site-frame__cell-mount--staging-selected",
        selectedCellIndex != null && m.getAttribute("data-frame-cell-index") === selectedCellIndex,
      );
    });
  }

  function updateCellPickHeading() {
    if (selectedCellIndex == null) {
      cellPickHeading.textContent = "Click a cell on the page, or pick below";
    } else {
      cellPickHeading.textContent = `Editing cell ${selectedCellIndex}`;
    }
  }

  function refreshCellList() {
    cellListInner.replaceChildren();
    const mounts = Array.from(root.querySelectorAll("[data-frame-cell-index]"));
    mounts.forEach((mount) => {
      const idx = mount.getAttribute("data-frame-cell-index");
      const cid = mount.dataset.frameCellId;
      if (!cid || idx == null) {
        return;
      }
      const draft = cellDrafts.get(String(idx));
      const ty = draft ? String(draft.contentType || "empty") : mount.dataset.frameContentType || "empty";
      const body = draft && draft.body != null ? String(draft.body) : "";
      const snippet =
        ty === "text"
          ? bodyBlocksSummary(resolveBodyBlocks(draft && draft.textStyle, body))
          : ty === "image"
            ? assetImageSummary(body)
            : frameCellSummarySnippet(ty, body);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "staging-frame-panel__cell-pick-btn";
      if (String(idx) === selectedCellIndex) {
        btn.classList.add("is-selected");
      }
      const role = draft && draft.cellRole ? String(draft.cellRole).trim() : "";
      btn.textContent = "Cell " + idx + (role ? " — " + role : "") + " — " + snippet;
      btn.addEventListener("click", () => {
        selectCell(idx);
      });
      cellListInner.appendChild(btn);
    });
  }

  function selectCell(ix) {
    if (
      ix != null &&
      selectedCellIndex != null &&
      String(ix) !== selectedCellIndex &&
      flushActiveCellDraft
    ) {
      flushActiveCellDraft();
    }
    if (ix == null) {
      selectedCellIndex = null;
    } else {
      const mount = root.querySelector(`[data-frame-cell-index="${ix}"]`);
      const draft = cellDrafts.get(String(ix));
      const hasId =
        (mount && mount.dataset.frameCellId) ||
        (draft && typeof draft.id === "number" && Number.isFinite(draft.id));
      if (!mount || !hasId) {
        return;
      }
      selectedCellIndex = String(ix);
    }
    updateMountSelectionHighlight();
    updateCellPickHeading();
    refreshCellList();
    mountSelectedCellEditor();
  }

  function applyPlacementToSelectedCell(placement) {
    const ix = selectedCellIndex;
    if (ix == null || !placement) {
      return;
    }
    const draft = cellDrafts.get(String(ix));
    if (!draft) {
      return;
    }
    const ct = String(draft.contentType || "").toLowerCase();
    if (ct === "image") {
      draft.imageStyle = {
        ...(draft.imageStyle && typeof draft.imageStyle === "object" ? draft.imageStyle : {}),
        placementLeftPct: placement.placementLeftPct,
        placementTopPct: placement.placementTopPct,
      };
    } else if (ct === "shape") {
      draft.shapeStyle = {
        ...normalizeShapeStyle(
          draft.shapeStyle && typeof draft.shapeStyle === "object" ? draft.shapeStyle : {},
        ),
        placementLeftPct: placement.placementLeftPct,
        placementTopPct: placement.placementTopPct,
      };
    } else {
      return;
    }
    cellDrafts.set(String(ix), draft);
    const mountEl = root.querySelector(`[data-frame-cell-index="${ix}"]`);
    if (mountEl) {
      applyCellToMount(/** @type {HTMLElement} */ (mountEl), draft);
    }
    if (placementPosXIn) {
      placementPosXIn.value = String(placement.placementLeftPct);
    }
    if (placementPosYIn) {
      placementPosYIn.value = String(placement.placementTopPct);
    }
    updateChipDirtyState();
  }

  function clearPlacementOnSelectedCell() {
    const ix = selectedCellIndex;
    if (ix == null) {
      return;
    }
    const draft = cellDrafts.get(String(ix));
    if (!draft) {
      return;
    }
    const ct = String(draft.contentType || "").toLowerCase();
    if (ct === "image") {
      draft.imageStyle = {
        ...(draft.imageStyle && typeof draft.imageStyle === "object" ? draft.imageStyle : {}),
        placementLeftPct: null,
        placementTopPct: null,
      };
    } else if (ct === "shape") {
      draft.shapeStyle = {
        ...normalizeShapeStyle(
          draft.shapeStyle && typeof draft.shapeStyle === "object" ? draft.shapeStyle : {},
        ),
        placementLeftPct: null,
        placementTopPct: null,
      };
    } else {
      return;
    }
    cellDrafts.set(String(ix), draft);
    const mountEl = root.querySelector(`[data-frame-cell-index="${ix}"]`);
    if (mountEl) {
      applyCellToMount(/** @type {HTMLElement} */ (mountEl), draft);
    }
    if (placementPosXIn) {
      placementPosXIn.value = "";
    }
    if (placementPosYIn) {
      placementPosYIn.value = "";
    }
    updateChipDirtyState();
  }

  function readPlacementFromPanel() {
    if (!placementPosXIn || !placementPosYIn) {
      return placementForApi(null);
    }
    const left = parsePlacementPct(placementPosXIn.value);
    const top = parsePlacementPct(placementPosYIn.value);
    if (left === null || top === null) {
      return { placementLeftPct: null, placementTopPct: null };
    }
    return { placementLeftPct: left, placementTopPct: top };
  }

  function fillPlacementFromStyle(style) {
    const p = placementFromStyle(style);
    if (!placementPosXIn || !placementPosYIn) {
      return;
    }
    if (!p) {
      placementPosXIn.value = "";
      placementPosYIn.value = "";
      return;
    }
    placementPosXIn.value = String(p.placementLeftPct);
    placementPosYIn.value = String(p.placementTopPct);
  }

  function syncPlacementWrapVisibility(contentType) {
    if (!placementWrap) {
      return;
    }
    const ct = String(contentType || "").toLowerCase();
    placementWrap.hidden = ct !== "image" && ct !== "shape";
  }

  function mountSelectedCellEditor() {
    clearImagePickerRefresh();
    flushActiveCellDraft = null;
    placementPosXIn = null;
    placementPosYIn = null;
    placementWrap = null;
    cellEditorHost.replaceChildren();
    cellSaveHandlers.clear();

    if (selectedCellIndex == null) {
      const empty = document.createElement("p");
      empty.className = "staging-frame-panel__cell-editor-empty";
      empty.textContent = "Select a cell on the page or from the list below.";
      cellEditorHost.appendChild(empty);
      return;
    }

    const idx = selectedCellIndex;
    const mount = root.querySelector(`[data-frame-cell-index="${idx}"]`);
    const draftForMount = cellDrafts.get(String(idx));
    const cid =
      (mount && mount.dataset.frameCellId) ||
      (draftForMount && typeof draftForMount.id === "number"
        ? String(draftForMount.id)
        : "");
    if (!mount || !cid) {
      const empty = document.createElement("p");
      empty.className = "staging-frame-panel__cell-editor-empty";
      empty.textContent =
        "This cell is not in SQLite yet. Reload after npm run dev:api, or pick another cell.";
      cellEditorHost.appendChild(empty);
      return;
    }

    const fonts = Array.isArray(getFonts()) ? getFonts() : [];

    function liveMount() {
      return root.querySelector(`[data-frame-cell-index="${idx}"]`);
    }

    const inner = document.createElement("div");
    inner.className = "staging-frame-panel__cell-editor";

    const cellQuickRow = document.createElement("div");
    cellQuickRow.className = "staging-frame-panel__cell-quick-actions";
    const addTextBtn = document.createElement("button");
    addTextBtn.type = "button";
    addTextBtn.className = "staging-frame-panel__inline-action";
    addTextBtn.textContent = "Add text";
    addTextBtn.title = "Switch this cell to text";
    cellQuickRow.appendChild(addTextBtn);

    const roleLab = document.createElement("label");
    roleLab.className = "staging-frame-panel__field-label";
    roleLab.textContent = "Cell role (staging only)";
    const roleIn = document.createElement("input");
    roleIn.type = "text";
    roleIn.className = "staging-frame-panel__input";
    roleIn.autocomplete = "off";
    roleLab.appendChild(roleIn);

    const typeSel = document.createElement("select");
    typeSel.className = "staging-frame-panel__select";
    [
      ["empty", "Empty"],
      ["text", "Text"],
      ["html", "HTML"],
      ["image", "Image"],
      ["shape", "Shape"],
      ["stack", "Stack (layers)"],
    ].forEach(([v, lab]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lab;
      typeSel.appendChild(o);
    });

    const bodyLab = document.createElement("div");
    bodyLab.className = "staging-frame-panel__cell-body-field";
    const bodyCap = document.createElement("div");
    bodyCap.className = "staging-frame-panel__field-label";
    bodyCap.textContent = "Text";
    const ta = document.createElement("textarea");
    ta.className = "staging-frame-panel__textarea";
    ta.rows = 6;
    bodyLab.appendChild(bodyCap);
    bodyLab.appendChild(ta);

    const bodyBlocksHost = document.createElement("div");
    bodyBlocksHost.className = "staging-frame-panel__body-blocks-host";
    bodyBlocksHost.hidden = true;

    let editorBlocks = [];
    const bodyBlocksEditor = mountTextBodyBlocksEditor(bodyBlocksHost, {
      getBlocks: () => editorBlocks,
      setBlocks: (blocks) => {
        editorBlocks = normalizeBodyBlocks(blocks);
      },
      onInput: () => bumpCellEditor(),
      layoutApiBase: api,
    });

    const cellPadLab = document.createElement("div");
    cellPadLab.className = "staging-frame-panel__field-label";
    cellPadLab.textContent = "Cell padding (% of frame grid)";

    const cellPadRow = document.createElement("div");
    cellPadRow.className = "staging-frame-panel__cell-pad-row";

    const cellPadUniformCol = document.createElement("div");
    cellPadUniformCol.className = "staging-frame-panel__figma-field";
    const cellPadUniformCap = document.createElement("span");
    cellPadUniformCap.className = "staging-frame-panel__figma-caption";
    cellPadUniformCap.textContent = "Padding %";
    const cellPadUniformIn = document.createElement("input");
    cellPadUniformIn.type = "number";
    cellPadUniformIn.className = "staging-frame-panel__input staging-frame-panel__input--gap-pct";
    cellPadUniformIn.min = "0";
    cellPadUniformIn.max = "50";
    cellPadUniformIn.step = "0.5";
    cellPadUniformCol.appendChild(cellPadUniformCap);
    cellPadUniformCol.appendChild(cellPadUniformIn);

    const cellPadEditSidesBtn = document.createElement("button");
    cellPadEditSidesBtn.type = "button";
    cellPadEditSidesBtn.className = "staging-frame-panel__mini-action";
    cellPadEditSidesBtn.textContent = "Edit sides";

    const cellPadSidesGrid = document.createElement("div");
    cellPadSidesGrid.className = "staging-frame-panel__gap-pct-grid staging-frame-panel__cell-pad-sides";

    function makePadSide(caption) {
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
      col.appendChild(cap);
      col.appendChild(inp);
      return inp;
    }

    const cellPadTopIn = makePadSide("Up");
    const cellPadRightIn = makePadSide("Right");
    const cellPadBottomIn = makePadSide("Down");
    const cellPadLeftIn = makePadSide("Left");
    [cellPadTopIn, cellPadRightIn, cellPadBottomIn, cellPadLeftIn].forEach((inp) => {
      const col = inp.parentElement;
      if (col) {
        cellPadSidesGrid.appendChild(col);
      }
    });

    cellPadRow.appendChild(cellPadUniformCol);
    cellPadRow.appendChild(cellPadEditSidesBtn);
    cellPadLab.appendChild(cellPadRow);
    cellPadLab.appendChild(cellPadSidesGrid);

    placementWrap = document.createElement("div");
    placementWrap.className = "staging-frame-panel__placement-wrap";
    placementWrap.hidden = true;
    const placementTitle = document.createElement("div");
    placementTitle.className = "staging-frame-panel__field-label";
    placementTitle.textContent = "Position on frame grid (% — center of image/shape)";
    placementWrap.appendChild(placementTitle);

    const placementRow = document.createElement("div");
    placementRow.className = "staging-frame-panel__placement-row";

    function makePlacementField(caption) {
      const col = document.createElement("div");
      col.className = "staging-frame-panel__figma-field";
      const cap = document.createElement("span");
      cap.className = "staging-frame-panel__figma-caption";
      cap.textContent = caption;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.className = "staging-frame-panel__input staging-frame-panel__input--gap-pct";
      inp.min = "0";
      inp.max = "100";
      inp.step = "0.5";
      col.appendChild(cap);
      col.appendChild(inp);
      placementRow.appendChild(col);
      return inp;
    }

    placementPosXIn = makePlacementField("X %");
    placementPosYIn = makePlacementField("Y %");

    const placementActions = document.createElement("div");
    placementActions.className = "staging-frame-panel__placement-actions";
    const placementResetBtn = document.createElement("button");
    placementResetBtn.type = "button";
    placementResetBtn.className = "staging-frame-panel__mini-action";
    placementResetBtn.textContent = "Reset position";
    const placementCenterBtn = document.createElement("button");
    placementCenterBtn.type = "button";
    placementCenterBtn.className = "staging-frame-panel__mini-action";
    placementCenterBtn.textContent = "Center on grid";
    placementActions.appendChild(placementResetBtn);
    placementActions.appendChild(placementCenterBtn);

    const placementHint = document.createElement("p");
    placementHint.className = "staging-frame-panel__placement-hint";
    placementHint.textContent =
      "With this cell selected, drag the image or shape on the page to position it (same as images).";

    placementWrap.appendChild(placementRow);
    placementWrap.appendChild(placementActions);
    placementWrap.appendChild(placementHint);

    const textWrap = document.createElement("div");
    textWrap.className = "staging-frame-panel__text-style";
    textWrap.hidden = true;

    const cellTypGrid = document.createElement("div");
    cellTypGrid.className = "staging-frame-panel__figma-typography staging-frame-panel__figma-typography--cell";

    const cellFontSel = document.createElement("select");
    cellFontSel.className = "staging-frame-panel__select staging-frame-panel__select--figma-font";
    const cellFontCustomIn = document.createElement("input");
    cellFontCustomIn.type = "text";
    cellFontCustomIn.className = "staging-frame-panel__input staging-frame-panel__input--figma-custom-font";
    cellFontCustomIn.hidden = true;

    const ffSizeIn = document.createElement("input");
    ffSizeIn.type = "number";
    ffSizeIn.className = "staging-frame-panel__input staging-frame-panel__input--figma-size";
    ffSizeIn.min = "8";
    ffSizeIn.max = "288";
    ffSizeIn.value = "16";

    fillFontFamilySelect(cellFontSel, fonts, true);

    const cellFfCol = document.createElement("div");
    cellFfCol.className = "staging-frame-panel__figma-field";
    const cellFfCap = document.createElement("span");
    cellFfCap.className = "staging-frame-panel__figma-caption";
    cellFfCap.textContent = "Font";
    cellFfCol.appendChild(cellFfCap);
    cellFfCol.appendChild(cellFontSel);
    cellFfCol.appendChild(cellFontCustomIn);
    const cellFsCol = document.createElement("div");
    cellFsCol.className = "staging-frame-panel__figma-field";
    const cellFsCap = document.createElement("span");
    cellFsCap.className = "staging-frame-panel__figma-caption";
    cellFsCap.textContent = "Size";
    cellFsCol.appendChild(cellFsCap);
    cellFsCol.appendChild(ffSizeIn);
    cellTypGrid.appendChild(cellFfCol);
    cellTypGrid.appendChild(cellFsCol);

    const textActions = document.createElement("div");
    textActions.className = "staging-frame-panel__text-actions";
    const useFrameTypBtn = document.createElement("button");
    useFrameTypBtn.type = "button";
    useFrameTypBtn.className = "staging-frame-panel__mini-action";
    useFrameTypBtn.textContent = "Use layout typography";
    const usePageFontBtn = document.createElement("button");
    usePageFontBtn.type = "button";
    usePageFontBtn.className = "staging-frame-panel__mini-action";
    usePageFontBtn.textContent = "Use page font";
    textActions.appendChild(useFrameTypBtn);
    textActions.appendChild(usePageFontBtn);

    const lhLab = document.createElement("label");
    lhLab.className = "staging-frame-panel__field-label";
    lhLab.textContent = "Line spacing (% of font size)";
    const lhIn = document.createElement("input");
    lhIn.type = "number";
    lhIn.className = "staging-frame-panel__input staging-frame-panel__input--narrow";
    lhIn.min = "50";
    lhIn.max = "250";
    lhIn.value = "100";
    lhLab.appendChild(lhIn);

    textWrap.appendChild(cellTypGrid);
    textWrap.appendChild(textActions);
    textWrap.appendChild(lhLab);

    /** @type {{ read: () => object, apply: (style: unknown) => void } | null} */
    let linkStyleEditor = null;

    const imageWrap = document.createElement("div");
    imageWrap.className = "staging-frame-panel__image-style";
    imageWrap.hidden = true;

    const fitLab = document.createElement("label");
    fitLab.className = "staging-frame-panel__field-label";
    fitLab.textContent = "Image fit";
    const fitSel = document.createElement("select");
    fitSel.className = "staging-frame-panel__select";
    [
      ["contain", "Contain"],
      ["cover", "Cover"],
      ["fill", "Fill"],
      ["scale-down", "Scale down"],
      ["none", "None"],
    ].forEach(([v, lab]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lab;
      fitSel.appendChild(o);
    });
    fitLab.appendChild(fitSel);

    const alignLab = document.createElement("label");
    alignLab.className = "staging-frame-panel__field-label";
    alignLab.textContent = "Image alignment";
    const alignSel = document.createElement("select");
    alignSel.className = "staging-frame-panel__select";
    [
      ["center", "Center"],
      ["top", "Top"],
      ["bottom", "Bottom"],
      ["left", "Left"],
      ["right", "Right"],
    ].forEach(([v, lab]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lab;
      alignSel.appendChild(o);
    });
    alignLab.appendChild(alignSel);

    const maxWLab = document.createElement("label");
    maxWLab.className = "staging-frame-panel__field-label";
    maxWLab.textContent = "Max width (optional)";
    const maxWIn = document.createElement("input");
    maxWIn.type = "text";
    maxWIn.className = "staging-frame-panel__input";
    maxWLab.appendChild(maxWIn);

    const scaleLab = document.createElement("label");
    scaleLab.className = "staging-frame-panel__field-label";
    scaleLab.textContent = "Scale (%)";
    const scaleIn = document.createElement("input");
    scaleIn.type = "number";
    scaleIn.className = "staging-frame-panel__input staging-frame-panel__input--narrow";
    scaleIn.min = String(FRAME_CELL_SCALE_MIN);
    scaleIn.max = String(FRAME_CELL_SCALE_MAX);
    scaleIn.step = "1";
    scaleIn.value = "100";
    scaleLab.appendChild(scaleIn);

    const imageLinkLab = document.createElement("label");
    imageLinkLab.className = "staging-frame-panel__field-label";
    imageLinkLab.textContent = "Link image to page (optional)";
    const imagePageSel = document.createElement("select");
    imagePageSel.className = "staging-frame-panel__select staging-frame-panel__select--page-link";
    imagePageSel.setAttribute("aria-label", "Image link to site page");
    imageLinkLab.appendChild(imagePageSel);
    const imageLinkIn = document.createElement("input");
    imageLinkIn.type = "hidden";
    imageLinkIn.dataset.field = "image-link-href";

    /** @type {import("./frame-site-pages.js").SitePageChoice[]} */
    let imageSitePages = [];

    async function refreshImageSitePages() {
      imageSitePages = await loadSitePageChoices(api);
      fillSitePageSelect(imagePageSel, imageSitePages, imageLinkIn.value, { noneLabel: "No link" });
    }

    void refreshImageSitePages();
    window.addEventListener("customdev-staging-site-structure-changed", () => {
      invalidateSitePageChoicesCache();
      void refreshImageSitePages();
    });

    imagePageSel.addEventListener("change", () => {
      imageLinkIn.value = imagePageSel.value.trim();
      bumpCellEditor();
    });

    imageWrap.appendChild(fitLab);
    imageWrap.appendChild(alignLab);
    imageWrap.appendChild(scaleLab);
    imageWrap.appendChild(maxWLab);
    imageWrap.appendChild(imageLinkLab);
    imageWrap.appendChild(imageLinkIn);

    const shapeWrap = document.createElement("div");
    shapeWrap.className = "staging-frame-panel__shape-style";
    shapeWrap.hidden = true;

    const shapeKindLab = document.createElement("label");
    shapeKindLab.className = "staging-frame-panel__field-label";
    shapeKindLab.textContent = "Shape";
    const shapeKindSel = document.createElement("select");
    shapeKindSel.className = "staging-frame-panel__select";
    SHAPE_KINDS.forEach((k) => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = k.charAt(0).toUpperCase() + k.slice(1);
      shapeKindSel.appendChild(o);
    });
    shapeKindLab.appendChild(shapeKindSel);

    const shapeAlignLab = document.createElement("label");
    shapeAlignLab.className = "staging-frame-panel__field-label";
    shapeAlignLab.textContent = "Alignment";
    const shapeAlignSel = document.createElement("select");
    shapeAlignSel.className = "staging-frame-panel__select";
    [
      ["center", "Center"],
      ["top", "Top"],
      ["bottom", "Bottom"],
      ["left", "Left"],
      ["right", "Right"],
      ["top-left", "Top left"],
      ["top-right", "Top right"],
      ["bottom-left", "Bottom left"],
      ["bottom-right", "Bottom right"],
    ].forEach(([v, lab]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lab;
      shapeAlignSel.appendChild(o);
    });
    shapeAlignLab.appendChild(shapeAlignSel);

    const shapeSizeModeLab = document.createElement("label");
    shapeSizeModeLab.className = "staging-frame-panel__field-label";
    shapeSizeModeLab.textContent = "Size on grid";
    const shapeSizeModeSel = document.createElement("select");
    shapeSizeModeSel.className = "staging-frame-panel__select";
    [
      ["keep_ratio", "Keep shape ratio"],
      ["stretch_grid", "Stretch to grid"],
    ].forEach(([v, lab]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lab;
      shapeSizeModeSel.appendChild(o);
    });
    shapeSizeModeLab.appendChild(shapeSizeModeSel);

    const shapeScaleLab = document.createElement("label");
    shapeScaleLab.className = "staging-frame-panel__field-label";
    shapeScaleLab.textContent = "Scale (%)";
    const shapeScaleIn = document.createElement("input");
    shapeScaleIn.type = "number";
    shapeScaleIn.className = "staging-frame-panel__input staging-frame-panel__input--narrow";
    shapeScaleIn.min = String(FRAME_CELL_SCALE_MIN);
    shapeScaleIn.max = String(FRAME_CELL_SCALE_MAX);
    shapeScaleIn.step = "1";
    shapeScaleIn.value = "40";
    shapeScaleLab.appendChild(shapeScaleIn);

    const shapeSizeLab = document.createElement("div");
    shapeSizeLab.className = "staging-frame-panel__field-label";
    shapeSizeLab.textContent = "Width / height (% of cell, or frame when positioned)";
    const shapeSizeRow = document.createElement("div");
    shapeSizeRow.className = "staging-frame-panel__placement-row";

    function makeShapeSizeField(caption) {
      const col = document.createElement("div");
      col.className = "staging-frame-panel__figma-field";
      const cap = document.createElement("span");
      cap.className = "staging-frame-panel__figma-caption";
      cap.textContent = caption;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.className = "staging-frame-panel__input staging-frame-panel__input--gap-pct";
      inp.min = String(FRAME_CELL_SCALE_MIN);
      inp.max = String(FRAME_CELL_SCALE_MAX);
      inp.step = "1";
      col.appendChild(cap);
      col.appendChild(inp);
      shapeSizeRow.appendChild(col);
      return inp;
    }

    const shapeWidthIn = makeShapeSizeField("Width %");
    const shapeHeightIn = makeShapeSizeField("Height %");

    const shapeRotLab = document.createElement("label");
    shapeRotLab.className = "staging-frame-panel__field-label";
    shapeRotLab.textContent = "Rotation (°)";
    const shapeRotIn = document.createElement("input");
    shapeRotIn.type = "number";
    shapeRotIn.className = "staging-frame-panel__input staging-frame-panel__input--narrow";
    shapeRotIn.min = "0";
    shapeRotIn.max = "360";
    shapeRotIn.step = "1";
    shapeRotLab.appendChild(shapeRotIn);

    const shapeRadiusLab = document.createElement("label");
    shapeRadiusLab.className = "staging-frame-panel__field-label";
    shapeRadiusLab.textContent = "Corner radius (% of shorter side)";
    const shapeRadiusIn = document.createElement("input");
    shapeRadiusIn.type = "number";
    shapeRadiusIn.className = "staging-frame-panel__input staging-frame-panel__input--narrow";
    shapeRadiusIn.min = "0";
    shapeRadiusIn.max = "50";
    shapeRadiusIn.step = "1";
    shapeRadiusLab.appendChild(shapeRadiusIn);

    function makeShapeColorBlock(caption, enableLabel) {
      const block = document.createElement("div");
      block.className = "staging-frame-panel__shape-color-block";
      const cap = document.createElement("div");
      cap.className = "staging-frame-panel__field-label";
      cap.textContent = caption;
      const enableLab = document.createElement("label");
      enableLab.className = "staging-frame-panel__link-style-check";
      const enableCb = document.createElement("input");
      enableCb.type = "checkbox";
      const enableSpan = document.createElement("span");
      enableSpan.textContent = enableLabel;
      enableLab.appendChild(enableCb);
      enableLab.appendChild(enableSpan);
      const picker = document.createElement("input");
      picker.type = "color";
      picker.className = "staging-frame-panel__link-style-picker";
      const hex = document.createElement("input");
      hex.type = "text";
      hex.className = "staging-frame-panel__input staging-frame-panel__link-style-hex";
      hex.placeholder = "#rrggbb";
      hex.spellcheck = false;
      const opacityLab = document.createElement("label");
      opacityLab.className = "staging-frame-panel__field-label";
      opacityLab.textContent = "Opacity (%)";
      const opacityIn = document.createElement("input");
      opacityIn.type = "number";
      opacityIn.className = "staging-frame-panel__input staging-frame-panel__input--narrow";
      opacityIn.min = "0";
      opacityIn.max = "100";
      opacityIn.step = "1";
      opacityLab.appendChild(opacityIn);
      block.appendChild(cap);
      block.appendChild(enableLab);
      block.appendChild(picker);
      block.appendChild(hex);
      block.appendChild(opacityLab);
      return { block, enableCb, picker, hex, opacityIn };
    }

    const fillBlock = makeShapeColorBlock("Fill", "Fill");
    const strokeBlock = makeShapeColorBlock("Stroke", "Stroke");

    const shapeStrokeWidthLab = document.createElement("label");
    shapeStrokeWidthLab.className = "staging-frame-panel__field-label";
    shapeStrokeWidthLab.textContent = "Stroke width (px)";
    const shapeStrokeWidthIn = document.createElement("input");
    shapeStrokeWidthIn.type = "number";
    shapeStrokeWidthIn.className = "staging-frame-panel__input staging-frame-panel__input--narrow";
    shapeStrokeWidthIn.min = "0";
    shapeStrokeWidthIn.max = "48";
    shapeStrokeWidthIn.step = "1";
    shapeStrokeWidthLab.appendChild(shapeStrokeWidthIn);

    const shapeLinkLab = document.createElement("label");
    shapeLinkLab.className = "staging-frame-panel__field-label";
    shapeLinkLab.textContent = "Link shape to page (optional)";
    const shapePageSel = document.createElement("select");
    shapePageSel.className = "staging-frame-panel__select staging-frame-panel__select--page-link";
    shapeLinkLab.appendChild(shapePageSel);
    const shapeLinkIn = document.createElement("input");
    shapeLinkIn.type = "hidden";

    /** @type {import("./frame-site-pages.js").SitePageChoice[]} */
    let shapeSitePages = [];

    async function refreshShapeSitePages() {
      shapeSitePages = await loadSitePageChoices(api);
      fillSitePageSelect(shapePageSel, shapeSitePages, shapeLinkIn.value, { noneLabel: "No link" });
    }
    void refreshShapeSitePages();
    window.addEventListener("customdev-staging-site-structure-changed", () => {
      invalidateSitePageChoicesCache();
      void refreshShapeSitePages();
    });

    shapePageSel.addEventListener("change", () => {
      shapeLinkIn.value = shapePageSel.value.trim();
      bumpCellEditor();
    });

    shapeWrap.appendChild(shapeKindLab);
    shapeWrap.appendChild(shapeSizeModeLab);
    shapeWrap.appendChild(shapeScaleLab);
    shapeWrap.appendChild(shapeSizeLab);
    shapeWrap.appendChild(shapeSizeRow);
    shapeWrap.appendChild(shapeAlignLab);
    shapeWrap.appendChild(shapeRotLab);
    shapeWrap.appendChild(shapeRadiusLab);
    shapeWrap.appendChild(fillBlock.block);
    shapeWrap.appendChild(strokeBlock.block);
    shapeWrap.appendChild(shapeStrokeWidthLab);
    shapeWrap.appendChild(shapeLinkLab);
    shapeWrap.appendChild(shapeLinkIn);

    function syncShapeColorBlock(block, enabled) {
      block.picker.disabled = !enabled;
      block.hex.disabled = !enabled;
      block.opacityIn.disabled = !enabled;
    }

    function syncShapeSizeFieldsVisibility() {
      const keep = shapeSizeModeSel.value === "keep_ratio";
      shapeScaleLab.hidden = !keep;
      shapeSizeLab.hidden = keep;
      shapeSizeRow.hidden = keep;
    }

    function applyShapeSizeModeSwitch() {
      if (shapeSizeModeSel.value === "keep_ratio") {
        const scale = clampFrameCellScalePct(
          Math.max(Number(shapeWidthIn.value) || 0, Number(shapeHeightIn.value) || 0),
          Number(shapeScaleIn.value) || 40,
        );
        shapeScaleIn.value = String(scale);
        shapeWidthIn.value = String(scale);
        shapeHeightIn.value = String(scale);
      } else {
        const scale = clampFrameCellScalePct(shapeScaleIn.value, Number(shapeWidthIn.value) || 40);
        shapeWidthIn.value = String(scale);
        shapeHeightIn.value = String(scale);
      }
      syncShapeSizeFieldsVisibility();
    }

    function syncShapePanelVisibility() {
      shapeRadiusLab.hidden = shapeKindSel.value !== "square";
      shapeStrokeWidthLab.hidden = !strokeBlock.enableCb.checked;
      syncShapeSizeFieldsVisibility();
    }

    function readShapeStyleFromMount() {
      const raw = mount.dataset.frameShapeStyle;
      if (!raw) {
        return {};
      }
      try {
        return JSON.parse(decodeURIComponent(raw));
      } catch (_e) {
        return {};
      }
    }

    function applyShapeStyleInputs(st) {
      const s = normalizeShapeStyle(st);
      shapeKindSel.value = s.shapeKind;
      shapeSizeModeSel.value = s.sizeMode;
      shapeScaleIn.value = String(shapeScalePctFromStyle(s));
      shapeWidthIn.value = String(s.widthPct);
      shapeHeightIn.value = String(s.heightPct);
      shapeAlignSel.value = s.objectAlign;
      shapeRotIn.value = String(s.rotationDeg);
      shapeRadiusIn.value = String(s.cornerRadiusPct);
      fillBlock.enableCb.checked = s.fillEnabled;
      fillBlock.hex.value = s.fillColor;
      if (/^#[0-9a-f]{6}$/i.test(s.fillColor)) {
        fillBlock.picker.value = s.fillColor;
      }
      fillBlock.opacityIn.value = String(s.fillOpacityPct);
      strokeBlock.enableCb.checked = s.strokeEnabled;
      strokeBlock.hex.value = s.strokeColor;
      if (/^#[0-9a-f]{6}$/i.test(s.strokeColor)) {
        strokeBlock.picker.value = s.strokeColor;
      }
      strokeBlock.opacityIn.value = String(s.strokeOpacityPct);
      shapeStrokeWidthIn.value = String(s.strokeWidthPx);
      shapeLinkIn.value = s.linkHref;
      fillSitePageSelect(shapePageSel, shapeSitePages, s.linkHref, { noneLabel: "No link" });
      syncShapeColorBlock(fillBlock, s.fillEnabled);
      syncShapeColorBlock(strokeBlock, s.strokeEnabled);
      syncShapePanelVisibility();
      fillPlacementFromStyle(s);
    }

    function readShapeStyleFromForm() {
      const sizeMode = shapeSizeModeSel.value === "stretch_grid" ? "stretch_grid" : "keep_ratio";
      const scale = clampFrameCellScalePct(shapeScaleIn.value, 40);
      return normalizeShapeStyle({
        shapeKind: shapeKindSel.value,
        sizeMode,
        widthPct: sizeMode === "keep_ratio" ? scale : shapeWidthIn.value,
        heightPct: sizeMode === "keep_ratio" ? scale : shapeHeightIn.value,
        objectAlign: shapeAlignSel.value,
        rotationDeg: shapeRotIn.value,
        cornerRadiusPct: shapeRadiusIn.value,
        fillEnabled: fillBlock.enableCb.checked,
        fillColor: sanitizeShapeColor(fillBlock.hex.value || fillBlock.picker.value) || "#000000",
        fillOpacityPct: fillBlock.opacityIn.value,
        strokeEnabled: strokeBlock.enableCb.checked,
        strokeColor: sanitizeShapeColor(strokeBlock.hex.value || strokeBlock.picker.value) || "#000000",
        strokeOpacityPct: strokeBlock.opacityIn.value,
        strokeWidthPx: shapeStrokeWidthIn.value,
        linkHref: sanitizeNavUrl(shapeLinkIn.value),
        ...readPlacementFromPanel(),
      });
    }

    fillBlock.enableCb.addEventListener("change", () => {
      syncShapeColorBlock(fillBlock, fillBlock.enableCb.checked);
      bumpCellEditor();
    });
    strokeBlock.enableCb.addEventListener("change", () => {
      syncShapeColorBlock(strokeBlock, strokeBlock.enableCb.checked);
      syncShapePanelVisibility();
      bumpCellEditor();
    });
    fillBlock.picker.addEventListener("input", () => {
      fillBlock.hex.value = fillBlock.picker.value;
      bumpCellEditor();
    });
    strokeBlock.picker.addEventListener("input", () => {
      strokeBlock.hex.value = strokeBlock.picker.value;
      bumpCellEditor();
    });
    [fillBlock.hex, strokeBlock.hex, fillBlock.opacityIn, strokeBlock.opacityIn].forEach((el) => {
      el.addEventListener("input", bumpCellEditor);
    });
    shapeScaleIn.addEventListener("input", () => {
      if (shapeSizeModeSel.value === "keep_ratio") {
        const scale = clampFrameCellScalePct(shapeScaleIn.value, 40);
        shapeWidthIn.value = String(scale);
        shapeHeightIn.value = String(scale);
      }
      bumpCellEditor();
    });
    [
      shapeKindSel,
      shapeAlignSel,
      shapeWidthIn,
      shapeHeightIn,
      shapeRotIn,
      shapeRadiusIn,
      shapeStrokeWidthIn,
    ].forEach((el) => {
      el.addEventListener("input", bumpCellEditor);
      el.addEventListener("change", bumpCellEditor);
    });
    shapeSizeModeSel.addEventListener("change", () => {
      applyShapeSizeModeSwitch();
      bumpCellEditor();
    });
    shapeKindSel.addEventListener("change", syncShapePanelVisibility);

    const imagePathWrap = document.createElement("div");
    imagePathWrap.className = "staging-frame-panel__image-path";
    imagePathWrap.hidden = true;

    const imagePickLab = document.createElement("label");
    imagePickLab.className = "staging-frame-panel__field-label";
    imagePickLab.textContent = "Image (assets/images, includes subfolders)";
    const imagePickRow = document.createElement("div");
    imagePickRow.className = "staging-frame-panel__image-pick-row";
    const imagePathSel = document.createElement("select");
    imagePathSel.className = "staging-frame-panel__select staging-frame-panel__select--image-path";
    const imageRefreshBtn = document.createElement("button");
    imageRefreshBtn.type = "button";
    imageRefreshBtn.className = "staging-frame-panel__mini-action";
    imageRefreshBtn.textContent = "Refresh list";
    imagePickRow.appendChild(imagePathSel);
    imagePickRow.appendChild(imageRefreshBtn);
    imagePickLab.appendChild(imagePickRow);

    const imagePathManualLab = document.createElement("label");
    imagePathManualLab.className = "staging-frame-panel__field-label";
    imagePathManualLab.textContent = "Path under assets/ (e.g. images/FarewellMrFuji/foo.png)";
    const imagePathIn = document.createElement("input");
    imagePathIn.type = "text";
    imagePathIn.className = "staging-frame-panel__input";
    imagePathIn.placeholder = "images/… or Folder/file.jpg";
    imagePathManualLab.appendChild(imagePathIn);

    imagePathWrap.appendChild(imagePickLab);
    imagePathWrap.appendChild(imagePathManualLab);

    function repopulateImageSelect(selectedPath) {
      fillAssetImageSelect(imagePathSel, getAssetImages(), selectedPath);
    }

    function applyImagePathInputs(stored) {
      const norm = normalizeStoredAssetImagePath(stored);
      repopulateImageSelect(norm);
      imagePathIn.value = norm;
    }

    function readImageBodyFromForm() {
      const manual = imagePathIn.value.trim();
      const picked = imagePathSel.value.trim();
      const raw = manual || picked;
      return normalizeStoredAssetImagePath(raw);
    }

    refreshImagePickerFn = () => {
      repopulateImageSelect(readImageBodyFromForm());
    };

    function readTextStyleFromMount() {
      let ts = {};
      const raw = mount.dataset.frameTextStyle;
      if (raw) {
        try {
          ts = JSON.parse(decodeURIComponent(raw));
        } catch (_e) {
          ts = {};
        }
      }
      const fs = Number(ts.fontSize);
      if (!Number.isFinite(fs) || fs <= 0) {
        const textEl = mount.querySelector(".site-frame__cell-text");
        if (textEl) {
          const px = parseFloat(getComputedStyle(textEl).fontSize);
          if (Number.isFinite(px) && px > 0) {
            ts.fontSize = Math.round(px);
          }
        }
      }
      return ts;
    }

    function readImageStyleFromMount() {
      let im = {};
      const raw = mount.dataset.frameImageStyle;
      if (raw) {
        try {
          im = JSON.parse(decodeURIComponent(raw));
        } catch (_e) {
          im = {};
        }
      }
      return im;
    }

    function applyImageStyleInputs(im) {
      fitSel.value = im.objectFit || "contain";
      alignSel.value = im.objectAlign || "center";
      maxWIn.value = im.maxWidth || "";
      scaleIn.value = String(clampFrameCellScalePct(im.scalePct, 100));
      const link = typeof im.linkHref === "string" ? im.linkHref : "";
      imageLinkIn.value = link;
      fillSitePageSelect(imagePageSel, imageSitePages, link);
      fillPlacementFromStyle(im);
    }

    function applyTextStyleInputs(ts) {
      syncFontFamilySelectToValue(
        cellFontSel,
        cellFontCustomIn,
        typeof ts.fontFamily === "string" ? ts.fontFamily : "",
        fonts,
      );
      cellFontCustomIn.hidden = cellFontSel.value !== fontFamilyCustomValue;
      ffSizeIn.value = String(Math.min(288, Math.max(8, Number(ts.fontSize) || 16)));
      lhIn.value = String(Math.min(250, Math.max(50, Number(ts.lineHeightPct) || 100)));
      if (linkStyleEditor) {
        linkStyleEditor.apply(ts.linkStyle);
      }
    }

    function applyBodyBlocksToEditor(blocks) {
      editorBlocks = expandMultilineTextBlocks(blocks);
      bodyBlocksEditor.setBlocks(editorBlocks);
    }

    function syncTextFieldsVisibility() {
      const ct =
        typeSel.value === "stack" && stackEditor ? stackEditor.getActiveLayerType() : typeSel.value;
      textWrap.hidden = ct !== "text";
      imageWrap.hidden = ct !== "image";
      shapeWrap.hidden = ct !== "shape";
      syncPlacementWrapVisibility(ct);
    }

    /** @type {ReturnType<typeof mountStackLayerControls> | null} */
    let stackEditor = null;

    function syncBodyFieldVisibility() {
      const stackMode = typeSel.value === "stack";
      if (stackEditor) {
        stackEditor.setActive(stackMode);
      }
      const ct =
        stackMode && stackEditor ? stackEditor.getActiveLayerType() : typeSel.value;
      bodyLab.hidden = stackMode || ct === "empty" || ct === "text" || ct === "image" || ct === "shape";
      bodyBlocksHost.hidden = ct !== "text";
      imagePathWrap.hidden = ct !== "image";
      if (ct === "empty") {
        ta.value = "";
      } else if (ct === "image") {
        bodyCap.textContent = "Image";
      } else if (ct === "html") {
        bodyCap.textContent = "HTML";
      } else if (ct === "text") {
        bodyCap.textContent = "Content blocks";
      } else {
        bodyCap.textContent = "Text";
      }
      syncTaPlaceholder(typeSel, ta);
      syncTextFieldsVisibility();
    }

    function ensureTextTypeForBodyEdit() {
      if (typeSel.value === "empty") {
        typeSel.value = "text";
        copyFrameTypographyToCell(cellFontSel, cellFontCustomIn, ffSizeIn);
        layoutTypoBound.add(String(idx));
        if (!bodyBlocksEditor.getBlocks().length) {
          applyBodyBlocksToEditor([{ type: "text", value: "" }]);
        }
        syncBodyFieldVisibility();
      }
    }

    let cellPadSidesExpanded =
      cellPadSidesExpandedByIndex.get(String(idx)) ||
      cellPaddingSidesDiffer(cellDrafts.get(String(idx))?.cellPadding);
    cellPadSidesGrid.hidden = !cellPadSidesExpanded;
    cellPadEditSidesBtn.textContent = cellPadSidesExpanded ? "Uniform padding" : "Edit sides";

    function syncCellPadInputsFromDraft(cell) {
      fillCellPaddingInputs(
        cellPadUniformIn,
        cellPadTopIn,
        cellPadRightIn,
        cellPadBottomIn,
        cellPadLeftIn,
        cell && cell.cellPadding,
      );
      const differs = cellPaddingSidesDiffer(cell && cell.cellPadding);
      if (differs) {
        cellPadSidesExpanded = true;
        cellPadSidesExpandedByIndex.set(String(idx), true);
        cellPadSidesGrid.hidden = false;
        cellPadEditSidesBtn.textContent = "Uniform padding";
      }
    }

    function buildDraftCellFromForm() {
      const ct = typeSel.value;
      const cellId = parseInt(cid, 10);
      const prev = cellDrafts.get(String(idx));
      if (ct === "stack" && stackEditor) {
        return {
          id: cellId,
          contentType: "stack",
          body: stackEditor.getBody(),
          layers: stackEditor.getLayers(),
          cellRole: roleIn.value,
          cellPadding: readCellPaddingFromPanel(
            cellPadUniformIn,
            cellPadTopIn,
            cellPadRightIn,
            cellPadBottomIn,
            cellPadLeftIn,
            cellPadSidesExpanded,
          ),
          textStyle: null,
        };
      }
      let body = "";
      if (ct === "empty") {
        body = "";
      } else if (ct === "image") {
        body = readImageBodyFromForm();
      } else if (ct === "text") {
        body = blocksToPlainBody(bodyBlocksEditor.getBlocks());
      } else {
        body = ta.value;
      }
      const prevTextPad =
        prev && prev.textStyle && typeof prev.textStyle.padding === "string" ? prev.textStyle.padding : "";
      /** @type {object} */
      const cell = {
        id: cellId,
        contentType: ct,
        body,
        cellRole: roleIn.value,
        cellPadding: readCellPaddingFromPanel(
          cellPadUniformIn,
          cellPadTopIn,
          cellPadRightIn,
          cellPadBottomIn,
          cellPadLeftIn,
          cellPadSidesExpanded,
        ),
        textStyle: null,
      };
      if (ct === "text") {
        const fs = parseInt(String(ffSizeIn.value), 10) || 16;
        const lh = parseInt(String(lhIn.value), 10) || 100;
        const blocks = normalizeBodyBlocks(bodyBlocksEditor.getBlocks());
        cell.textStyle = {
          fontFamily: resolveFontFamilyFromSelect(cellFontSel, cellFontCustomIn),
          fontSize: Math.min(288, Math.max(8, fs)),
          lineHeightPct: Math.min(250, Math.max(50, lh)),
          padding: prevTextPad,
          navUrl: "",
          navLabel: "",
          bodyBlocks: blocks,
          linkStyle: linkStyleEditor ? linkStyleEditor.read() : undefined,
        };
      }
      if (ct === "image") {
        const scale = parseInt(String(scaleIn.value), 10) || 100;
        cell.imageStyle = {
          objectFit: fitSel.value,
          objectAlign: alignSel.value,
          maxWidth: maxWIn.value.trim(),
          scalePct: clampFrameCellScalePct(scale, 100),
          linkHref: sanitizeNavUrl(imageLinkIn.value),
          ...readPlacementFromPanel(),
        };
      }
      if (ct === "shape") {
        cell.shapeStyle = readShapeStyleFromForm();
      }
      return cell;
    }

    linkStyleEditor = mountTextLinkStyleEditor(textWrap, {
      onChange: () => {
        if (typeof bumpCellEditor === "function") {
          bumpCellEditor();
        }
      },
    });

    function bumpCellEditor() {
      const mountEl = liveMount();
      if (!mountEl) {
        return;
      }
      const cell = buildDraftCellFromForm();
      const ixKey = String(idx);
      cellDrafts.set(ixKey, cell);
      applyCellToMount(/** @type {HTMLElement} */ (mountEl), cell);
      updateLayoutTypoBindingForCell(ixKey, cell);
      updateChipDirtyState();
      refreshCellList();
    }

    flushActiveCellDraft = () => {
      const mountEl = liveMount();
      const cell = buildDraftCellFromForm();
      cellDrafts.set(String(idx), cell);
      if (mountEl) {
        applyCellToMount(/** @type {HTMLElement} */ (mountEl), cell);
      }
    };

    stackEditor = mountStackLayerControls({
      buildLayerFromForm: () => {
        const savedType = typeSel.value;
        if (savedType === "stack" && stackEditor) {
          typeSel.value = stackEditor.getActiveLayerType();
        }
        const layerCell = buildDraftCellFromForm();
        typeSel.value = savedType;
        return normalizeStackLayer({
          type: layerCell.contentType,
          body: layerCell.body,
          textStyle: layerCell.textStyle,
          imageStyle: layerCell.imageStyle,
          shapeStyle: layerCell.shapeStyle,
        });
      },
      fillFormFromLayer: (layer) => {
        fillFormFromCellDraft({
          contentType: layer.type,
          body: layer.body,
          textStyle: layer.textStyle,
          imageStyle: layer.imageStyle,
          shapeStyle: layer.shapeStyle,
          cellRole: roleIn.value,
          cellPadding: cellDrafts.get(String(idx))?.cellPadding,
        });
        syncBodyFieldVisibility();
      },
      onChange: () => bumpCellEditor(),
    });

    function fillFormFromCellDraft(cell) {
      let ct = (cell.contentType || "empty").toLowerCase();
      if (ct === "table") {
        ct = "html";
      }
      if (ct === "stack" && stackEditor) {
        typeSel.value = "stack";
        roleIn.value = cell.cellRole != null ? String(cell.cellRole) : "";
        syncCellPadInputsFromDraft(cell);
        stackEditor.loadFromCell(cell);
        syncBodyFieldVisibility();
        return;
      }
      typeSel.value = ct;
      roleIn.value = cell.cellRole != null ? String(cell.cellRole) : "";
      syncCellPadInputsFromDraft(cell);
      if (ct === "image") {
        ta.value = "";
        applyImagePathInputs(cell.body != null ? String(cell.body) : "");
        applyImageStyleInputs(cell.imageStyle || readImageStyleFromMount());
      } else if (ct === "shape") {
        ta.value = "";
        applyShapeStyleInputs(cell.shapeStyle || readShapeStyleFromMount() || DEFAULT_SHAPE_STYLE);
      } else if (ct === "text") {
        ta.value = "";
        const ts = cell.textStyle || readTextStyleFromMount();
        applyTextStyleInputs(ts);
        applyBodyBlocksToEditor(resolveBodyBlocks(ts, cell.body != null ? String(cell.body) : ""));
      } else if (ct === "html") {
        ta.value = cell.body != null ? String(cell.body) : "";
      } else {
        ta.value = "";
      }
      syncBodyFieldVisibility();
    }

    const existingDraft = cellDrafts.get(String(idx));
    if (existingDraft) {
      fillFormFromCellDraft(existingDraft);
    } else if ((mount.dataset.frameContentType || "").toLowerCase() === "text" && mount.dataset.frameTextStyle) {
      fillFormFromCellDraft({
        contentType: "text",
        body: "",
        cellRole: mount.dataset.frameCellRole || "",
        textStyle: readTextStyleFromMount(),
      });
    } else {
      let ct = (mount.dataset.frameContentType || "empty").toLowerCase();
      if (!["empty", "html", "image", "text", "shape", "stack"].includes(ct)) {
        ct = mount.querySelector("img.site-frame__cell-image")
          ? "image"
          : mount.querySelector("svg.site-frame__cell-shape")
            ? "shape"
            : mount.querySelector(".site-frame__cell-text")
              ? "text"
              : "empty";
      }
      fillFormFromCellDraft({ contentType: ct, body: "", cellRole: mount.dataset.frameCellRole || "" });
    }
    bumpCellEditor();

    syncBodyFieldVisibility();

    const wireBump = () => bumpCellEditor();

    placementResetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearPlacementOnSelectedCell();
    });
    placementCenterBtn.addEventListener("click", (e) => {
      e.preventDefault();
      applyPlacementToSelectedCell({ placementLeftPct: 50, placementTopPct: 50 });
    });
    placementPosXIn.addEventListener("input", wireBump);
    placementPosYIn.addEventListener("input", wireBump);

    repopulateImageSelect("");
    imagePathSel.addEventListener("change", () => {
      imagePathIn.value = imagePathSel.value;
      wireBump();
    });
    imagePathIn.addEventListener("input", wireBump);
    imageRefreshBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void refreshAssetImages().then(() => {
        if (refreshImagePickerFn) {
          refreshImagePickerFn();
        }
        bumpCellEditor();
      });
    });

    roleIn.addEventListener("input", wireBump);
    cellFontCustomIn.addEventListener("input", wireBump);
    cellFontSel.addEventListener("change", wireBump);
    ffSizeIn.addEventListener("input", wireBump);
    lhIn.addEventListener("input", wireBump);
    cellPadUniformIn.addEventListener("input", wireBump);
    cellPadTopIn.addEventListener("input", wireBump);
    cellPadRightIn.addEventListener("input", wireBump);
    cellPadBottomIn.addEventListener("input", wireBump);
    cellPadLeftIn.addEventListener("input", wireBump);
    fitSel.addEventListener("change", wireBump);
    alignSel.addEventListener("change", wireBump);
    scaleIn.addEventListener("input", wireBump);
    maxWIn.addEventListener("input", wireBump);
    ta.addEventListener("focus", ensureTextTypeForBodyEdit);
    ta.addEventListener("input", () => {
      ensureTextTypeForBodyEdit();
      bumpCellEditor();
    });
    typeSel.addEventListener("change", () => {
      if (typeSel.value === "stack" && stackEditor) {
        const prev = cellDrafts.get(String(idx));
        if (prev && String(prev.contentType || "").toLowerCase() === "stack") {
          stackEditor.loadFromCell(prev);
        } else {
          const saved = typeSel.value;
          typeSel.value =
            prev && prev.contentType && prev.contentType !== "stack"
              ? String(prev.contentType)
              : "text";
          stackEditor.seedFromSingleLayer(buildDraftCellFromForm());
          typeSel.value = "stack";
        }
      }
      if (typeSel.value === "shape") {
        const prevCt = (cellDrafts.get(String(idx))?.contentType || "").toLowerCase();
        if (prevCt !== "shape") {
          applyShapeStyleInputs(DEFAULT_SHAPE_STYLE);
        }
      }
      syncBodyFieldVisibility();
      bumpCellEditor();
    });

    cellPadEditSidesBtn.addEventListener("click", () => {
      cellPadSidesExpanded = !cellPadSidesExpanded;
      cellPadSidesExpandedByIndex.set(String(idx), cellPadSidesExpanded);
      cellPadSidesGrid.hidden = !cellPadSidesExpanded;
      cellPadEditSidesBtn.textContent = cellPadSidesExpanded ? "Uniform padding" : "Edit sides";
      if (!cellPadSidesExpanded && cellPadUniformIn.value) {
        const u = cellPadUniformIn.value;
        cellPadTopIn.value = u;
        cellPadRightIn.value = u;
        cellPadBottomIn.value = u;
        cellPadLeftIn.value = u;
      }
      bumpCellEditor();
    });

    useFrameTypBtn.addEventListener("click", () => {
      copyFrameTypographyToCell(cellFontSel, cellFontCustomIn, ffSizeIn);
      layoutTypoBound.add(String(idx));
      bumpCellEditor();
    });

    usePageFontBtn.addEventListener("click", () => {
      loadPageFontDefaults().then((pf) => {
        syncFontFamilySelectToValue(cellFontSel, cellFontCustomIn, pf.fontFamily || "", fonts);
        cellFontCustomIn.hidden = cellFontSel.value !== fontFamilyCustomValue;
        ffSizeIn.value = String(Math.min(288, Math.max(8, pf.fontSize || 16)));
        layoutTypoBound.delete(String(idx));
        bumpCellEditor();
      });
    });

    addTextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const wasText = typeSel.value === "text";
      typeSel.value = "text";
      syncTaPlaceholder(typeSel, ta);
      if (!wasText) {
        copyFrameTypographyToCell(cellFontSel, cellFontCustomIn, ffSizeIn);
        layoutTypoBound.add(String(idx));
      }
        syncBodyFieldVisibility();
        if (!bodyBlocksEditor.getBlocks().length) {
          applyBodyBlocksToEditor([{ type: "text", value: "" }]);
        }
        bumpCellEditor();
        const firstTa = bodyBlocksHost.querySelector("textarea");
        if (firstTa) {
          firstTa.focus();
        }
      });

    function buildCellPatchPayload() {
      const draft = buildDraftCellFromForm();
      const ct = String(draft.contentType || "empty")
        .trim()
        .toLowerCase();
      /** @type {Record<string, unknown>} */
      const payload = {
        id: draft.id,
        contentType: ct === "table" ? "html" : ct,
        body: draft.body,
        cellRole: draft.cellRole,
        cellPadding: cellPaddingForApi(draft.cellPadding),
      };
      if (ct === "text" && draft.textStyle) {
        payload.textStyle = draft.textStyle;
      }
      if (ct === "image" && draft.imageStyle) {
        payload.imageStyle = draft.imageStyle;
      }
      if (ct === "shape") {
        payload.shapeStyle = normalizeShapeStyle(
          draft.shapeStyle && typeof draft.shapeStyle === "object"
            ? draft.shapeStyle
            : readShapeStyleFromForm(),
        );
        payload.body = "";
      }
      if (ct === "stack" && Array.isArray(draft.layers)) {
        payload.layers = draft.layers;
      }
      return payload;
    }

    cellSaveHandlers.set(String(idx), {
      save() {
        return fetch(api + "/api/frame/cell", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify(buildCellPatchPayload()),
        })
          .then(async (r) => {
            if (!r.ok) {
              const errText = await r.text().catch(() => "");
              let msg = "HTTP " + r.status;
              try {
                const parsed = JSON.parse(errText);
                if (parsed && parsed.error) {
                  msg = String(parsed.error);
                }
              } catch (_e) {
                if (errText.trim()) {
                  msg = errText.trim().slice(0, 240);
                }
              }
              throw new Error(msg);
            }
            return r.json();
          })
          .then((out) => {
            const cell = out && out.cell;
            if (cell) {
              const ixKey = String(idx);
              cellDrafts.set(ixKey, cell);
              const mountEl = liveMount();
              if (mountEl) {
                applyCellToMount(/** @type {HTMLElement} */ (mountEl), cell);
              }
              updateLayoutTypoBindingForCell(ixKey, cell);
              fillFormFromCellDraft(cell);
              if (typeof onCellSaved === "function") {
                onCellSaved(cell);
              }
            }
            updateChipDirtyState();
            return out;
          });
      },
    });

    inner.appendChild(cellQuickRow);
    inner.appendChild(roleLab);
    inner.appendChild(typeSel);
    if (stackEditor) {
      inner.appendChild(stackEditor.element);
    }
    inner.appendChild(cellPadLab);
    inner.appendChild(placementWrap);
    inner.appendChild(bodyBlocksHost);
    inner.appendChild(bodyLab);
    inner.appendChild(imagePathWrap);
    inner.appendChild(textWrap);
    inner.appendChild(imageWrap);
    inner.appendChild(shapeWrap);
    cellEditorHost.appendChild(inner);
  }

  function clearImagePickerRefresh() {
    refreshImagePickerFn = null;
  }

  function refreshEditor() {
    if (selectedCellIndex == null) {
      const first = root.querySelector("[data-frame-cell-index][data-frame-cell-id]");
      if (first) {
        selectedCellIndex = first.getAttribute("data-frame-cell-index");
      }
    } else {
      const still = root.querySelector(
        `[data-frame-cell-index="${selectedCellIndex}"][data-frame-cell-id]`,
      );
      if (!still) {
        selectedCellIndex = null;
      }
    }
    refreshCellList();
    updateMountSelectionHighlight();
    updateCellPickHeading();
    mountSelectedCellEditor();
  }

  function onFrameRootClick(e) {
    if (panelHidden()) {
      return;
    }
    const mount = /** @type {HTMLElement | null} */ (
      e.target instanceof Element ? e.target.closest("[data-frame-cell-index]") : null
    );
    if (!mount || !root.contains(mount)) {
      return;
    }
    if (e.target instanceof Element && e.target.closest(".site-frame__staging-label-row")) {
      return;
    }
    const ix = mount.getAttribute("data-frame-cell-index");
    if (ix != null) {
      selectCell(ix);
    }
  }

  /** @type {() => boolean} */
  let panelHidden = () => true;

  function wireMountClick(isPanelHidden) {
    panelHidden = isPanelHidden;
    root.addEventListener("click", onFrameRootClick);
  }

  function teardownMountClick() {
    root.removeEventListener("click", onFrameRootClick);
  }

  const teardownPlacementDrag = mountFrameCellPlacementDrag({
    root,
    getSelectedCellIndex: () => selectedCellIndex,
    onPlacementChange: (placement) => {
      applyPlacementToSelectedCell(placement);
    },
  });

  return {
    refreshEditor,
    refreshAssetImagePickers: () => {
      if (refreshImagePickerFn) {
        refreshImagePickerFn();
      }
    },
    flushActiveCellDraft: () => {
      if (typeof flushActiveCellDraft === "function") {
        flushActiveCellDraft();
      }
    },
    selectCell,
    wireMountClick,
    teardownMountClick,
    teardownPlacementDrag,
    getSelectedCellIndex: () => selectedCellIndex,
    clearSelection: () => {
      selectedCellIndex = null;
      clearImagePickerRefresh();
    },
  };
}
