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
import { mountTextLinkStyleEditor } from "./frame-text-link-style.js";

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

  function mountSelectedCellEditor() {
    clearImagePickerRefresh();
    flushActiveCellDraft = null;
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
    cellPadLab.textContent = "Cell padding (% of mount)";

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
    scaleIn.min = "25";
    scaleIn.max = "250";
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
      scaleIn.value = String(Math.min(250, Math.max(25, Number(im.scalePct) || 100)));
      const link = typeof im.linkHref === "string" ? im.linkHref : "";
      imageLinkIn.value = link;
      fillSitePageSelect(imagePageSel, imageSitePages, link);
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
      textWrap.hidden = typeSel.value !== "text";
      imageWrap.hidden = typeSel.value !== "image";
    }

    function syncBodyFieldVisibility() {
      const ct = typeSel.value;
      bodyLab.hidden = ct === "empty" || ct === "text" || ct === "image";
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
      const cellId = parseInt(cid, 10);
      const prev = cellDrafts.get(String(idx));
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
          scalePct: Math.min(250, Math.max(25, scale)),
          linkHref: sanitizeNavUrl(imageLinkIn.value),
        };
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

    function fillFormFromCellDraft(cell) {
      let ct = (cell.contentType || "empty").toLowerCase();
      if (ct === "table") {
        ct = "html";
      }
      typeSel.value = ct;
      roleIn.value = cell.cellRole != null ? String(cell.cellRole) : "";
      syncCellPadInputsFromDraft(cell);
      if (ct === "image") {
        ta.value = "";
        applyImagePathInputs(cell.body != null ? String(cell.body) : "");
        applyImageStyleInputs(cell.imageStyle || readImageStyleFromMount());
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
      if (!["empty", "html", "image", "text"].includes(ct)) {
        ct = mount.querySelector("img.site-frame__cell-image")
          ? "image"
          : mount.querySelector(".site-frame__cell-text")
            ? "text"
            : "empty";
      }
      fillFormFromCellDraft({ contentType: ct, body: "", cellRole: mount.dataset.frameCellRole || "" });
    }
    bumpCellEditor();

    syncBodyFieldVisibility();

    const wireBump = () => bumpCellEditor();

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
      /** @type {Record<string, unknown>} */
      const payload = {
        id: draft.id,
        contentType: draft.contentType,
        body: draft.body,
        cellRole: draft.cellRole,
        cellPadding: cellPaddingForApi(draft.cellPadding),
      };
      if (draft.textStyle) {
        payload.textStyle = draft.textStyle;
      }
      if (draft.imageStyle) {
        payload.imageStyle = draft.imageStyle;
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
          .then((r) => {
            if (!r.ok) {
              throw new Error("HTTP " + r.status);
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
            }
            updateChipDirtyState();
            return out;
          });
      },
    });

    inner.appendChild(cellQuickRow);
    inner.appendChild(roleLab);
    inner.appendChild(typeSel);
    inner.appendChild(cellPadLab);
    inner.appendChild(bodyBlocksHost);
    inner.appendChild(bodyLab);
    inner.appendChild(imagePathWrap);
    inner.appendChild(textWrap);
    inner.appendChild(imageWrap);
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

  return {
    refreshEditor,
    refreshAssetImagePickers: () => {
      if (refreshImagePickerFn) {
        refreshImagePickerFn();
      }
    },
    selectCell,
    wireMountClick,
    teardownMountClick,
    getSelectedCellIndex: () => selectedCellIndex,
    clearSelection: () => {
      selectedCellIndex = null;
      clearImagePickerRefresh();
    },
  };
}
