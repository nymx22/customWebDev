/**
 * Per-cell link appearance for frame text cells (`frame_cell_text.link_style` JSON).
 * @typedef {{
 *   underline: boolean,
 *   colorInherit: boolean,
 *   color: string,
 *   hover: boolean,
 *   hoverColorInherit: boolean,
 *   hoverColor: string,
 * }} TextLinkStyle
 * `hover` enables hover color/opacity only; `underline` controls underline in all states.
 */

/** Site default: match `.photographer-link` / `.project-link` (no underline, inherit, subtle hover). */
export const DEFAULT_TEXT_LINK_STYLE = {
  underline: false,
  colorInherit: true,
  color: "",
  hover: false,
  hoverColorInherit: true,
  hoverColor: "",
};

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeLinkColor(raw) {
  const s = String(raw || "").trim().slice(0, 120);
  if (!s || s === "inherit" || s === "currentColor") {
    return "";
  }
  const low = s.toLowerCase();
  if (low.startsWith("javascript:") || low.startsWith("data:")) {
    return "";
  }
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    return s;
  }
  if (/^(rgb|rgba|hsl|hsla)\([^)]+\)$/i.test(s)) {
    return s;
  }
  return "";
}

/**
 * @param {unknown} raw
 * @returns {TextLinkStyle}
 */
export function normalizeTextLinkStyle(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const colorInherit = o.colorInherit !== false;
  const hoverColorInherit = o.hoverColorInherit !== false;
  const hover =
    o.hover != null ? Boolean(o.hover) : Boolean(o.hoverUnderline);
  return {
    underline: Boolean(o.underline),
    colorInherit,
    color: colorInherit ? "" : sanitizeLinkColor(o.color),
    hover,
    hoverColorInherit,
    hoverColor: hoverColorInherit ? "" : sanitizeLinkColor(o.hoverColor),
  };
}

/**
 * @param {HTMLElement} textWrap
 * @param {unknown} linkStyle
 */
export function applyTextLinkStyleToWrap(textWrap, linkStyle) {
  if (!textWrap) {
    return;
  }
  const s = normalizeTextLinkStyle(linkStyle);
  const color = s.colorInherit || !s.color ? "inherit" : s.color;
  const decoration = s.underline ? "underline" : "none";
  let hoverColor = color;
  let hoverOpacity = "1";
  if (s.hover) {
    hoverColor = s.hoverColorInherit || !s.hoverColor ? "inherit" : s.hoverColor;
    hoverOpacity = s.hoverColorInherit && !s.hoverColor ? "0.92" : "1";
  }

  textWrap.dataset.frameLinkStyle = "1";
  textWrap.style.setProperty("--frame-link-color", color);
  textWrap.style.setProperty("--frame-link-hover-color", hoverColor);
  textWrap.style.setProperty("--frame-link-decoration", decoration);
  textWrap.style.setProperty("--frame-link-hover-decoration", decoration);
  textWrap.style.setProperty("--frame-link-hover-opacity", hoverOpacity);
}

/**
 * @param {HTMLElement} textWrap
 */
export function clearTextLinkStyleFromWrap(textWrap) {
  if (!textWrap) {
    return;
  }
  delete textWrap.dataset.frameLinkStyle;
  textWrap.style.removeProperty("--frame-link-color");
  textWrap.style.removeProperty("--frame-link-hover-color");
  textWrap.style.removeProperty("--frame-link-decoration");
  textWrap.style.removeProperty("--frame-link-hover-decoration");
  textWrap.style.removeProperty("--frame-link-hover-opacity");
}

/**
 * @param {HTMLElement} parent
 * @param {{ onChange?: () => void }} [opts]
 * @returns {{ root: HTMLElement, read: () => TextLinkStyle, apply: (style: unknown) => void }}
 */
