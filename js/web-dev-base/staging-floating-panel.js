/**
 * Keep fixed staging panels (frame editor, gallery testing) inside the viewport.
 */

const VIEWPORT_PAD_PX = 8;

function stagingToolbarInsetPx() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      "--staging-status-bar-height",
    );
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.ceil(n);
    }
  } catch (_e) {
    /* ignore */
  }
  return 44;
}

/**
 * @param {HTMLElement} panel
 * @returns {{ width: number, height: number }}
 */
function panelSizePx(panel) {
  const rect = panel.getBoundingClientRect();
  const w = rect.width > 0 ? rect.width : panel.offsetWidth;
  const h = rect.height > 0 ? rect.height : panel.offsetHeight;
  return {
    width: Number.isFinite(w) && w > 0 ? w : 320,
    height: Number.isFinite(h) && h > 0 ? h : 240,
  };
}

/**
 * @param {HTMLElement} panel
 * @param {number} left
 * @param {number} top
 * @returns {{ left: number, top: number }}
 */
export function clampStagingPanelPosition(panel, left, top) {
  const pad = VIEWPORT_PAD_PX;
  const insetTop = stagingToolbarInsetPx();
  const { width, height } = panelSizePx(panel);
  const minLeft = pad;
  const minTop = insetTop + pad;
  const maxLeft = Math.max(minLeft, window.innerWidth - width - pad);
  const maxTop = Math.max(minTop, window.innerHeight - height - pad);
  return {
    left: Math.min(maxLeft, Math.max(minLeft, left)),
    top: Math.min(maxTop, Math.max(minTop, top)),
  };
}

/**
 * @param {HTMLElement} panel
 * @param {number} left
 * @param {number} top
 */
export function setStagingPanelPosition(panel, left, top) {
  const c = clampStagingPanelPosition(panel, left, top);
  panel.style.left = `${Math.round(c.left)}px`;
  panel.style.top = `${Math.round(c.top)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

/** Clamp using the panel’s current layout box (after restore or default placement). */
export function clampStagingPanelElement(panel) {
  const rect = panel.getBoundingClientRect();
  setStagingPanelPosition(panel, rect.left, rect.top);
}
