/**
 * Inline text + links for frame text cells (`frame_cell_text.body_blocks` JSON).
 * @typedef {{ type: 'text', value: string, href?: string }} TextBlock
 * @typedef {{ type: 'link', href: string, label: string }} LinkBlock
 * @typedef {TextBlock | LinkBlock} BodyBlock
 */

import {
  fillSitePageSelect,
  invalidateSitePageChoicesCache,
  loadSitePageChoices,
} from "./frame-site-pages.js";

const MAX_TEXT_LEN = 8000;
const MAX_LABEL_LEN = 200;

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeNavUrl(raw) {
  const s = String(raw || "")
    .trim()
    .slice(0, 2000);
  if (!s) {
    return "";
  }
  const low = s.toLowerCase();
  if (low.startsWith("javascript:") || low.startsWith("data:") || low.startsWith("vbscript:")) {
    return "";
  }
  if (s.startsWith("#") || s.startsWith("/") || s.startsWith("?") || s.startsWith("./") || s.startsWith("../")) {
    return s;
  }
  if (low.startsWith("mailto:")) {
    return s;
  }
  if (low.startsWith("http://") || low.startsWith("https://")) {
    return s;
  }
  if (
    !/[\s<>"']/.test(s) &&
    /^[\w.%\-/+~]+\.html?(?:\?[\w&=%.\-+]*)?(?:#[\w%.-]*)?$/i.test(s)
  ) {
    return s;
  }
  return "";
}

/**
 * @param {unknown} raw
 * @returns {BodyBlock[]}
 */
export function normalizeBodyBlocks(raw) {
  /** @type {TextBlock[]} */
  const out = [];
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = /** @type {Record<string, unknown>} */ (item);
    const t = String(rec.type || "")
      .trim()
      .toLowerCase();
    if (t === "text") {
      let v = String(rec.value ?? "");
      v = v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, MAX_TEXT_LEN);
      const href = sanitizeNavUrl(String(rec.href ?? rec.linkHref ?? ""));
      if (!v) {
        continue;
      }
      /** @type {TextBlock} */
      const block = { type: "text", value: v };
      if (href) {
        block.href = href;
      }
      out.push(block);
    } else if (t === "link") {
      const href = sanitizeNavUrl(String(rec.href ?? rec.url ?? ""));
      if (!href) {
        continue;
      }
      const label = String(rec.label ?? "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
        .trim()
        .slice(0, MAX_LABEL_LEN);
      if (label) {
        out.push({ type: "text", value: label, href });
      } else if (out.length) {
        const prev = out[out.length - 1];
        if (prev.type === "text" && !prev.href) {
          prev.href = href;
        }
      }
    }
  }
  return out;
}

/**
 * One staging block per line so each phrase (e.g. a project name) can link to its own page.
 * @param {BodyBlock[]} blocks
 * @returns {TextBlock[]}
 */
export function expandMultilineTextBlocks(blocks) {
  const normalized = normalizeBodyBlocks(blocks);
  /** @type {TextBlock[]} */
  const out = [];
  for (let i = 0; i < normalized.length; i++) {
    const b = normalized[i];
    if (b.type !== "text") {
      continue;
    }
    if (b.href || !/\r?\n/.test(b.value)) {
      out.push(b);
      continue;
    }
    const lines = b.value.split(/\r?\n/);
    for (let j = 0; j < lines.length; j++) {
      const t = lines[j].replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
      if (t) {
        out.push({ type: "text", value: t });
      }
    }
  }
  return out.length ? out : normalized;
}

/**
 * @param {BodyBlock[]} blocks
 * @returns {string}
 */
export function blocksToPlainBody(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) {
    return "";
  }
  const lines = [];
  for (const b of normalizeBodyBlocks(blocks)) {
    if (b.type === "text" && b.value) {
      lines.push(b.value);
    }
  }
  return lines.join("\n");
}

/**
 * @param {string} body
 * @param {string} [navUrl]
 * @param {string} [navLabel]
 * @returns {BodyBlock[]}
 */
export function bodyBlocksFromLegacy(body, navUrl, navLabel) {
  const b = String(body || "").trim();
  const href = sanitizeNavUrl(navUrl || "");
  const label = String(navLabel || "")
    .trim()
    .slice(0, MAX_LABEL_LEN);
  if (href && label) {
    return [{ type: "text", value: label, href }];
  }
  if (href && b) {
    return [{ type: "text", value: b, href }];
  }
  if (b) {
    return expandMultilineTextBlocks([{ type: "text", value: b }]);
  }
  return [];
}

/**
 * @param {object | null | undefined} textStyle
 * @param {string} [body]
 * @returns {BodyBlock[]}
 */
