/**
 * Calvin Van site — Farewell, Mr. Fuji project page only. Imports reusable modules from ./web-dev-base/.
 */

import { createDraggableGallery } from "./web-dev-base/gallery-core/gallery-core.js";
import {
  forceLandscapeMobile as forceLandscape,
  mountProjectPageFooter,
  mountProjectPageHeader,
} from "./web-dev-base/project-page.js";

const GALLERY_ROOT_ID = "farewell-drag-gallery";
/** Background-removed PNGs under `assets/images/FarewellMrFuji/bg_removed/`. */
const ASSET_BASE = "../assets/images/FarewellMrFuji/";

/** CSS max-height for thumb rail + zoom when open (caps both columns; rail scrolls, zoom does not). */
const ZOOM_PANE_MAX_HEIGHT = "min(85dvh, calc(100dvh - 9rem))";

/** Keep the project title block pinned while scrolling (see `.project-page-header--sticky` in main.css). */
const STICKY_PROJECT_HEADER = true;

/** Optional CSS `top` offset when sticky (e.g. `"env(safe-area-inset-top, 0px)"`). Leave empty for `0`. */
const STICKY_PROJECT_HEADER_TOP = "";

/** Optional CSS `height` while sticky (e.g. `"64px"`). Leave empty for natural height. */
const STICKY_PROJECT_HEADER_HEIGHT = "";

/** Footer line under the gallery; leave empty to omit. */
const PROJECT_FOOTER_TEXT = "";

/**
 * Pin the footer bar to the bottom of the scrollport when scrolling (see `.project-page-footer--sticky` in main.css).
 * On this page the gallery scrolls inside its viewport while the section uses `overflow: hidden`, so sticky mostly
 * pins the footer within the project column rather than the whole window—same constraint as the sticky header.
 */
const STICKY_PROJECT_FOOTER = true;

/** Optional CSS `bottom` when sticky (e.g. `"env(safe-area-inset-bottom, 0px)"`). Leave empty for `0`. */
const STICKY_PROJECT_FOOTER_BOTTOM = "";

/** Optional CSS `height` while sticky (e.g. `"64px"`). Leave empty for natural height. */
const STICKY_PROJECT_FOOTER_HEIGHT = "";

const SCAN_FILES = [
  "Farewell, Mr. Fuji Scan.png",
  ...Array.from(
    { length: 33 },
    (_, i) => `Farewell, Mr. Fuji Scan ${i + 1}.png`
  ),
];

function scanUrl(name) {
  return ASSET_BASE + encodeURIComponent(name);
}

export async function initFarewellMrFuji() {
  if (
    document.documentElement.classList.contains("staging") &&
    window.matchMedia("(max-width: 900px)").matches
  ) {
    forceLandscape();
  }

  mountProjectPageHeader(".project-page .project-page-header", {
    title: "Farewell, Mr. Fuji",
    showHomeLink: false,
    stickyHeader: STICKY_PROJECT_HEADER,
    ...(STICKY_PROJECT_HEADER_TOP
      ? { stickyHeaderTop: STICKY_PROJECT_HEADER_TOP }
      : {}),
    ...(STICKY_PROJECT_HEADER_HEIGHT
      ? { stickyHeaderHeight: STICKY_PROJECT_HEADER_HEIGHT }
      : {}),
  });
  mountProjectPageFooter(".project-page .project-page-footer", {
    ...(PROJECT_FOOTER_TEXT ? { text: PROJECT_FOOTER_TEXT } : {}),
    ...(STICKY_PROJECT_FOOTER ? { stickyFooter: true } : {}),
    ...(STICKY_PROJECT_FOOTER && STICKY_PROJECT_FOOTER_BOTTOM
      ? { stickyFooterBottom: STICKY_PROJECT_FOOTER_BOTTOM }
      : {}),
    ...(STICKY_PROJECT_FOOTER && STICKY_PROJECT_FOOTER_HEIGHT
      ? { stickyFooterHeight: STICKY_PROJECT_FOOTER_HEIGHT }
      : {}),
  });

  const root = document.getElementById(GALLERY_ROOT_ID);
  if (!root) {
    return { gallery: null };
  }

  const gallery = await createDraggableGallery(root, {
    defaultCursor: true,
    zoomPaneMaxHeight: ZOOM_PANE_MAX_HEIGHT,
  });
  gallery.setImages(SCAN_FILES.map((name) => ({ src: scanUrl(name), alt: "" })));

  return { gallery };
}

void initFarewellMrFuji();
