/**
 * Reusable: main wrapper + comma-separated fr ratios for CSS grid columns/rows.
 */

/**
 * @param {string} ratioCsv – comma-separated positive weights, e.g. `"1,3"`
 * @returns {number[]}
 */
export function parseRatioCsv(ratioCsv) {
  if (typeof ratioCsv !== "string" || !ratioCsv.trim()) {
    throw new Error("parseRatioCsv: non-empty ratio string required");
  }
  const segments = ratioCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const weights = segments.map((s) => Number(s));
  if (weights.length !== segments.length || weights.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error("parseRatioCsv: each segment must be a positive number");
  }
  return weights;
}

/**
 * Builds `grid-template-*` track list: `minmax(0, w1fr) minmax(0, w2fr) …` for use in CSS or inline styles.
 *
 * @param {number} count – must match the number of comma-separated ratios
 * @param {string} ratioCsv – e.g. `"1,3"` for a 1∶3 split of the wrapper along that axis
 * @returns {string}
 */
export function buildDividedGridTracks(count, ratioCsv) {
  const weights = parseRatioCsv(ratioCsv);
  if (weights.length !== count) {
    throw new Error(
      `buildDividedGridTracks: count is ${count} but ratio string has ${weights.length} values`,
    );
  }
  return weights.map((w) => `minmax(0, ${w}fr)`).join(" ");
}

/**
 * Sets `display: grid` and `grid-template-columns` or `grid-template-rows` from ratio weights.
 *
 * @param {HTMLElement} el
 * @param {"columns" | "rows"} axis – `columns` → vertical dividers (left/right tracks); `rows` → horizontal
 * @param {number} count
 * @param {string} ratioCsv
 */
export function applyGridDividers(el, axis, count, ratioCsv) {
  if (!el) {
    throw new Error("applyGridDividers: element required");
  }
  const tracks = buildDividedGridTracks(count, ratioCsv);
  el.style.display = "grid";
  if (axis === "columns") {
    el.style.gridTemplateColumns = tracks;
    el.style.removeProperty("grid-template-rows");
  } else {
    el.style.gridTemplateRows = tracks;
    el.style.removeProperty("grid-template-columns");
  }
}

/**
 * Inserts `<div class="main-wrapper">` around the first `<main>` if not already wrapped.
 * Optionally applies {@link applyGridDividers} on the wrapper.
 *
 * @param {{
 *   mainSelector?: string,
 *   dividers?: { axis: "columns" | "rows", count: number, ratioCsv: string },
 * }} [options]
 * @returns {HTMLElement | null} the wrapper, or null if skipped
 */
export function mountMainWrapper(options) {
  const opts = options || {};
  const selector = opts.mainSelector ? opts.mainSelector : "main";
  const main = document.querySelector(selector);
  if (!main || main.parentElement?.classList.contains("main-wrapper")) {
    return null;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "main-wrapper";
  main.parentNode.insertBefore(wrapper, main);
  wrapper.appendChild(main);
  if (opts.dividers) {
    const d = opts.dividers;
    applyGridDividers(wrapper, d.axis, d.count, d.ratioCsv);
  }
  return wrapper;
}