export function resolveBodyBlocks(textStyle, body) {
  const ts = textStyle && typeof textStyle === "object" ? textStyle : {};
  const fromApi = normalizeBodyBlocks(ts.bodyBlocks);
  if (fromApi.length) {
    return expandMultilineTextBlocks(fromApi);
  }
  return expandMultilineTextBlocks(bodyBlocksFromLegacy(body, ts.navUrl, ts.navLabel));
}

/**
 * @param {HTMLElement} parent
 * @param {string} value
 */
function appendTextWithBreaks(parent, value) {
  const parts = String(value || "").split("\n");
  parts.forEach((part, i) => {
    if (part) {
      parent.appendChild(document.createTextNode(part));
    }
    if (i < parts.length - 1) {
      parent.appendChild(document.createElement("br"));
    }
  });
}

/**
 * @param {HTMLElement} anchor
 * @param {string} href
 */
function wireFrameTextLink(anchor, href) {
  anchor.href = href;
  anchor.rel = "noopener noreferrer";
  if (/^https?:/i.test(href)) {
    anchor.target = "_blank";
  }
}

/**
 * Sync page dropdown values into hidden href fields before reading blocks.
 * @param {ParentNode} root
 */
export function syncPageSelectsToHiddenHref(root) {
  if (!root) {
    return;
  }
  root.querySelectorAll('.staging-frame-panel__body-block[data-block-type="text"]').forEach((row) => {
    const pageSel = row.querySelector(".staging-frame-panel__select--page-link");
    const hrefIn = row.querySelector('[data-field="href"]');
    if (pageSel instanceof HTMLSelectElement && hrefIn instanceof HTMLInputElement) {
      hrefIn.value = pageSel.value.trim();
    }
  });
}

/**
 * @param {HTMLElement} p
 * @param {BodyBlock[]} blocks
 */
export function renderBodyBlocksIntoParagraph(p, blocks) {
  p.replaceChildren();
  const list = normalizeBodyBlocks(blocks);
  if (!list.length) {
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.type !== "text") {
      continue;
    }
    if (i > 0) {
      p.appendChild(document.createElement("br"));
    }
    if (b.href) {
      const a = document.createElement("a");
      wireFrameTextLink(a, b.href);
      a.textContent = b.value;
      p.appendChild(a);
    } else {
      appendTextWithBreaks(p, b.value);
    }
  }
}

/**
 * @param {BodyBlock[] | null | undefined} blocks
 * @returns {string}
 */
export function bodyBlocksSummary(blocks) {
  const plain = blocksToPlainBody(blocks).replace(/\s+/g, " ").trim();
  if (!plain) {
    return "(no text)";
  }
  return plain.length <= 72 ? plain : plain.slice(0, 71) + "…";
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   getBlocks: () => BodyBlock[],
 *   setBlocks: (blocks: BodyBlock[]) => void,
 *   onInput: () => void,
 *   layoutApiBase?: string,
 * }} opts
 */
