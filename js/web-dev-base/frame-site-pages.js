/**
 * Site page list + relative href helpers for frame cell links (staging).
 */

import { sanitizeNavUrl } from "./frame-text-blocks.js";
import { resolveDefaultLayoutApiBase } from "./gallery-layout-from-db.js";

/** @typedef {{ id: number, name: string, href: string, label: string }} SitePageChoice */

let cachedApiBase = null;
/** @type {Promise<SitePageChoice[]> | null} */
let cachedPagesPromise = null;

/**
 * @param {string} pageName
 * @returns {string}
 */
export function pageNameToSiteHref(pageName, _isHome) {
  const name = String(pageName || "")
    .trim()
    .replace(/\.html$/i, "");
  const slug = name || "index";
  const onSubpage =
    typeof location !== "undefined" && /\/pages\//i.test(location.pathname || "");
  if (slug === "index") {
    return onSubpage ? "../index.html" : "index.html";
  }
  return onSubpage ? `${slug}.html` : `pages/${slug}.html`;
}

/**
 * @param {string} pageName
 * @returns {string}
 */
/**
 * @param {string} pageName
 * @param {{ isHome?: boolean }} [opts]
 * @returns {string}
 */
export function pageChoiceLabel(pageName, _opts = {}) {
  const n = String(pageName || "").trim() || "index";
  if (n === "index") {
    return "Homepage (index)";
  }
  return n;
}

/**
 * @param {string} href
 * @param {string} pageName
 * @returns {boolean}
 */
export function hrefMatchesPageName(href, pageName, _isHome) {
  const h = String(href || "").trim();
  if (!h) {
    return false;
  }
  const target = pageNameToSiteHref(pageName);
  if (h === target) {
    return true;
  }
  const slug = String(pageName || "")
    .trim()
    .replace(/\.html$/i, "");
  if (slug === "index") {
    return (
      h === "index.html" ||
      h === "/index.html" ||
      h === "./index.html" ||
      h === "../index.html" ||
      h === "/" ||
      h === "."
    );
  }
  const tail = `pages/${slug}.html`;
  return h === tail || h.endsWith(`/${tail}`) || h === `${slug}.html` || h.endsWith(`/${slug}.html`);
}

/**
 * @param {string} href
 * @param {SitePageChoice[]} pages
 * @returns {SitePageChoice | null}
 */
export function findPageChoiceForHref(href, pages) {
  const list = Array.isArray(pages) ? pages : [];
  for (let i = 0; i < list.length; i++) {
    if (hrefMatchesPageName(href, list[i].name)) {
      return list[i];
    }
  }
  return null;
}

/**
 * @param {string} [apiBase]
 * @returns {Promise<SitePageChoice[]>}
 */
export async function loadSitePageChoices(apiBase) {
  const base = String(apiBase || resolveDefaultLayoutApiBase()).trim().replace(/\/$/, "");
  if (!base) {
    return [];
  }
  if (cachedPagesPromise && cachedApiBase === base) {
    return cachedPagesPromise;
  }
  cachedApiBase = base;
  cachedPagesPromise = fetch(`${base}/api/registry`, { mode: "cors" })
    .then((r) => (r.ok ? r.json() : { pages: [] }))
    .then((data) => {
      const raw = Array.isArray(data && data.pages) ? data.pages : [];
      /** @type {SitePageChoice[]} */
      const out = [];
      const pageRows = Array.isArray(data && data.pages) ? data.pages : raw;
      for (let i = 0; i < pageRows.length; i++) {
        const p = pageRows[i];
        if (!p || typeof p.name !== "string") {
          continue;
        }
        const name = String(p.name).trim();
        if (!name) {
          continue;
        }
        const id = typeof p.id === "number" ? p.id : 0;
        out.push({
          id,
          name,
          href: pageNameToSiteHref(name),
          label: pageChoiceLabel(name),
        });
      }
      return out;
    })
    .catch(() => []);
  return cachedPagesPromise;
}

/** Clear cached registry pages (e.g. after structure dialog edits). */
export function invalidateSitePageChoicesCache() {
  cachedPagesPromise = null;
  cachedApiBase = null;
}

/**
 * @param {HTMLSelectElement} sel
 * @param {SitePageChoice[]} pages
 * @param {string} [selectedHref]
 */
export function fillSitePageSelect(sel, pages, selectedHref, options = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const match = findPageChoiceForHref(String(selectedHref || "").trim(), list);
  const noneLabel =
    options && typeof options.noneLabel === "string" && options.noneLabel.trim()
      ? options.noneLabel.trim()
      : "(custom URL)";
  sel.replaceChildren();
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = noneLabel;
  sel.appendChild(custom);
  for (let i = 0; i < list.length; i++) {
    const o = document.createElement("option");
    o.value = list[i].href;
    o.textContent = list[i].label;
    sel.appendChild(o);
  }
  sel.value = match ? match.href : "";
}

/**
 * @param {HTMLElement} parent
 * @param {{
 *   api: string,
 *   hrefInput: HTMLInputElement,
 *   onChange?: () => void,
 *   pageFieldLabel?: string,
 * }} opts
 * @returns {{ refresh: () => Promise<void>, teardown: () => void }}
 */
export function wirePageLinkPicker(parent, opts) {
  const api = String(opts.api || "").trim().replace(/\/$/, "");
  const hrefInput = opts.hrefInput;
  const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};

  const pageLab = document.createElement("label");
  pageLab.className = "staging-frame-panel__field-label";
  pageLab.textContent = opts.pageFieldLabel || "Page";
  const pageSel = document.createElement("select");
  pageSel.className = "staging-frame-panel__select staging-frame-panel__select--page-link";
  pageSel.setAttribute("aria-label", "Link to site page");
  pageLab.appendChild(pageSel);
  parent.insertBefore(pageLab, hrefInput.parentElement || null);

  /** @type {SitePageChoice[]} */
  let pages = [];

  function syncSelectFromHref() {
    fillSitePageSelect(pageSel, pages, hrefInput.value);
  }

  function onRegistryChanged() {
    invalidateSitePageChoicesCache();
    void refresh();
  }

  async function refresh() {
    pages = await loadSitePageChoices(api);
    syncSelectFromHref();
  }

  pageSel.addEventListener("change", () => {
    const v = pageSel.value.trim();
    if (v) {
      hrefInput.value = v;
      onChange();
    }
  });

  hrefInput.addEventListener("input", () => {
    const cleaned = sanitizeNavUrl(hrefInput.value);
    if (cleaned !== hrefInput.value) {
      hrefInput.value = cleaned;
    }
    syncSelectFromHref();
    onChange();
  });

  window.addEventListener("customdev-staging-site-structure-changed", onRegistryChanged);

  void refresh();

  return {
    refresh,
    teardown() {
      window.removeEventListener("customdev-staging-site-structure-changed", onRegistryChanged);
      pageLab.remove();
    },
  };
}