export function mountTextLinkStyleEditor(parent, opts = {}) {
  const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};

  const root = document.createElement("div");
  root.className = "staging-frame-panel__link-style";

  const title = document.createElement("div");
  title.className = "staging-frame-panel__field-label";
  title.textContent = "Link style";
  root.appendChild(title);

  function makeCheck(labelText) {
    const lab = document.createElement("label");
    lab.className = "staging-frame-panel__link-style-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    const span = document.createElement("span");
    span.textContent = labelText;
    lab.appendChild(cb);
    lab.appendChild(span);
    return { lab, cb };
  }

  const checkRow = document.createElement("div");
  checkRow.className = "staging-frame-panel__link-style-checks";
  const underlineRow = makeCheck("Underline");
  const hoverRow = makeCheck("Hover color");
  checkRow.appendChild(underlineRow.lab);
  checkRow.appendChild(hoverRow.lab);

  function makeColorRow(caption) {
    const wrap = document.createElement("div");
    wrap.className = "staging-frame-panel__link-style-color";
    const cap = document.createElement("span");
    cap.className = "staging-frame-panel__figma-caption";
    cap.textContent = caption;
    const inheritRow = makeCheck("Inherit");
    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "staging-frame-panel__link-style-picker";
    const hex = document.createElement("input");
    hex.type = "text";
    hex.className = "staging-frame-panel__input staging-frame-panel__link-style-hex";
    hex.placeholder = "#rrggbb";
    hex.spellcheck = false;
    wrap.appendChild(cap);
    wrap.appendChild(inheritRow.lab);
    wrap.appendChild(picker);
    wrap.appendChild(hex);
    return { wrap, inheritCb: inheritRow.cb, picker, hex };
  }

  const colorRow = makeColorRow("Color");
  const hoverColorRow = makeColorRow("Hover color");

  root.appendChild(checkRow);
  root.appendChild(colorRow.wrap);
  root.appendChild(hoverColorRow.wrap);

  function syncColorUi(inheritCb, picker, hex) {
    const inh = inheritCb.checked;
    picker.disabled = inh;
    hex.disabled = inh;
    if (inh) {
      hex.value = "";
    }
  }

  function wireColor(inheritCb, picker, hex) {
    inheritCb.addEventListener("change", () => {
      syncColorUi(inheritCb, picker, hex);
      onChange();
    });
    picker.addEventListener("input", () => {
      hex.value = picker.value;
      onChange();
    });
    hex.addEventListener("input", () => {
      const cleaned = sanitizeLinkColor(hex.value);
      if (cleaned && /^#[0-9a-f]{3,8}$/i.test(cleaned)) {
        picker.value = cleaned.length === 4 ? cleaned : cleaned.slice(0, 7);
      }
      onChange();
    });
  }

  wireColor(colorRow.inheritCb, colorRow.picker, colorRow.hex);
  wireColor(hoverColorRow.inheritCb, hoverColorRow.picker, hoverColorRow.hex);

  function syncHoverColorUi() {
    const on = hoverRow.cb.checked;
    hoverColorRow.wrap.hidden = !on;
    if (!on) {
      return;
    }
    syncColorUi(hoverColorRow.inheritCb, hoverColorRow.picker, hoverColorRow.hex);
  }

  [underlineRow.cb, hoverRow.cb].forEach((cb) => {
    cb.addEventListener("change", () => {
      syncHoverColorUi();
      onChange();
    });
  });

  function read() {
    return normalizeTextLinkStyle({
      underline: underlineRow.cb.checked,
      colorInherit: colorRow.inheritCb.checked,
      color: colorRow.inheritCb.checked ? "" : sanitizeLinkColor(colorRow.hex.value || colorRow.picker.value),
      hover: hoverRow.cb.checked,
      hoverColorInherit: hoverColorRow.inheritCb.checked,
      hoverColor: hoverColorRow.inheritCb.checked
        ? ""
        : sanitizeLinkColor(hoverColorRow.hex.value || hoverColorRow.picker.value),
    });
  }

  function apply(style) {
    const s = normalizeTextLinkStyle(style);
    underlineRow.cb.checked = s.underline;
    hoverRow.cb.checked = s.hover;
    colorRow.inheritCb.checked = s.colorInherit;
    hoverColorRow.inheritCb.checked = s.hoverColorInherit;
    colorRow.hex.value = s.colorInherit ? "" : s.color;
    hoverColorRow.hex.value = s.hoverColorInherit ? "" : s.hoverColor;
    if (!s.colorInherit && s.color && /^#[0-9a-f]{6}$/i.test(s.color)) {
      colorRow.picker.value = s.color;
    }
    if (!s.hoverColorInherit && s.hoverColor && /^#[0-9a-f]{6}$/i.test(s.hoverColor)) {
      hoverColorRow.picker.value = s.hoverColor;
    }
    syncColorUi(colorRow.inheritCb, colorRow.picker, colorRow.hex);
    syncHoverColorUi();
  }

  syncHoverColorUi();
  parent.appendChild(root);

  return { root, read, apply };
}