export function mountTextBodyBlocksEditor(host, opts) {
  const layoutApiBase = opts && typeof opts.layoutApiBase === "string" ? opts.layoutApiBase.trim() : "";
  const root = document.createElement("div");
  root.className = "staging-frame-panel__body-blocks";
  const listEl = document.createElement("div");
  listEl.className = "staging-frame-panel__body-blocks-list";

  /** @type {import("./frame-site-pages.js").SitePageChoice[]} */
  let sitePageChoices = [];

  async function refreshSitePageChoices() {
    if (!layoutApiBase) {
      sitePageChoices = [];
      return;
    }
    sitePageChoices = await loadSitePageChoices(layoutApiBase);
    listEl.querySelectorAll(".staging-frame-panel__select--page-link").forEach((sel) => {
      if (!(sel instanceof HTMLSelectElement)) {
        return;
      }
      const row = sel.closest(".staging-frame-panel__body-block");
      const hrefIn = row && row.querySelector('[data-field="href"]');
      const href = hrefIn && "value" in hrefIn ? String(hrefIn.value) : "";
      fillSitePageSelect(sel, sitePageChoices, href, { noneLabel: "Not linked" });
    });
  }

  function onRegistryChanged() {
    invalidateSitePageChoicesCache();
    void refreshSitePageChoices();
  }

  if (layoutApiBase) {
    void refreshSitePageChoices();
    window.addEventListener("customdev-staging-site-structure-changed", onRegistryChanged);
  }

  function readBlocksFromDom() {
    syncPageSelectsToHiddenHref(listEl);
    /** @type {TextBlock[]} */
    const blocks = [];
    listEl.querySelectorAll('.staging-frame-panel__body-block[data-block-type="text"]').forEach((row) => {
      const ta = row.querySelector("textarea");
      if (!ta) {
        return;
      }
      const value = String(ta.value || "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
        .slice(0, MAX_TEXT_LEN);
      if (!value) {
        return;
      }
      const hrefIn = row.querySelector('[data-field="href"]');
      const href = sanitizeNavUrl(hrefIn && "value" in hrefIn ? String(hrefIn.value) : "");
      /** @type {TextBlock} */
      const block = { type: "text", value };
      if (href) {
        block.href = href;
      }
      blocks.push(block);
    });
    return normalizeBodyBlocks(blocks);
  }

  function emit() {
    opts.setBlocks(readBlocksFromDom());
    opts.onInput();
  }

  function wireInput(el) {
    el.addEventListener("input", emit);
  }

  /** @param {TextBlock} block */
  function appendTextBlockRow(block) {
    const row = document.createElement("div");
    row.className = "staging-frame-panel__body-block";
    row.setAttribute("data-block-type", "text");

    const head = document.createElement("div");
    head.className = "staging-frame-panel__body-block-head";
    const kindLab = document.createElement("span");
    kindLab.className = "staging-frame-panel__body-block-kind";
    kindLab.textContent = block.href ? "Text (linked)" : "Text";
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "staging-frame-panel__body-block-move";
    upBtn.textContent = "↑";
    upBtn.title = "Move up";
    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "staging-frame-panel__body-block-move";
    downBtn.textContent = "↓";
    downBtn.title = "Move down";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "staging-frame-panel__body-block-remove";
    delBtn.textContent = "Remove";
    head.appendChild(kindLab);
    head.appendChild(upBtn);
    head.appendChild(downBtn);
    head.appendChild(delBtn);
    row.appendChild(head);

    const ta = document.createElement("textarea");
    ta.className = "staging-frame-panel__textarea staging-frame-panel__textarea--block";
    ta.rows = 3;
    ta.value = block.value;
    ta.placeholder = "Line of text (what visitors see if linked)";
    wireInput(ta);
    row.appendChild(ta);

    const pageLab = document.createElement("label");
    pageLab.className = "staging-frame-panel__field-label";
    pageLab.textContent = "Link to page";
    const pageSel = document.createElement("select");
    pageSel.className = "staging-frame-panel__select staging-frame-panel__select--page-link";
    pageSel.setAttribute("aria-label", "Link this text to a site page");
    pageLab.appendChild(pageSel);
    fillSitePageSelect(pageSel, sitePageChoices, block.href || "", { noneLabel: "Not linked" });

    const hrefIn = document.createElement("input");
    hrefIn.type = "hidden";
    hrefIn.dataset.field = "href";
    hrefIn.value = block.href || "";

    pageSel.addEventListener("change", () => {
      hrefIn.value = pageSel.value.trim();
      kindLab.textContent = hrefIn.value ? "Text (linked)" : "Text";
      emit();
    });

    upBtn.addEventListener("click", () => {
      const prev = row.previousElementSibling;
      if (prev) {
        listEl.insertBefore(row, prev);
        emit();
      }
    });
    downBtn.addEventListener("click", () => {
      const next = row.nextElementSibling;
      if (next) {
        listEl.insertBefore(next, row);
        emit();
      }
    });
    delBtn.addEventListener("click", () => {
      row.remove();
      emit();
    });

    row.appendChild(pageLab);
    row.appendChild(hrefIn);
    listEl.appendChild(row);
  }

  function rebuild(blocks) {
    listEl.replaceChildren();
    const list = expandMultilineTextBlocks(blocks);
    if (!list.length) {
      appendTextBlockRow({ type: "text", value: "" });
    } else {
      list.forEach((b) => {
        if (b.type === "text") {
          appendTextBlockRow(b);
        }
      });
    }
  }

  const actions = document.createElement("div");
  actions.className = "staging-frame-panel__body-blocks-actions";
  const addTextBtn = document.createElement("button");
  addTextBtn.type = "button";
  addTextBtn.className = "staging-frame-panel__mini-action";
  addTextBtn.textContent = "Add text";
  addTextBtn.addEventListener("click", () => {
    appendTextBlockRow({ type: "text", value: "" });
    emit();
  });
  actions.appendChild(addTextBtn);

  root.appendChild(listEl);
  root.appendChild(actions);
  host.appendChild(root);

  rebuild(opts.getBlocks());

  return {
    setBlocks(blocks) {
      rebuild(blocks);
    },
    getBlocks() {
      syncPageSelectsToHiddenHref(listEl);
      return readBlocksFromDom();
    },
    teardown() {
      if (layoutApiBase) {
        window.removeEventListener("customdev-staging-site-structure-changed", onRegistryChanged);
      }
    },
  };
}
