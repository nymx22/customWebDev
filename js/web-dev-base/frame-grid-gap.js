/**
 * Frame grid gap: legacy CSS `gap` string or JSON `{ topPct, rightPct, bottomPct, leftPct }` (0–50).
 */

/** @typedef {{ type: 'css', css: string }} CssGridGap */
/** @typedef {{ type: 'pct', topPct: number, rightPct: number, bottomPct: number, leftPct: number }} PctGridGap */

const PCT_MAX = 50;

/**
 * @param {unknown} raw
 * @returns {CssGridGap | PctGridGap}
 */
export function parseGridGap(raw) {
  if (raw == null) {
    return { type: "pct", topPct: 0, rightPct: 0, bottomPct: 0, leftPct: 0 };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = /** @type {Record<string, unknown>} */ (raw);
    return {
      type: "pct",
      topPct: clampPct(o.topPct ?? o.top ?? o.upPct ?? o.up),
      rightPct: clampPct(o.rightPct ?? o.right),
      bottomPct: clampPct(o.bottomPct ?? o.bottom ?? o.downPct ?? o.down),
      leftPct: clampPct(o.leftPct ?? o.left),
    };
  }
  const s = String(raw).trim();
  if (!s) {
    return { type: "pct", topPct: 0, rightPct: 0, bottomPct: 0, leftPct: 0 };
  }
  if (s.startsWith("{")) {
    try {
      return parseGridGap(JSON.parse(s));
    } catch (_e) {
      return { type: "css", css: s };
    }
  }
  return { type: "css", css: s };
}

/**
 * @param {unknown} n
 * @returns {number}
 */
function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    return 0;
  }
  return Math.min(PCT_MAX, v);
}

/**
 * @param {PctGridGap} spec
 * @returns {string}
 */
export function serializeGridGapPct(spec) {
  return JSON.stringify({
    topPct: spec.topPct,
    rightPct: spec.rightPct,
    bottomPct: spec.bottomPct,
    leftPct: spec.leftPct,
  });
}

/**
 * @param {unknown} raw
 * @returns {object | string}
 */
export function gridGapForApi(raw) {
  const spec = parseGridGap(raw);
  if (spec.type === "css") {
    return spec.css;
  }
  if (!spec.topPct && !spec.rightPct && !spec.bottomPct && !spec.leftPct) {
    return "";
  }
  return {
    topPct: spec.topPct,
    rightPct: spec.rightPct,
    bottomPct: spec.bottomPct,
    leftPct: spec.leftPct,
  };
}

/**
 * @param {HTMLElement} root
 * @param {unknown} gridGap
 */
export function applyGridGapStyles(root, gridGap) {
  if (!root) {
    return;
  }
  root.style.removeProperty("gap");
  root.style.removeProperty("row-gap");
  root.style.removeProperty("column-gap");
  root.style.removeProperty("padding");
  delete root.dataset.siteFrameGridGapMode;

  const spec = parseGridGap(gridGap);
  if (spec.type === "css") {
    if (spec.css) {
      root.style.gap = spec.css;
      root.dataset.siteFrameGridGapMode = "css";
    }
    return;
  }

  const { topPct, rightPct, bottomPct, leftPct } = spec;
  if (!topPct && !rightPct && !bottomPct && !leftPct) {
    return;
  }

  root.dataset.siteFrameGridGapMode = "pct";
  root.style.padding = `${topPct}% ${rightPct}% ${bottomPct}% ${leftPct}%`;
  root.style.boxSizing = "border-box";

  const rowGap = (topPct + bottomPct) / 2;
  const colGap = (leftPct + rightPct) / 2;
  if (rowGap > 0) {
    root.style.rowGap = `${rowGap}%`;
  }
  if (colGap > 0) {
    root.style.columnGap = `${colGap}%`;
  }
}

/**
 * @param {HTMLInputElement} topIn
 * @param {HTMLInputElement} rightIn
 * @param {HTMLInputElement} bottomIn
 * @param {HTMLInputElement} leftIn
 * @returns {PctGridGap}
 */
export function readGridGapPctFromInputs(topIn, rightIn, bottomIn, leftIn) {
  const parseIn = (el) => clampPct(parseFloat(String(el.value)));
  return {
    type: "pct",
    topPct: parseIn(topIn),
    rightPct: parseIn(rightIn),
    bottomPct: parseIn(bottomIn),
    leftPct: parseIn(leftIn),
  };
}

/**
 * @param {HTMLInputElement} topIn
 * @param {HTMLInputElement} rightIn
 * @param {HTMLInputElement} bottomIn
 * @param {HTMLInputElement} leftIn
 * @param {unknown} gridGap
 */
export function fillGridGapPctInputs(topIn, rightIn, bottomIn, leftIn, gridGap) {
  const spec = parseGridGap(gridGap);
  if (spec.type === "css") {
    topIn.value = "";
    rightIn.value = "";
    bottomIn.value = "";
    leftIn.value = "";
    return;
  }
  topIn.value = spec.topPct ? String(spec.topPct) : "";
  rightIn.value = spec.rightPct ? String(spec.rightPct) : "";
  bottomIn.value = spec.bottomPct ? String(spec.bottomPct) : "";
  leftIn.value = spec.leftPct ? String(spec.leftPct) : "";
}
