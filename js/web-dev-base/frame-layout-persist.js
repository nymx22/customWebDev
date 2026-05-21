/**
 * Cross-page frame drafts in sessionStorage so **Publish** can flush every page
 * edited in staging, not only the page currently mounted.
 */

import { cellDraftToPatchPayload } from "./frame-cell-padding.js";

const SESSION_PREFIX = "customdev_staging_frame_page_";

/**
 * @param {string} pageName
 * @returns {string}
 */
export function framePageSessionKey(pageName) {
  return SESSION_PREFIX + String(pageName || "").trim();
}

/**
 * @param {string} pageName
 * @param {{ frame: object, cells: object[] } | null} snapshot
 */
export function persistFramePageSession(pageName, snapshot) {
  const key = framePageSessionKey(pageName);
  if (!snapshot || !snapshot.frame || !Array.isArray(snapshot.cells)) {
    try {
      sessionStorage.removeItem(key);
    } catch (_e) {
      /* ignore */
    }
    return;
  }
  try {
    sessionStorage.setItem(key, JSON.stringify(snapshot));
  } catch (_e) {
    /* ignore quota */
  }
}

/**
 * @param {string} pageName
 */
export function clearFramePageSession(pageName) {
  try {
    sessionStorage.removeItem(framePageSessionKey(pageName));
  } catch (_e) {
    /* ignore */
  }
}

/**
 * @returns {string[]}
 */
export function listFramePageSessionNames() {
  /** @type {string[]} */
  const names = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(SESSION_PREFIX)) {
        names.push(key.slice(SESSION_PREFIX.length));
      }
    }
  } catch (_e) {
    /* ignore */
  }
  return names;
}

/**
 * @param {string} apiBase
 * @param {string} pageName
 * @param {{ frame: object, cells: object[] }} snapshot
 */
async function saveFrameSnapshotToApi(apiBase, pageName, snapshot) {
  const api = String(apiBase || "").replace(/\/$/, "");
  if (!api || !pageName) {
    return;
  }
  const res = await fetch(`${api}/api/frame?page=${encodeURIComponent(pageName)}`, {
    mode: "cors",
  });
  if (!res.ok) {
    throw new Error(`frame_get_${pageName}_${res.status}`);
  }
  const current = await res.json();
  const fid = current && current.frame && typeof current.frame.id === "number" ? current.frame.id : null;
  if (!fid) {
    return;
  }
  const fr = snapshot.frame || {};
  const frameBody = {
    id: fid,
    label: fr.label != null ? String(fr.label) : "",
    gridGap: fr.gridGap != null ? fr.gridGap : "",
    columnCount: Number(fr.columnCount) || current.frame.columnCount || 1,
    rowCount: Number(fr.rowCount) || current.frame.rowCount || 1,
    defaultTextFontFamily: String(fr.defaultTextFontFamily || ""),
    defaultTextFontSize: Math.min(288, Math.max(8, Number(fr.defaultTextFontSize) || 16)),
  };
  const patchFrame = await fetch(`${api}/api/frame`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    mode: "cors",
    body: JSON.stringify(frameBody),
  });
  if (!patchFrame.ok) {
    throw new Error(`frame_patch_${pageName}_${patchFrame.status}`);
  }
  for (let i = 0; i < snapshot.cells.length; i++) {
    const draft = snapshot.cells[i];
    const payload = cellDraftToPatchPayload(draft);
    if (!payload) {
      continue;
    }
    const patchCell = await fetch(`${api}/api/frame/cell`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify(payload),
    });
    if (!patchCell.ok) {
      throw new Error(`frame_cell_patch_${pageName}_${patchCell.status}`);
    }
  }
}

/**
 * Flush pending session snapshots for pages other than the one just saved live.
 * @param {string} apiBase
 * @param {{ skipPage?: string }} [options]
 */
export async function flushAllFramePageSessionsToApi(apiBase, options = {}) {
  const skip = String(options.skipPage || "").trim();
  const names = listFramePageSessionNames();
  for (let i = 0; i < names.length; i++) {
    const pageName = names[i];
    if (!pageName || pageName === skip) {
      continue;
    }
    let raw = null;
    try {
      raw = sessionStorage.getItem(framePageSessionKey(pageName));
    } catch (_e) {
      raw = null;
    }
    if (!raw) {
      continue;
    }
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (_e) {
      continue;
    }
    if (!snapshot || !Array.isArray(snapshot.cells)) {
      continue;
    }
    await saveFrameSnapshotToApi(apiBase, pageName, snapshot);
    clearFramePageSession(pageName);
  }
}
