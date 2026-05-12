/**
 * Reusable gallery helpers: lightbox from DOM + strip/zoom gallery (expects matching CSS).
 */

import { buildDividedGridTracks } from "./frame-layout.js";

/** Session key when `html.staging`: values `half-click` | `zoom-close` for draggable gallery nav mode. */
export const STAGING_GALLERY_NAV_STORAGE_KEY = "customdev_staging_gallery_nav";

/** Session key: legacy flat `click` | `dblclick` | `contextmenu` (read if JSON prefs missing). Prefs JSON uses `stripClickAction` / `stripDblclickAction` / `stripContextmenuAction` (`toggle_zoom` | `select_only` | `none`). */
export const STAGING_GALLERY_ACTIVATE_STORAGE_KEY = "customdev_staging_gallery_activate";

/** Session key: `smooth` | `instant` | `auto` for `scrollIntoView` when stepping focus in the strip. */
export const STAGING_GALLERY_SCROLL_STORAGE_KEY = "customdev_staging_gallery_scroll";

/** `window` event name: a gallery saved staging prefs (`detail.galleryStorageId`). */
export const STAGING_GALLERY_SETTINGS_EVENT = "customdev-staging-gallery-settings";

/** Per-gallery JSON prefs in sessionStorage (staging only; nav, strip thumbnail gesture actions, scroll, zoomOpenAnim, slideTransition). */
export function stagingGalleryPrefsStorageKey(galleryStorageId) {
  return `customdev_staging_gallery_prefs_${galleryStorageId}`;
}

/** Per-gallery JSON prefs in localStorage — written from staging **Save & publish to live**; read on live (`!html.staging`) and as seed when staging has no session prefs yet. */
export function publishedGalleryPrefsStorageKey(galleryStorageId) {
  return `customdev_gallery_prefs_published_${galleryStorageId}`;
}

/** Saved panel position `{ left, top }` strings for `position: fixed`. */
export function stagingGalleryPanelPosStorageKey(galleryStorageId) {
  return `customdev_staging_testing_panel_pos_${galleryStorageId}`;
}

function isHtmlStagingEnabled() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("staging")
  );
}

/** Default `sizes` for draggable strip thumbnails (phone vs laptop). */
export const DEFAULT_STRIP_IMAGE_SIZES =
  "(max-width: 900px) min(92vw, 1000px), min(44vw, 800px), min(160px, 24vw)";

/** Default `sizes` for desktop zoom pane image. */
export const DEFAULT_ZOOM_IMAGE_SIZES =
  "(max-width: 900px) min(96vw, 1200px), min(68vw, min(1280px, 90vw))";

/** Default `sizes` for gallery page lightbox full view. */
export const DEFAULT_LIGHTBOX_IMAGE_SIZES =
  "(max-width: 900px) 100vw, min(94vw, min(1600px, 96vw))";

/**
 * Build `srcset` with `-{width}` before the file extension (files must exist at those URLs).
 *
 * @param {string} src – e.g. `"/a/foo.jpg"`
 * @param {number[]} widths – e.g. `[480, 960, 1600]`
 * @returns {string}
 */
export function buildSrcsetSuffixWidths(src, widths) {
  if (!src || !widths || !widths.length) return "";
  const m = String(src).match(/^(.*?)(\.[a-z0-9]+)$/i);
  if (!m) return "";
  const base = m[1];
  const ext = m[2];
  return widths
    .filter((w) => Number.isFinite(w) && w > 0)
    .map((w) => {
      const n = Math.round(w);
      return `${base}-${n}${ext} ${n}w`;
    })
    .join(", ");
}

/**
 * @param {string | {
 *   src: string,
 *   alt?: string,
 *   srcset?: string,
 *   sizes?: string,
 *   fullSrc?: string,
 *   fullSrcset?: string,
 *   fullSizes?: string,
 *   loading?: "lazy" | "eager",
 *   fetchPriority?: "high" | "low" | "auto",
 * }} item
 */
export function normalizeImageEntry(item) {
  if (typeof item === "string") {
    return {
      src: item,
      alt: "",
      srcset: "",
      sizes: "",
      fullSrc: "",
      fullSrcset: "",
      fullSizes: "",
      loading: undefined,
      fetchPriority: undefined,
    };
  }
  const o = item;
  const fp = o.fetchPriority;
  return {
    src: o.src,
    alt: o.alt ?? "",
    srcset: typeof o.srcset === "string" ? o.srcset : "",
    sizes: typeof o.sizes === "string" ? o.sizes : "",
    fullSrc: typeof o.fullSrc === "string" ? o.fullSrc : "",
    fullSrcset: typeof o.fullSrcset === "string" ? o.fullSrcset : "",
    fullSizes: typeof o.fullSizes === "string" ? o.fullSizes : "",
    loading: o.loading === "lazy" || o.loading === "eager" ? o.loading : undefined,
    fetchPriority: fp === "high" || fp === "low" || fp === "auto" ? fp : undefined,
  };
}

/** Duration (ms) for one full right-page turn around the spine. */
export const GALLERY_BOOKFLIP_MS = 720;

/** @deprecated Use {@link GALLERY_BOOKFLIP_MS}. */
export const GALLERY_BOOKFLIP_HALF_MS = GALLERY_BOOKFLIP_MS;

/**
 * Right-hand “page” of an open-book zoom: one full `rotateY` around the spine (left edge of the right column),
 * then resets the flipper to rest (`transform` cleared), then `applySrc()` so pixels swap only
 * once the leaf is flat (avoids end-of-turn twitch). Optional `onDone`.
 * Adds `draggable-gallery__zoom--bookflip-running` on `zoomAside` for the turn. **Next:** the right leaf turns;
 * `.zoom-book-under` shows the incoming right half and fades in from the start of the flip (spread vars
 * `--draggable-gallery-bookflip-under-fade-*-frac` × `--draggable-gallery-bookflip-dur`); the static left stack
 * crossfades outgoing left → incoming left in the same window. **Prev:** left leaf turns; `zoom-book-under-prev`
 * fades in from the start; the static right stack crossfades outgoing → incoming right. At rest, under layers snap off
 * (no fade-out). While turning, CSS hides the leaf’s paper **back**; **front** drop-shadow only while turning.
 *
 * @param {HTMLElement | null} flipperEl – `.draggable-gallery__zoom-book-flipper`
 * @param {HTMLElement | null} zoomAside – `.draggable-gallery__zoom`
 * @param {-1 | 1} direction +1 = next (right-column flipper, hinge at spine), −1 = prev (left-column flipper, hinge at spine)
 * @param {() => void} applySrc
 * @param {() => void} [onDone]
 * @returns {() => void} cancel
 */
export function runBookflipImageSwap(flipperEl, zoomAside, direction, applySrc, onDone) {
  if (!flipperEl || typeof applySrc !== "function") {
    if (onDone) {
      onDone();
    }
    return function cancelBookflipNoop() {};
  }

  const turnCls =
    direction >= 0
      ? "draggable-gallery__zoom-book-flipper--turn-book-next"
      : "draggable-gallery__zoom-book-flipper--turn-book-prev";

  let settled = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let t = null;
  /** @type {((ev: TransitionEvent) => void) | null} */
  let onEnd = null;

  function stripTurn() {
    flipperEl.classList.remove(
      "draggable-gallery__zoom-book-flipper--turn-book-next",
      "draggable-gallery__zoom-book-flipper--turn-book-prev",
      "draggable-gallery__zoom-book-flipper--turn-next",
      "draggable-gallery__zoom-book-flipper--turn-prev",
    );
    flipperEl.style.transition = "";
  }

  function cleanupListeners() {
    if (t != null) {
      window.clearTimeout(t);
      t = null;
    }
    if (onEnd) {
      flipperEl.removeEventListener("transitionend", onEnd);
      onEnd = null;
    }
    if (zoomAside) {
      zoomAside.classList.remove(
        "draggable-gallery__zoom--bookflip-running",
        "draggable-gallery__zoom--bookflip-dir-prev",
      );
    }
    stripTurn();
  }

  function finish() {
    if (settled) {
      return;
    }
    settled = true;
    cleanupListeners();
    if (onDone) {
      onDone();
    }
  }

  if (zoomAside) {
    zoomAside.classList.add("draggable-gallery__zoom--bookflip-running");
    if (direction < 0) {
      zoomAside.classList.add("draggable-gallery__zoom--bookflip-dir-prev");
    }
  }
  stripTurn();
  void flipperEl.offsetWidth;
  flipperEl.classList.add(turnCls);

  onEnd = function bookflipTurnEnd(ev) {
    if (ev.target !== flipperEl || ev.propertyName !== "transform") {
      return;
    }
    flipperEl.removeEventListener("transitionend", onEnd);
    onEnd = null;
    if (t != null) {
      window.clearTimeout(t);
      t = null;
    }
    flipperEl.style.transition = "none";
    flipperEl.classList.remove(turnCls);
    void flipperEl.offsetWidth;
    flipperEl.style.removeProperty("transition");
    applySrc();
    finish();
  };
  flipperEl.addEventListener("transitionend", onEnd);
  t = window.setTimeout(function bookflipTurnFallback() {
    if (onEnd) {
      flipperEl.removeEventListener("transitionend", onEnd);
      onEnd = null;
    }
    if (!settled) {
      flipperEl.style.transition = "none";
      flipperEl.classList.remove(
        "draggable-gallery__zoom-book-flipper--turn-book-next",
        "draggable-gallery__zoom-book-flipper--turn-book-prev",
        "draggable-gallery__zoom-book-flipper--turn-next",
        "draggable-gallery__zoom-book-flipper--turn-prev",
      );
      void flipperEl.offsetWidth;
      flipperEl.style.removeProperty("transition");
      applySrc();
      finish();
    }
  }, GALLERY_BOOKFLIP_MS + 120);

  return function cancelBookflip() {
    if (settled) {
      return;
    }
    settled = true;
    cleanupListeners();
  };
}

/**
 * Fade current zoom image out, swap source, fade in.
 * Uses timed phases so the swap completes even when CSS sets `transition: none`
 * (e.g. `prefers-reduced-motion` on `.draggable-gallery__zoom-image`).
 *
 * @param {HTMLElement | null} zoomImg
 * @param {() => void} applySrc
 * @param {() => void} [onDone]
 * @returns {() => void} cancel
 */
export function runCrossfadeImageSwap(zoomImg, applySrc, onDone) {
  if (!zoomImg || typeof applySrc !== "function") {
    if (onDone) {
      onDone();
    }
    return function cancelXfadeNoop() {};
  }

  let settled = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let tOut = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let tIn = null;

  function finish() {
    if (settled) {
      return;
    }
    settled = true;
    if (tOut != null) {
      window.clearTimeout(tOut);
      tOut = null;
    }
    if (tIn != null) {
      window.clearTimeout(tIn);
      tIn = null;
    }
    zoomImg.classList.remove(
      "draggable-gallery__zoom-image--xfade-out",
      "draggable-gallery__zoom-image--xfade-in",
    );
    if (onDone) {
      onDone();
    }
  }

  zoomImg.classList.remove("draggable-gallery__zoom-image--xfade-in");
  zoomImg.classList.add("draggable-gallery__zoom-image--xfade-out");

  tOut = window.setTimeout(function crossfadePhaseOut() {
    tOut = null;
    if (settled) {
      return;
    }
    applySrc();
    zoomImg.classList.remove("draggable-gallery__zoom-image--xfade-out");
    void zoomImg.offsetWidth;
    zoomImg.classList.add("draggable-gallery__zoom-image--xfade-in");
    tIn = window.setTimeout(function crossfadePhaseIn() {
      tIn = null;
      if (settled) {
        return;
      }
      finish();
    }, 300);
  }, 240);

  return function cancelCrossfade() {
    if (settled) {
      return;
    }
    settled = true;
    if (tOut != null) {
      window.clearTimeout(tOut);
      tOut = null;
    }
    if (tIn != null) {
      window.clearTimeout(tIn);
      tIn = null;
    }
    zoomImg.classList.remove(
      "draggable-gallery__zoom-image--xfade-out",
      "draggable-gallery__zoom-image--xfade-in",
    );
  };
}

/**
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
export function wrapGalleryIndex(index, length) {
  if (length <= 0) return 0;
  let k = index % length;
  if (k < 0) k += length;
  return k;
}

/**
 * @param {boolean} locked
 */
export function setGalleryBodyScrollLocked(locked) {
  document.body.style.overflow = locked ? "hidden" : "";
}

/**
 * @param {{ isOpen: () => boolean, onClose?: () => void, onPrev?: () => void, onNext?: () => void }} spec
 * @returns {() => void}
 */
export function bindDocumentGalleryKeydown(spec) {
  function onKeyDown(event) {
    if (!spec.isOpen()) return;
    if (event.key === "Escape") {
      if (spec.onClose) spec.onClose();
      return;
    }
    if (event.key === "ArrowLeft") {
      if (spec.onPrev) spec.onPrev();
      return;
    }
    if (event.key === "ArrowRight") {
      if (spec.onNext) spec.onNext();
      return;
    }
  }
  document.addEventListener("keydown", onKeyDown);
  return function dispose() {
    document.removeEventListener("keydown", onKeyDown);
  };
}

/**
 * Wires `.gallery-item` + `#lightbox` + controls. No-op if required nodes are missing.
 */
export function initGalleryLightboxFromDom() {
  const items = [...document.querySelectorAll(".gallery-item")];
  const lightbox = document.getElementById("lightbox");
  const image = document.getElementById("lightbox-image");
  const closeBtn = document.getElementById("lightbox-close");
  const prevBtn = document.getElementById("lightbox-prev");
  const nextBtn = document.getElementById("lightbox-next");

  if (!items.length || !lightbox || !image || !closeBtn || !prevBtn || !nextBtn) {
    return;
  }

  let current = 0;

  function applyLightboxFromIndex(index) {
    const item = items[index];
    const thumb = item.querySelector("img");
    const full = item.dataset.full || "";
    image.src = full || (thumb && thumb.currentSrc) || (thumb && thumb.src) || "";
    const fullSrcset =
      item.dataset.fullSrcset ||
      (thumb && thumb.dataset && thumb.dataset.fullSrcset) ||
      (thumb && thumb.getAttribute("srcset")) ||
      "";
    if (fullSrcset) {
      image.setAttribute("srcset", fullSrcset);
    } else {
      image.removeAttribute("srcset");
    }
    image.setAttribute("sizes", DEFAULT_LIGHTBOX_IMAGE_SIZES);
    const fp = thumb && thumb.getAttribute("fetchpriority");
    if (fp === "high" || fp === "low" || fp === "auto") {
      if ("fetchPriority" in image) {
        image.fetchPriority = fp;
      } else {
        image.setAttribute("fetchpriority", fp);
      }
    } else if ("fetchPriority" in image) {
      image.fetchPriority = "high";
    } else {
      image.setAttribute("fetchpriority", "high");
    }
  }

  const open = (index) => {
    current = index;
    applyLightboxFromIndex(current);
    lightbox.hidden = false;
    setGalleryBodyScrollLocked(true);
  };

  const close = () => {
    lightbox.hidden = true;
    image.src = "";
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    if ("fetchPriority" in image) {
      image.fetchPriority = "auto";
    } else {
      image.removeAttribute("fetchpriority");
    }
    setGalleryBodyScrollLocked(false);
  };

  const step = (dir) => {
    current = wrapGalleryIndex(current + dir, items.length);
    applyLightboxFromIndex(current);
  };

  items.forEach((item, i) => item.addEventListener("click", () => open(i)));
  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) close();
  });

  bindDocumentGalleryKeydown({
    isOpen: () => !lightbox.hidden,
    onClose: close,
    onPrev: () => step(-1),
    onNext: () => step(1),
  });
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   defaultCursor?: boolean,
 *   zoomOpenDividers?: { count: number, ratioCsv: string },
 *   zoomThumbFill?: boolean,
 *   zoomPaneMaxHeight?: string,
 *   stripImageSizes?: string,
 *   zoomImageSizes?: string,
 *   stripHalfClickNav?: boolean,
 *   stagingGalleryToolbar?: boolean,
 *   zoomOpenAnim?: "none" | "slide" | "fade" | "scale",
 *   slideTransition?: "none" | "crossfade" | "bookflip",
 * }} [options] – `zoomOpenDividers` defaults to two columns `1,3` (thumb rail ∶ zoom pane). `zoomThumbFill` true = fixed-height thumbs cropped with `object-fit: cover`; default = full rail width, whole image, variable thumb height. `zoomPaneMaxHeight` = CSS length for max height of both rail and zoom when open (e.g. `"min(85dvh, calc(100dvh - 8rem))"`); caps pane to wrapper/viewport; left scrolls, right does not. `stripImageSizes` / `zoomImageSizes` override defaults for responsive `sizes` on strip and zoom pane (see `DEFAULT_STRIP_IMAGE_SIZES`, `DEFAULT_ZOOM_IMAGE_SIZES`). `stripHalfClickNav` (default true): half-screen prev/next on the strip and zoom halves when enabled. `zoomOpenAnim` (default `slide`): zoom shell enter/exit — `none` instant, `slide` / `fade` / `scale` CSS variants. `slideTransition` (default `none`): when changing the zoom image while zoom stays open — `crossfade`, `bookflip` (`runBookflipImageSwap`), or `none`. When `html.staging` and `stagingGalleryToolbar` is not false, the testing panel adds nav checkboxes, **three strip-thumbnail menus** (click / double-click / right-click each assign **Open / toggle zoom**, **Select thumbnail only (no zoom)**, or **No action**; at least one gesture must not be “No action”), strip-scroll, zoom open/close, and zoom image change. Prefs persist in `sessionStorage` under `stagingGalleryPrefsStorageKey(id)` (JSON: `stripClickAction`, `stripDblclickAction`, `stripContextmenuAction`, etc.); legacy `openZoom*` booleans, JSON `activate`, and flat keys are read if needed. `window` event `STAGING_GALLERY_SETTINGS_EVENT` carries `detail.galleryStorageId` so only matching instances refresh.
 */
export function createDraggableGallery(root, options) {
  if (!root) {
    throw new Error("createDraggableGallery: root element required");
  }

  const opts = options || {};
  const defaultCursor = opts.defaultCursor === true;
  const zoomThumbFill = opts.zoomThumbFill === true;
  const zoomPaneMaxHeight =
    typeof opts.zoomPaneMaxHeight === "string" && opts.zoomPaneMaxHeight.trim()
      ? opts.zoomPaneMaxHeight.trim()
      : null;
  const zoomDiv = opts.zoomOpenDividers || { count: 2, ratioCsv: "1,3" };
  const stripImageSizes =
    typeof opts.stripImageSizes === "string" && opts.stripImageSizes.trim()
      ? opts.stripImageSizes.trim()
      : DEFAULT_STRIP_IMAGE_SIZES;
  const zoomImageSizes =
    typeof opts.zoomImageSizes === "string" && opts.zoomImageSizes.trim()
      ? opts.zoomImageSizes.trim()
      : DEFAULT_ZOOM_IMAGE_SIZES;
  const stripHalfClickNavDefault = opts.stripHalfClickNav !== false;
  let stripHalfClickNavActive = stripHalfClickNavDefault;

  /**
   * @param {unknown} v
   * @returns {"toggle_zoom" | "select_only" | "none"}
   */
  function normalizeStripGestureAction(v) {
    if (v === "toggle_zoom" || v === "select_only" || v === "none") {
      return v;
    }
    return "toggle_zoom";
  }

  /**
   * @param {Record<string, unknown>} [o]
   * @returns {{ stripClickAction: "toggle_zoom" | "select_only" | "none", stripDblclickAction: "toggle_zoom" | "select_only" | "none", stripContextmenuAction: "toggle_zoom" | "select_only" | "none" }}
   */
  function normalizeStripThumbnailActions(o) {
    if (o && typeof o.stripClickAction === "string") {
      let a = normalizeStripGestureAction(o.stripClickAction);
      let b = normalizeStripGestureAction(
        typeof o.stripDblclickAction === "string" ? o.stripDblclickAction : "none",
      );
      let c = normalizeStripGestureAction(
        typeof o.stripContextmenuAction === "string" ? o.stripContextmenuAction : "none",
      );
      if (a === "none" && b === "none" && c === "none") {
        a = "toggle_zoom";
      }
      return { stripClickAction: a, stripDblclickAction: b, stripContextmenuAction: c };
    }
    if (o && typeof o.openZoomClick === "boolean") {
      return {
        stripClickAction: o.openZoomClick ? "toggle_zoom" : "none",
        stripDblclickAction: o.openZoomDblclick ? "toggle_zoom" : "none",
        stripContextmenuAction: o.openZoomContextmenu ? "toggle_zoom" : "none",
      };
    }
    const act = typeof o?.activate === "string" ? o.activate : "click";
    if (act === "dblclick") {
      return { stripClickAction: "none", stripDblclickAction: "toggle_zoom", stripContextmenuAction: "none" };
    }
    if (act === "contextmenu") {
      return { stripClickAction: "none", stripDblclickAction: "none", stripContextmenuAction: "toggle_zoom" };
    }
    return { stripClickAction: "toggle_zoom", stripDblclickAction: "none", stripContextmenuAction: "none" };
  }

  /** @type {"toggle_zoom" | "select_only" | "none"} */
  let galleryStripClickAction = "toggle_zoom";
  /** @type {"toggle_zoom" | "select_only" | "none"} */
  let galleryStripDblclickAction = "none";
  /** @type {"toggle_zoom" | "select_only" | "none"} */
  let galleryStripContextmenuAction = "none";
  /** @type {ScrollBehavior} */
  let galleryScrollBehavior = "smooth";

  function normalizeZoomOpenAnim(v) {
    if (v === "none" || v === "slide" || v === "fade" || v === "scale") {
      return v;
    }
    return "slide";
  }
  function normalizeSlideTransition(v) {
    if (v === "none" || v === "crossfade" || v === "bookflip") {
      return v;
    }
    return "none";
  }
  /** @type {"none" | "slide" | "fade" | "scale"} */
  let galleryZoomOpenAnim = normalizeZoomOpenAnim(opts.zoomOpenAnim);
  /** @type {"none" | "crossfade" | "bookflip"} */
  let gallerySlideTransition = normalizeSlideTransition(opts.slideTransition);

  let galleryPrefsStorageId = "";
  if (root.id && String(root.id).trim()) {
    galleryPrefsStorageId = String(root.id).trim();
  } else {
    if (!root.dataset.stagingGalleryStorageId) {
      root.dataset.stagingGalleryStorageId = `sg-${Math.random().toString(36).slice(2, 11)}`;
    }
    galleryPrefsStorageId = root.dataset.stagingGalleryStorageId;
  }

  const showStagingGalleryToolbar =
    opts.stagingGalleryToolbar !== false && isHtmlStagingEnabled();

  /** @type {null | (() => void)} */
  let syncStagingPanelSelectsFromState = null;

  /** @type {HTMLElement | null} */
  let zoomSpread = null;
  /** @type {HTMLElement | null} */
  let zoomBookFlipperRight = null;
  /** @type {HTMLElement | null} */
  let zoomBookFlipperLeft = null;
  /** @type {HTMLImageElement | null} */
  let zoomImgLeft = null;
  /** @type {HTMLImageElement | null} */
  let zoomImgLeftLeaf = null;
  /** @type {HTMLImageElement | null} */
  let zoomImgUnder = null;
  /** @type {HTMLImageElement | null} */
  let zoomImgUnderPrev = null;
  /** @type {HTMLImageElement | null} */
  let zoomImgRightStatic = null;
  /** @type {HTMLImageElement | null} */
  let zoomImgLeftIncoming = null;
  /** @type {HTMLImageElement | null} */
  let zoomImgRightStaticIncoming = null;

  function syncZoomOpenAnimClasses() {
    root.classList.remove(
      "draggable-gallery--zoom-open-anim-none",
      "draggable-gallery--zoom-open-anim-slide",
      "draggable-gallery--zoom-open-anim-fade",
      "draggable-gallery--zoom-open-anim-scale",
    );
    root.classList.add(`draggable-gallery--zoom-open-anim-${galleryZoomOpenAnim}`);
  }

  function syncZoomSpreadBookMode() {
    if (!zoomSpread) {
      return;
    }
    zoomSpread.classList.toggle(
      "draggable-gallery__zoom-spread--book",
      gallerySlideTransition === "bookflip",
    );
  }

  function galleryPrefsFallback() {
    return {
      stripNav: stripHalfClickNavDefault ? "half-click" : "zoom-close",
      stripClickAction: /** @type {"toggle_zoom" | "select_only" | "none"} */ ("toggle_zoom"),
      stripDblclickAction: /** @type {"toggle_zoom" | "select_only" | "none"} */ ("none"),
      stripContextmenuAction: /** @type {"toggle_zoom" | "select_only" | "none"} */ ("none"),
      scroll: /** @type {ScrollBehavior} */ ("smooth"),
      zoomOpenAnim: normalizeZoomOpenAnim(opts.zoomOpenAnim),
      slideTransition: normalizeSlideTransition(opts.slideTransition),
    };
  }

  /**
   * @param {unknown} o
   * @param {ReturnType<typeof galleryPrefsFallback>} fallback
   */
  function mergeGalleryPrefsFromParsedJson(o, fallback) {
    const rec = o && typeof o === "object" ? /** @type {Record<string, unknown>} */ (o) : {};
    const g = normalizeStripThumbnailActions(rec);
    return {
      stripNav: rec.stripNav === "zoom-close" ? "zoom-close" : "half-click",
      stripClickAction: g.stripClickAction,
      stripDblclickAction: g.stripDblclickAction,
      stripContextmenuAction: g.stripContextmenuAction,
      scroll:
        rec.scroll === "instant" || rec.scroll === "auto" || rec.scroll === "smooth"
          ? rec.scroll
          : fallback.scroll,
      zoomOpenAnim: normalizeZoomOpenAnim(
        typeof rec.zoomOpenAnim === "string" ? rec.zoomOpenAnim : undefined,
      ),
      slideTransition: normalizeSlideTransition(
        typeof rec.slideTransition === "string" ? rec.slideTransition : undefined,
      ),
    };
  }

  function loadGalleryStagingPrefsObject() {
    const fallback = galleryPrefsFallback();
    if (!galleryPrefsStorageId) {
      return fallback;
    }
    const publishedRaw = (() => {
      try {
        return localStorage.getItem(publishedGalleryPrefsStorageKey(galleryPrefsStorageId));
      } catch (_e) {
        return null;
      }
    })();

    if (!showStagingGalleryToolbar) {
      if (publishedRaw) {
        try {
          return mergeGalleryPrefsFromParsedJson(JSON.parse(publishedRaw), fallback);
        } catch (_e) {
          /* ignore */
        }
      }
      return fallback;
    }

    try {
      const raw = sessionStorage.getItem(
        stagingGalleryPrefsStorageKey(galleryPrefsStorageId),
      );
      if (raw) {
        return mergeGalleryPrefsFromParsedJson(JSON.parse(raw), fallback);
      }
    } catch (_e) {
      /* ignore */
    }

    if (publishedRaw) {
      try {
        return mergeGalleryPrefsFromParsedJson(JSON.parse(publishedRaw), fallback);
      } catch (_e) {
        /* ignore */
      }
    }

    try {
      const nav = sessionStorage.getItem(STAGING_GALLERY_NAV_STORAGE_KEY);
      const act = sessionStorage.getItem(STAGING_GALLERY_ACTIVATE_STORAGE_KEY);
      const scr = sessionStorage.getItem(STAGING_GALLERY_SCROLL_STORAGE_KEY);
      const g = normalizeStripThumbnailActions({ activate: act || "click" });
      return {
        stripNav: nav === "zoom-close" ? "zoom-close" : "half-click",
        stripClickAction: g.stripClickAction,
        stripDblclickAction: g.stripDblclickAction,
        stripContextmenuAction: g.stripContextmenuAction,
        scroll: scr === "instant" || scr === "auto" || scr === "smooth" ? scr : "smooth",
        zoomOpenAnim: fallback.zoomOpenAnim,
        slideTransition: fallback.slideTransition,
      };
    } catch (_e2) {
      /* ignore */
    }
    return fallback;
  }

  function dispatchThisGalleryStagingSettings() {
    if (!showStagingGalleryToolbar || !galleryPrefsStorageId) {
      return;
    }
    try {
      window.dispatchEvent(
        new CustomEvent(STAGING_GALLERY_SETTINGS_EVENT, {
          detail: { galleryStorageId: galleryPrefsStorageId },
        }),
      );
    } catch (_e) {
      /* ignore */
    }
  }

  function applyLoadedGalleryPrefs(p) {
    stripHalfClickNavActive = p.stripNav === "half-click";
    galleryStripClickAction = p.stripClickAction;
    galleryStripDblclickAction = p.stripDblclickAction;
    galleryStripContextmenuAction = p.stripContextmenuAction;
    galleryScrollBehavior = p.scroll;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    galleryZoomOpenAnim = reduceMotion ? "none" : normalizeZoomOpenAnim(p.zoomOpenAnim);
    gallerySlideTransition = reduceMotion ? "none" : normalizeSlideTransition(p.slideTransition);
    syncZoomOpenAnimClasses();
    syncZoomSpreadBookMode();
    syncHalfClickNavState();
  }

  function readGalleryPrefsOverrides() {
    applyLoadedGalleryPrefs(loadGalleryStagingPrefsObject());
    if (showStagingGalleryToolbar && typeof syncStagingPanelSelectsFromState === "function") {
      syncStagingPanelSelectsFromState();
    }
  }

  readGalleryPrefsOverrides();
  syncZoomOpenAnimClasses();
  syncZoomSpreadBookMode();

  function onStagingGallerySettingsEvent(ev) {
    if (!showStagingGalleryToolbar) {
      return;
    }
    const id = ev && ev.detail && ev.detail.galleryStorageId;
    if (id != null && id !== galleryPrefsStorageId) {
      return;
    }
    readGalleryPrefsOverrides();
  }
  if (showStagingGalleryToolbar) {
    window.addEventListener(STAGING_GALLERY_SETTINGS_EVENT, onStagingGallerySettingsEvent);
  }

  function syncHalfClickNavState() {
    root.classList.toggle("draggable-gallery--half-click-nav", stripHalfClickNavActive);
  }

  function applyZoomOpenGridVars() {
    try {
      const tracks = buildDividedGridTracks(zoomDiv.count, zoomDiv.ratioCsv);
      root.style.setProperty("--draggable-gallery-zoom-columns", tracks);
      root.style.setProperty("--draggable-gallery-zoom-rows", tracks);
    } catch {
      root.style.setProperty(
        "--draggable-gallery-zoom-columns",
        "minmax(0, 1fr) minmax(0, 3fr)",
      );
      root.style.setProperty(
        "--draggable-gallery-zoom-rows",
        "minmax(0, 1fr) minmax(0, 3fr)",
      );
    }
  }

  root.classList.add("draggable-gallery");
  applyZoomOpenGridVars();
  if (defaultCursor) {
    root.classList.add("draggable-gallery--default-cursor");
  }
  if (zoomThumbFill) {
    root.classList.add("draggable-gallery--zoom-thumbs-fill");
  }
  if (zoomPaneMaxHeight) {
    root.style.setProperty("--draggable-gallery-zoom-pane-max", zoomPaneMaxHeight);
  }

  root.innerHTML = `
    <div class="draggable-gallery__viewport" tabindex="0" role="region" aria-label="Image gallery">
      <div class="draggable-gallery__track" role="list"></div>
      <div class="draggable-gallery__viewport-edge-nav">
        <button type="button" class="draggable-gallery__edge-prev" tabindex="-1" aria-label="Previous image"></button>
        <button type="button" class="draggable-gallery__edge-next" tabindex="-1" aria-label="Next image"></button>
      </div>
    </div>
    <aside class="draggable-gallery__zoom" aria-hidden="true">
      <div class="draggable-gallery__zoom-spread">
        <div class="draggable-gallery__zoom-book-left">
          <div class="draggable-gallery__zoom-book-under-prev">
            <div class="draggable-gallery__zoom-book-crop">
              <img class="draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--under-prev" alt="">
            </div>
          </div>
          <div class="draggable-gallery__zoom-book-left-static">
            <div class="draggable-gallery__zoom-book-left-static-stack">
              <div class="draggable-gallery__zoom-book-crop draggable-gallery__zoom-book-crop--left-static-layer">
                <img class="draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--left" alt="">
              </div>
              <div
                class="draggable-gallery__zoom-book-crop draggable-gallery__zoom-book-crop--left-static-layer draggable-gallery__zoom-book-crop--left-static-incoming"
              >
                <img class="draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--left-incoming" alt="">
              </div>
            </div>
          </div>
          <div class="draggable-gallery__zoom-book-flipper draggable-gallery__zoom-book-flipper--left">
            <div class="draggable-gallery__zoom-book-face draggable-gallery__zoom-book-face--front">
              <div class="draggable-gallery__zoom-book-crop">
                <img class="draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--left-leaf" alt="">
              </div>
            </div>
            <div class="draggable-gallery__zoom-book-face draggable-gallery__zoom-book-face--back">
              <div class="draggable-gallery__zoom-book-paper-back" aria-hidden="true"></div>
            </div>
          </div>
        </div>
        <div class="draggable-gallery__zoom-book-right">
          <div class="draggable-gallery__zoom-book-under">
            <div class="draggable-gallery__zoom-book-crop">
              <img class="draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--under" alt="">
            </div>
          </div>
          <div class="draggable-gallery__zoom-book-right-static">
            <div class="draggable-gallery__zoom-book-right-static-stack">
              <div class="draggable-gallery__zoom-book-crop draggable-gallery__zoom-book-crop--right-static-layer">
                <img class="draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--right-static" alt="">
              </div>
              <div
                class="draggable-gallery__zoom-book-crop draggable-gallery__zoom-book-crop--right-static-layer draggable-gallery__zoom-book-crop--right-static-incoming"
              >
                <img class="draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--right-static-incoming" alt="">
              </div>
            </div>
          </div>
          <div class="draggable-gallery__zoom-book-flipper draggable-gallery__zoom-book-flipper--right">
            <div class="draggable-gallery__zoom-book-face draggable-gallery__zoom-book-face--front">
              <div class="draggable-gallery__zoom-book-crop">
                <img class="draggable-gallery__zoom-image draggable-gallery__zoom-book-img draggable-gallery__zoom-book-img--front" alt="">
              </div>
            </div>
            <div class="draggable-gallery__zoom-book-face draggable-gallery__zoom-book-face--back">
              <div class="draggable-gallery__zoom-book-paper-back" aria-hidden="true"></div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  `;

  const viewport = root.querySelector(".draggable-gallery__viewport");
  const track = root.querySelector(".draggable-gallery__track");
  const zoom = root.querySelector(".draggable-gallery__zoom");
  zoomSpread = root.querySelector(".draggable-gallery__zoom-spread");
  if (zoomSpread) {
    zoomSpread.style.setProperty(
      "--draggable-gallery-bookflip-dur",
      `${GALLERY_BOOKFLIP_MS}ms`,
    );
  }
  zoomBookFlipperRight = root.querySelector(".draggable-gallery__zoom-book-flipper--right");
  zoomBookFlipperLeft = root.querySelector(".draggable-gallery__zoom-book-flipper--left");
  zoomImgLeft = root.querySelector(".draggable-gallery__zoom-book-img--left");
  zoomImgLeftIncoming = root.querySelector(".draggable-gallery__zoom-book-img--left-incoming");
  zoomImgLeftLeaf = root.querySelector(".draggable-gallery__zoom-book-img--left-leaf");
  zoomImgUnder = root.querySelector(".draggable-gallery__zoom-book-img--under");
  zoomImgUnderPrev = root.querySelector(".draggable-gallery__zoom-book-img--under-prev");
  zoomImgRightStatic = root.querySelector(".draggable-gallery__zoom-book-img--right-static");
  zoomImgRightStaticIncoming = root.querySelector(
    ".draggable-gallery__zoom-book-img--right-static-incoming",
  );
  const zoomImg = root.querySelector(".draggable-gallery__zoom-image");
  const edgePrev = root.querySelector(".draggable-gallery__edge-prev");
  const edgeNext = root.querySelector(".draggable-gallery__edge-next");

  syncZoomSpreadBookMode();

  /** @type {HTMLElement | null} */
  let stagingTestingPanelEl = null;
  /** @type {(() => void) | null} */
  let stagingTestingPanelTeardown = null;

  if (showStagingGalleryToolbar) {
    root.classList.add("draggable-gallery--staging");
    const gid = galleryPrefsStorageId;

    const labelRow = document.createElement("div");
    labelRow.className = "draggable-gallery__staging-label-row";
    const labelBtn = document.createElement("button");
    labelBtn.type = "button";
    labelBtn.className = "draggable-gallery__staging-gallery-label";
    labelBtn.id = `${gid}-gallery-staging-label`;
    labelBtn.textContent = "Gallery testing";
    labelBtn.setAttribute("aria-expanded", "false");
    labelBtn.setAttribute("aria-controls", `staging-testing-panel-${gid}`);
    labelBtn.setAttribute(
      "aria-label",
      "Open or close testing options for this gallery",
    );
    labelRow.appendChild(labelBtn);
    root.insertBefore(labelRow, root.firstChild);

    const panel = document.createElement("div");
    panel.id = `staging-testing-panel-${gid}`;
    panel.className = "staging-testing-panel";
    panel.setAttribute("hidden", "");
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-labelledby", labelBtn.id);

    const header = document.createElement("div");
    header.className = "staging-testing-panel__header";
    const title = document.createElement("span");
    title.className = "staging-testing-panel__title";
    title.textContent = "Gallery testing";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "staging-testing-panel__close";
    closeBtn.setAttribute("aria-label", "Close gallery testing options");
    closeBtn.innerHTML = "&times;";

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "staging-testing-panel__body";

    const hint = document.createElement("p");
    hint.className = "staging-testing-panel__hint";
    hint.textContent =
      "Options apply to this gallery only. While staging, values stay in session storage until you reload. Save & publish to live copies the current JSON to localStorage for the same gallery id; open the page without staging to use that snapshot. Drag the header to move.";

    function addField(fieldId, labelText, selectEl) {
      const wrap = document.createElement("div");
      wrap.className = "staging-testing-panel__field";
      const lab = document.createElement("label");
      lab.className = "staging-testing-panel__field-label";
      lab.setAttribute("for", fieldId);
      lab.textContent = labelText;
      selectEl.id = fieldId;
      wrap.appendChild(lab);
      wrap.appendChild(selectEl);
      body.appendChild(wrap);
    }

    const navFieldset = document.createElement("fieldset");
    navFieldset.className = "staging-testing-panel__fieldset staging-testing-panel__nav-checklist";
    const navLegend = document.createElement("legend");
    navLegend.className = "staging-testing-panel__fieldset-legend";
    navLegend.textContent = "Nav mode";

    const navLabelHalf = document.createElement("label");
    navLabelHalf.className = "staging-testing-panel__check-row";
    const navCbHalf = document.createElement("input");
    navCbHalf.type = "checkbox";
    navCbHalf.id = `staging-testing-nav-half-${gid}`;
    const navTxtHalf = document.createElement("span");
    navTxtHalf.textContent = "Half-click strip + zoom halves";
    navLabelHalf.appendChild(navCbHalf);
    navLabelHalf.appendChild(navTxtHalf);

    const navLabelClose = document.createElement("label");
    navLabelClose.className = "staging-testing-panel__check-row";
    const navCbClose = document.createElement("input");
    navCbClose.type = "checkbox";
    navCbClose.id = `staging-testing-nav-close-${gid}`;
    const navTxtClose = document.createElement("span");
    navTxtClose.textContent = "Zoom pane tap closes";
    navLabelClose.appendChild(navCbClose);
    navLabelClose.appendChild(navTxtClose);

    navFieldset.appendChild(navLegend);
    navFieldset.appendChild(navLabelHalf);
    navFieldset.appendChild(navLabelClose);

    const navModeWrap = document.createElement("div");
    navModeWrap.className = "staging-testing-panel__field";
    navModeWrap.appendChild(navFieldset);

    function getStripNavFromNavCheckboxes() {
      return navCbClose.checked ? "zoom-close" : "half-click";
    }

    function syncNavCheckboxesFromPrefs(stripNav) {
      const half = stripNav === "half-click";
      navCbHalf.checked = half;
      navCbClose.checked = !half;
    }

    function onNavHalfChange() {
      if (navCbHalf.checked) {
        navCbClose.checked = false;
      } else if (!navCbClose.checked) {
        navCbHalf.checked = true;
      }
      persistPrefsFromSelectors();
    }

    function onNavCloseChange() {
      if (navCbClose.checked) {
        navCbHalf.checked = false;
      } else if (!navCbHalf.checked) {
        navCbClose.checked = true;
      }
      persistPrefsFromSelectors();
    }

    navCbHalf.addEventListener("change", onNavHalfChange);
    navCbClose.addEventListener("change", onNavCloseChange);

    function fillStripThumbnailActionSelect(sel) {
      const oToggle = document.createElement("option");
      oToggle.value = "toggle_zoom";
      oToggle.textContent = "Open / toggle zoom";
      const oSelect = document.createElement("option");
      oSelect.value = "select_only";
      oSelect.textContent = "Select thumbnail only (no zoom)";
      const oNone = document.createElement("option");
      oNone.value = "none";
      oNone.textContent = "No action";
      sel.appendChild(oToggle);
      sel.appendChild(oSelect);
      sel.appendChild(oNone);
    }

    const stripClickActSel = document.createElement("select");
    stripClickActSel.setAttribute("aria-label", "Click on strip thumbnail");
    fillStripThumbnailActionSelect(stripClickActSel);

    const stripDblclickActSel = document.createElement("select");
    stripDblclickActSel.setAttribute("aria-label", "Double-click on strip thumbnail");
    fillStripThumbnailActionSelect(stripDblclickActSel);

    const stripCtxActSel = document.createElement("select");
    stripCtxActSel.setAttribute("aria-label", "Right-click on strip thumbnail");
    fillStripThumbnailActionSelect(stripCtxActSel);

    const scrollSel = document.createElement("select");
    scrollSel.setAttribute("aria-label", "Strip scroll behavior");
    const scSmooth = document.createElement("option");
    scSmooth.value = "smooth";
    scSmooth.textContent = "Smooth";
    const scInstant = document.createElement("option");
    scInstant.value = "instant";
    scInstant.textContent = "Instant";
    const scAuto = document.createElement("option");
    scAuto.value = "auto";
    scAuto.textContent = "Auto";
    scrollSel.appendChild(scSmooth);
    scrollSel.appendChild(scInstant);
    scrollSel.appendChild(scAuto);

    const zoomAnimSel = document.createElement("select");
    zoomAnimSel.setAttribute("aria-label", "Zoom panel open and close animation");
    const zaNone = document.createElement("option");
    zaNone.value = "none";
    zaNone.textContent = "None (instant)";
    const zaSlide = document.createElement("option");
    zaSlide.value = "slide";
    zaSlide.textContent = "Slide + fade (default)";
    const zaFade = document.createElement("option");
    zaFade.value = "fade";
    zaFade.textContent = "Fade only";
    const zaScale = document.createElement("option");
    zaScale.value = "scale";
    zaScale.textContent = "Scale + fade";
    zoomAnimSel.appendChild(zaNone);
    zoomAnimSel.appendChild(zaSlide);
    zoomAnimSel.appendChild(zaFade);
    zoomAnimSel.appendChild(zaScale);

    const slideTransSel = document.createElement("select");
    slideTransSel.setAttribute("aria-label", "Animation when changing zoom image");
    const stNone = document.createElement("option");
    stNone.value = "none";
    stNone.textContent = "None (instant)";
    const stXf = document.createElement("option");
    stXf.value = "crossfade";
    stXf.textContent = "Crossfade";
    const stBf = document.createElement("option");
    stBf.value = "bookflip";
    stBf.textContent = "Book flip";
    slideTransSel.appendChild(stNone);
    slideTransSel.appendChild(stXf);
    slideTransSel.appendChild(stBf);

    body.appendChild(hint);
    body.appendChild(navModeWrap);
    addField(`staging-testing-strip-click-${gid}`, "Click on thumbnail", stripClickActSel);
    addField(`staging-testing-strip-dbl-${gid}`, "Double-click on thumbnail", stripDblclickActSel);
    addField(`staging-testing-strip-ctx-${gid}`, "Right-click on thumbnail", stripCtxActSel);
    addField(`staging-testing-scroll-${gid}`, "Strip scroll", scrollSel);
    addField(`staging-testing-zoom-anim-${gid}`, "Zoom open/close", zoomAnimSel);
    addField(`staging-testing-slide-trans-${gid}`, "Zoom image change", slideTransSel);

    function persistPrefsFromSelectors() {
      let sca = normalizeStripGestureAction(stripClickActSel.value);
      let sda = normalizeStripGestureAction(stripDblclickActSel.value);
      let sea = normalizeStripGestureAction(stripCtxActSel.value);
      if (sca === "none" && sda === "none" && sea === "none") {
        sca = "toggle_zoom";
        stripClickActSel.value = "toggle_zoom";
      }
      const p = {
        stripNav: getStripNavFromNavCheckboxes(),
        stripClickAction: sca,
        stripDblclickAction: sda,
        stripContextmenuAction: sea,
        scroll:
          scrollSel.value === "instant" || scrollSel.value === "auto" || scrollSel.value === "smooth"
            ? scrollSel.value
            : "smooth",
        zoomOpenAnim: normalizeZoomOpenAnim(zoomAnimSel.value),
        slideTransition: normalizeSlideTransition(slideTransSel.value),
      };
      try {
        sessionStorage.setItem(
          stagingGalleryPrefsStorageKey(gid),
          JSON.stringify(p),
        );
      } catch (_e) {
        /* ignore */
      }
      applyLoadedGalleryPrefs(p);
      dispatchThisGalleryStagingSettings();
    }

    const publishWrap = document.createElement("div");
    publishWrap.className = "staging-testing-panel__publish-row";
    const publishBtn = document.createElement("button");
    publishBtn.type = "button";
    publishBtn.className = "staging-testing-panel__publish";
    publishBtn.textContent = "Save & publish to live";
    const publishFeedback = document.createElement("p");
    publishFeedback.className = "staging-testing-panel__publish-feedback";
    publishFeedback.setAttribute("aria-live", "polite");
    publishWrap.appendChild(publishBtn);
    publishWrap.appendChild(publishFeedback);
    body.appendChild(publishWrap);

    function onPublishClick(e) {
      e.preventDefault();
      e.stopPropagation();
      persistPrefsFromSelectors();
      let raw;
      try {
        raw = sessionStorage.getItem(stagingGalleryPrefsStorageKey(gid));
      } catch (_e) {
        raw = null;
      }
      if (!raw) {
        publishFeedback.textContent = "Nothing saved yet.";
        return;
      }
      try {
        localStorage.setItem(publishedGalleryPrefsStorageKey(gid), raw);
        publishFeedback.textContent =
          "Saved to live. Reload without staging in the URL to use these settings.";
      } catch (_err) {
        publishFeedback.textContent = "Could not save (storage full or blocked).";
      }
    }
    publishBtn.addEventListener("click", onPublishClick);

    stripClickActSel.addEventListener("change", persistPrefsFromSelectors);
    stripDblclickActSel.addEventListener("change", persistPrefsFromSelectors);
    stripCtxActSel.addEventListener("change", persistPrefsFromSelectors);

    scrollSel.addEventListener("change", persistPrefsFromSelectors);
    zoomAnimSel.addEventListener("change", persistPrefsFromSelectors);
    slideTransSel.addEventListener("change", persistPrefsFromSelectors);

    syncStagingPanelSelectsFromState = function syncStagingPanelSelectsFromStateFn() {
      const p = loadGalleryStagingPrefsObject();
      syncNavCheckboxesFromPrefs(p.stripNav);
      stripClickActSel.value = p.stripClickAction;
      stripDblclickActSel.value = p.stripDblclickAction;
      stripCtxActSel.value = p.stripContextmenuAction;
      scrollSel.value = p.scroll;
      zoomAnimSel.value = p.zoomOpenAnim;
      slideTransSel.value = p.slideTransition;
    };
    syncStagingPanelSelectsFromState();

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
    stagingTestingPanelEl = panel;

    function setPanelHidden(hidden) {
      if (hidden) {
        panel.setAttribute("hidden", "");
        labelBtn.setAttribute("aria-expanded", "false");
      } else {
        panel.removeAttribute("hidden");
        labelBtn.setAttribute("aria-expanded", "true");
      }
    }

    function placePanelNearGalleryIfNeeded() {
      try {
        const posRaw = sessionStorage.getItem(stagingGalleryPanelPosStorageKey(gid));
        if (posRaw) {
          const pos = JSON.parse(posRaw);
          if (pos && typeof pos.left === "string" && typeof pos.top === "string") {
            panel.style.left = pos.left;
            panel.style.top = pos.top;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
            return;
          }
        }
      } catch (_e) {
        /* ignore */
      }
      const r = root.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.round(r.left))}px`;
      panel.style.top = `${Math.round(Math.min(window.innerHeight - 120, r.bottom + 8))}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }

    function onLabelClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const open = panel.hasAttribute("hidden");
      if (open) {
        placePanelNearGalleryIfNeeded();
        setPanelHidden(false);
      } else {
        setPanelHidden(true);
      }
    }
    labelBtn.addEventListener("click", onLabelClick);

    function onCloseClick(e) {
      e.preventDefault();
      e.stopPropagation();
      setPanelHidden(true);
    }
    closeBtn.addEventListener("click", onCloseClick);

    let drag = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function onDragMove(ev) {
      if (!drag) {
        return;
      }
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${startTop + dy}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }

    function onDragUp() {
      if (!drag) {
        return;
      }
      drag = false;
      try {
        sessionStorage.setItem(
          stagingGalleryPanelPosStorageKey(gid),
          JSON.stringify({ left: panel.style.left, top: panel.style.top }),
        );
      } catch (_e) {
        /* ignore */
      }
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragUp);
    }

    function onHeaderMouseDown(ev) {
      if (ev.button !== 0 || ev.target.closest(".staging-testing-panel__close")) {
        return;
      }
      drag = true;
      startX = ev.clientX;
      startY = ev.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${startLeft}px`;
      panel.style.top = `${startTop}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      ev.preventDefault();
      window.addEventListener("mousemove", onDragMove);
      window.addEventListener("mouseup", onDragUp);
    }

    header.addEventListener("mousedown", onHeaderMouseDown);

    stagingTestingPanelTeardown = function stagingTestingPanelTeardownFn() {
      header.removeEventListener("mousedown", onHeaderMouseDown);
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragUp);
      labelBtn.removeEventListener("click", onLabelClick);
      closeBtn.removeEventListener("click", onCloseClick);
      navCbHalf.removeEventListener("change", onNavHalfChange);
      navCbClose.removeEventListener("change", onNavCloseChange);
      stripClickActSel.removeEventListener("change", persistPrefsFromSelectors);
      stripDblclickActSel.removeEventListener("change", persistPrefsFromSelectors);
      stripCtxActSel.removeEventListener("change", persistPrefsFromSelectors);
      scrollSel.removeEventListener("change", persistPrefsFromSelectors);
      zoomAnimSel.removeEventListener("change", persistPrefsFromSelectors);
      slideTransSel.removeEventListener("change", persistPrefsFromSelectors);
      publishBtn.removeEventListener("click", onPublishClick);
      if (panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }
      if (labelRow.parentNode) {
        labelRow.parentNode.removeChild(labelRow);
      }
      stagingTestingPanelEl = null;
      syncStagingPanelSelectsFromState = null;
    };
  }

  let activeSlide = null;
  let enterTimer = null;
  /** Exit animation: timeout fallback if `transitionend` does not fire. */
  let exitTimer = null;
  /** @type {((e: TransitionEvent) => void) | null} */
  let zoomCloseTransitionEndHandler = null;
  /** Cancel in-flight crossfade / bookflip (returned dispose from `runCrossfadeImageSwap` / `runBookflipImageSwap`). */
  /** @type {(() => void) | null} */
  let cancelSlideSwapAnim = null;
  /** Index of the “current” slide for prev/next when the strip has no active zoom selection. */
  let stripFocusIndex = 0;

  function getSlides() {
    return [...track.querySelectorAll(".draggable-gallery__slide")];
  }

  function scrollStripItemIntoView(el, inlineCenter) {
    if (!el) {
      return;
    }
    const o = inlineCenter
      ? { block: "nearest", inline: "center", behavior: galleryScrollBehavior }
      : { block: "nearest", behavior: galleryScrollBehavior };
    el.scrollIntoView(o);
  }

  function stepSlide(delta) {
    const slides = getSlides();
    if (!slides.length) {
      return;
    }
    let i = activeSlide ? slides.indexOf(activeSlide) : stripFocusIndex;
    if (i < 0) {
      i = 0;
    }
    i = wrapGalleryIndex(i + delta, slides.length);
    stripFocusIndex = i;
    const slide = slides[i];
    scrollStripItemIntoView(slide, true);
    if (root.classList.contains("draggable-gallery--zoom-open") && !isMobileZoomDisabled()) {
      zoomImage(slide, delta);
    }
  }

  function goNext() {
    stepSlide(1);
  }

  function goPrev() {
    stepSlide(-1);
  }

  function onViewportKeyDown(event) {
    if (!stripHalfClickNavActive) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrev();
    }
  }

  function onEdgeNavClick(event) {
    if (!stripHalfClickNavActive) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.classList.contains("draggable-gallery__edge-next")) {
      goNext();
    } else {
      goPrev();
    }
  }

  function isMobileZoomDisabled() {
    return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches;
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function onGalleryResize() {
    if (isMobileZoomDisabled() && root.classList.contains("draggable-gallery--zoom-open")) {
      closeZoom({ immediate: true });
    }
  }
  window.addEventListener("resize", onGalleryResize);

  function onZoomPaneClick(event) {
    if (!root.classList.contains("draggable-gallery--zoom-open")) {
      return;
    }
    if (stripHalfClickNavActive && !isMobileZoomDisabled()) {
      const rect = zoom.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const mid = rect.left + rect.width * 0.5;
      event.preventDefault();
      event.stopPropagation();
      if (event.clientX < mid) {
        goPrev();
      } else {
        goNext();
      }
      return;
    }
    closeZoom();
  }

  if (zoom) {
    zoom.addEventListener("click", onZoomPaneClick);
  }

  if (viewport) {
    viewport.addEventListener("keydown", onViewportKeyDown);
  }
  if (edgePrev && edgeNext) {
    edgePrev.addEventListener("click", onEdgeNavClick);
    edgeNext.addEventListener("click", onEdgeNavClick);
  }

  function clearZoomExitAnimation() {
    if (exitTimer != null) {
      window.clearTimeout(exitTimer);
      exitTimer = null;
    }
    if (zoom && zoomCloseTransitionEndHandler) {
      zoom.removeEventListener("transitionend", zoomCloseTransitionEndHandler);
      zoomCloseTransitionEndHandler = null;
    }
  }

  function finishZoomClose() {
    clearZoomExitAnimation();
    if (cancelSlideSwapAnim) {
      cancelSlideSwapAnim();
      cancelSlideSwapAnim = null;
    }
    if (activeSlide) {
      activeSlide.classList.remove("is-active");
      activeSlide = null;
    }
    root.classList.remove("draggable-gallery--zoom-open");
    if (zoom) {
      zoom.classList.remove(
        "draggable-gallery__zoom--bookflip-running",
        "draggable-gallery__zoom--bookflip-dir-prev",
      );
    }
    for (const flip of [zoomBookFlipperRight, zoomBookFlipperLeft]) {
      if (!flip) continue;
      flip.classList.remove(
        "draggable-gallery__zoom-book-flipper--turn-book-next",
        "draggable-gallery__zoom-book-flipper--turn-book-prev",
        "draggable-gallery__zoom-book-flipper--turn-next",
        "draggable-gallery__zoom-book-flipper--turn-prev",
      );
      flip.style.transition = "";
    }
    if (zoom && zoomImg) {
      zoom.classList.remove("is-visible", "is-entering");
      zoom.setAttribute("aria-hidden", "true");
      zoomImg.classList.remove(
        "draggable-gallery__zoom-image--xfade-out",
        "draggable-gallery__zoom-image--xfade-in",
      );
      zoomImg.classList.remove(
        "draggable-gallery__zoom-book-img--crop-left",
        "draggable-gallery__zoom-book-img--crop-right",
        "draggable-gallery__zoom-book-img--crop-full",
      );
      zoomImg.src = "";
      zoomImg.alt = "";
      zoomImg.removeAttribute("srcset");
      zoomImg.removeAttribute("sizes");
      if ("fetchPriority" in zoomImg) {
        zoomImg.fetchPriority = "auto";
      } else {
        zoomImg.removeAttribute("fetchpriority");
      }
    }
    for (const el of [
      zoomImgLeft,
      zoomImgLeftIncoming,
      zoomImgLeftLeaf,
      zoomImgUnder,
      zoomImgUnderPrev,
      zoomImgRightStatic,
      zoomImgRightStaticIncoming,
    ]) {
      if (!el) continue;
      el.classList.remove(
        "draggable-gallery__zoom-book-img--crop-left",
        "draggable-gallery__zoom-book-img--crop-right",
        "draggable-gallery__zoom-book-img--crop-full",
      );
      el.src = "";
      el.alt = "";
      el.removeAttribute("srcset");
      el.removeAttribute("sizes");
      if ("fetchPriority" in el) {
        el.fetchPriority = "auto";
      } else {
        el.removeAttribute("fetchpriority");
      }
    }
  }

  /**
   * @param {{ immediate?: boolean }} [options] – `immediate: true` skips exit transition (resize, teardown, clear).
   */
  function closeZoom(options) {
    const immediate = options && options.immediate === true;

    if (cancelSlideSwapAnim) {
      cancelSlideSwapAnim();
      cancelSlideSwapAnim = null;
    }

    if (enterTimer) {
      window.clearTimeout(enterTimer);
      enterTimer = null;
    }

    if (!root.classList.contains("draggable-gallery--zoom-open")) {
      clearZoomExitAnimation();
      return;
    }

    if (!immediate && zoom && !zoom.classList.contains("is-visible") && exitTimer != null) {
      return;
    }

    if (
      immediate ||
      !zoom ||
      !zoomImg ||
      isMobileZoomDisabled() ||
      prefersReducedMotion() ||
      galleryZoomOpenAnim === "none"
    ) {
      clearZoomExitAnimation();
      finishZoomClose();
      return;
    }

    clearZoomExitAnimation();

    zoom.classList.remove("is-visible", "is-entering");

    let settled = false;
    function settleZoomClose() {
      if (settled) {
        return;
      }
      settled = true;
      clearZoomExitAnimation();
      finishZoomClose();
    }

    zoomCloseTransitionEndHandler = function zoomCloseTransitionEndHandlerFn(ev) {
      if (ev.target !== zoom) {
        return;
      }
      if (ev.propertyName !== "opacity" && ev.propertyName !== "transform") {
        return;
      }
      settleZoomClose();
    };
    zoom.addEventListener("transitionend", zoomCloseTransitionEndHandler);
    exitTimer = window.setTimeout(settleZoomClose, 400);
  }

  function partnerStripImg(slide, delta) {
    const slidesNow = getSlides();
    const i = slidesNow.indexOf(slide);
    if (i < 0 || !slidesNow.length) {
      return slide.querySelector("img");
    }
    const j = wrapGalleryIndex(i + delta, slidesNow.length);
    return slidesNow[j].querySelector("img") || slide.querySelector("img");
  }

  /**
   * @param {HTMLImageElement | null} targetImg
   * @param {HTMLImageElement | null} sourceImg
   * @param {"left" | "right" | "full"} crop
   */
  function copyStripImgToBookPart(targetImg, sourceImg, crop) {
    if (!targetImg || !sourceImg) {
      return;
    }
    const zoomSrc = sourceImg.dataset.fullSrc || sourceImg.getAttribute("src") || "";
    targetImg.src = zoomSrc;
    targetImg.alt = sourceImg.alt || "";
    const zss = sourceImg.dataset.fullSrcset || sourceImg.getAttribute("srcset") || "";
    if (zss) {
      targetImg.setAttribute("srcset", zss);
    } else {
      targetImg.removeAttribute("srcset");
    }
    targetImg.setAttribute("sizes", sourceImg.dataset.fullSizes || zoomImageSizes);
    if ("fetchPriority" in targetImg) {
      targetImg.fetchPriority = "high";
    } else {
      targetImg.setAttribute("fetchpriority", "high");
    }
    targetImg.classList.remove(
      "draggable-gallery__zoom-book-img--crop-left",
      "draggable-gallery__zoom-book-img--crop-right",
      "draggable-gallery__zoom-book-img--crop-full",
    );
    targetImg.classList.add(`draggable-gallery__zoom-book-img--crop-${crop}`);
  }

  function applyZoomBookPreFlip(outSlide, inSlide, navDir) {
    const outIm = outSlide && outSlide.querySelector("img");
    const inIm = inSlide && inSlide.querySelector("img");
    if (!outIm || !inIm || !zoomImgLeft || !zoomImgUnder || !zoomImg) {
      return;
    }
    if (navDir >= 0) {
      copyStripImgToBookPart(zoomImgLeft, outIm, "left");
      if (zoomImgLeftIncoming) {
        copyStripImgToBookPart(zoomImgLeftIncoming, inIm, "left");
      }
      copyStripImgToBookPart(zoomImgUnder, inIm, "full");
      copyStripImgToBookPart(zoomImg, outIm, "right");
      return;
    }
    if (!zoomImgLeftLeaf || !zoomImgUnderPrev || !zoomImgRightStatic) {
      return;
    }
    copyStripImgToBookPart(zoomImgUnderPrev, inIm, "full");
    copyStripImgToBookPart(zoomImgLeftLeaf, outIm, "left");
    copyStripImgToBookPart(zoomImgRightStatic, outIm, "right");
    if (zoomImgRightStaticIncoming) {
      copyStripImgToBookPart(zoomImgRightStaticIncoming, inIm, "right");
    }
  }

  function applyZoomSrcFromSlide(slide) {
    const im = slide.querySelector("img");
    if (!im || !zoomImg) {
      return;
    }

    if (
      gallerySlideTransition === "bookflip" &&
      zoomSpread &&
      zoomSpread.classList.contains("draggable-gallery__zoom-spread--book") &&
      zoomImgLeft &&
      zoomImgUnder
    ) {
      const nextIm = partnerStripImg(slide, 1);
      const prevIm = partnerStripImg(slide, -1);
      copyStripImgToBookPart(zoomImgLeft, im, "left");
      if (zoomImgLeftIncoming) {
        copyStripImgToBookPart(zoomImgLeftIncoming, im, "left");
      }
      copyStripImgToBookPart(zoomImgUnder, nextIm, "full");
      copyStripImgToBookPart(zoomImg, im, "right");
      if (zoomImgLeftLeaf) {
        copyStripImgToBookPart(zoomImgLeftLeaf, im, "left");
      }
      if (zoomImgUnderPrev) {
        copyStripImgToBookPart(zoomImgUnderPrev, prevIm, "full");
      }
      if (zoomImgRightStatic) {
        copyStripImgToBookPart(zoomImgRightStatic, im, "right");
      }
      if (zoomImgRightStaticIncoming) {
        copyStripImgToBookPart(zoomImgRightStaticIncoming, im, "right");
      }
      return;
    }

    zoomImg.classList.remove(
      "draggable-gallery__zoom-book-img--crop-left",
      "draggable-gallery__zoom-book-img--crop-right",
      "draggable-gallery__zoom-book-img--crop-full",
    );
    zoomImg.classList.add("draggable-gallery__zoom-book-img--crop-full");
    copyStripImgToBookPart(zoomImg, im, "full");
  }

  /** When both click and double-click open zoom, delay single-click so a double-click does not open twice. */
  const OPEN_ZOOM_CLICK_DEFER_MS = 280;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let openZoomClickTimer = null;

  function flushOpenZoomClickTimer() {
    if (openZoomClickTimer != null) {
      window.clearTimeout(openZoomClickTimer);
      openZoomClickTimer = null;
    }
  }

  /**
   * @param {HTMLElement} slide
   * @param {-1 | 1 | undefined} [navIntentDelta] From `stepSlide` (−1 prev / +1 next). When set, used as
   *   bookflip direction so wrapped indices (e.g. first → last on “previous”) do not invert the turn.
   */
  function zoomImage(slide, navIntentDelta) {
    const img = slide.querySelector("img");
    if (!img || !zoomImg) return;

    const slidesNow = getSlides();
    const ixSlide = slidesNow.indexOf(slide);
    if (ixSlide >= 0) {
      stripFocusIndex = ixSlide;
    }

    if (isMobileZoomDisabled()) {
      return;
    }

    if (cancelSlideSwapAnim) {
      cancelSlideSwapAnim();
      cancelSlideSwapAnim = null;
    }
    flushOpenZoomClickTimer();
    clearZoomExitAnimation();

    const prevSlide = activeSlide;
    const oldIx = prevSlide ? slidesNow.indexOf(prevSlide) : -1;
    const newIx = slidesNow.indexOf(slide);
    const navDir =
      navIntentDelta === -1 || navIntentDelta === 1
        ? navIntentDelta
        : newIx > oldIx
          ? 1
          : newIx < oldIx
            ? -1
            : 1;

    if (activeSlide) activeSlide.classList.remove("is-active");
    activeSlide = slide;
    activeSlide.classList.add("is-active");

    if (enterTimer) {
      window.clearTimeout(enterTimer);
      enterTimer = null;
    }

    const useShellEnterAnimation = !zoom.classList.contains("is-visible");
    const reduceMotion = prefersReducedMotion();
    const shellAnim = reduceMotion ? "none" : galleryZoomOpenAnim;
    const effSlideTrans = reduceMotion ? "none" : gallerySlideTransition;

    root.classList.add("draggable-gallery--zoom-open");
    zoom.setAttribute("aria-hidden", "false");

    if (useShellEnterAnimation) {
      applyZoomSrcFromSlide(slide);
      if (shellAnim === "none") {
        zoom.classList.remove("is-entering");
        zoom.classList.add("is-visible");
      } else {
        zoom.classList.remove("is-visible", "is-entering");
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            zoom.classList.add("is-visible", "is-entering");
            enterTimer = window.setTimeout(function () {
              zoom.classList.remove("is-entering");
              enterTimer = null;
            }, 320);
          });
        });
      }
    } else {
      zoom.classList.remove("is-entering");
      zoom.classList.add("is-visible");
      if (
        effSlideTrans === "bookflip" &&
        zoomSpread &&
        zoomSpread.classList.contains("draggable-gallery__zoom-spread--book") &&
        prevSlide &&
        prevSlide !== slide
      ) {
        const flipperEl = navDir >= 0 ? zoomBookFlipperRight : zoomBookFlipperLeft;
        if (flipperEl) {
          applyZoomBookPreFlip(prevSlide, slide, navDir);
          cancelSlideSwapAnim = runBookflipImageSwap(
            flipperEl,
            zoom,
            navDir,
            function applyBookflipSrc() {
              applyZoomSrcFromSlide(slide);
            },
            function onBookflipDone() {
              cancelSlideSwapAnim = null;
            },
          );
        }
      } else if (
        effSlideTrans === "bookflip" &&
        (zoomBookFlipperRight || zoomBookFlipperLeft)
      ) {
        applyZoomSrcFromSlide(slide);
      } else if (effSlideTrans === "crossfade") {
        cancelSlideSwapAnim = runCrossfadeImageSwap(
          zoomImg,
          function applyXfadeSrc() {
            applyZoomSrcFromSlide(slide);
          },
          function onXfadeDone() {
            cancelSlideSwapAnim = null;
          },
        );
      } else {
        applyZoomSrcFromSlide(slide);
      }
    }

    scrollStripItemIntoView(activeSlide, false);
  }

  function selectStripThumbnailOnly(btn) {
    if (!btn || isMobileZoomDisabled()) {
      return;
    }
    const slidesNow = getSlides();
    const ix = slidesNow.indexOf(btn);
    if (ix < 0) {
      return;
    }
    stripFocusIndex = ix;
    if (activeSlide) {
      activeSlide.classList.remove("is-active");
    }
    activeSlide = btn;
    activeSlide.classList.add("is-active");
    scrollStripItemIntoView(activeSlide, true);
  }

  /**
   * @param {HTMLElement} btn
   * @param {"toggle_zoom" | "select_only" | "none"} action
   */
  function runStripGestureAction(btn, action) {
    if (action === "none") {
      return;
    }
    if (action === "select_only") {
      selectStripThumbnailOnly(btn);
      return;
    }
    handleSlideActivate(btn);
  }

  function handleSlideActivate(btn) {
    if (root.classList.contains("draggable-gallery--zoom-open") && activeSlide === btn) {
      closeZoom();
      return;
    }
    zoomImage(btn);
  }

  function getSlideFromEventTarget(target) {
    if (!target || !track) {
      return null;
    }
    const btn = target.closest(".draggable-gallery__slide");
    if (!btn || !track.contains(btn)) {
      return null;
    }
    return btn;
  }

  function onTrackClick(event) {
    if (galleryStripClickAction === "none") {
      return;
    }
    const btn = getSlideFromEventTarget(event.target);
    if (!btn) {
      return;
    }
    if (
      galleryStripClickAction === "toggle_zoom" &&
      galleryStripDblclickAction === "toggle_zoom"
    ) {
      flushOpenZoomClickTimer();
      openZoomClickTimer = window.setTimeout(function openZoomDeferredClick() {
        openZoomClickTimer = null;
        runStripGestureAction(btn, galleryStripClickAction);
      }, OPEN_ZOOM_CLICK_DEFER_MS);
      return;
    }
    runStripGestureAction(btn, galleryStripClickAction);
  }

  function onTrackDblClick(event) {
    if (galleryStripDblclickAction === "none") {
      return;
    }
    const btn = getSlideFromEventTarget(event.target);
    if (!btn) {
      return;
    }
    if (
      galleryStripClickAction === "toggle_zoom" &&
      galleryStripDblclickAction === "toggle_zoom"
    ) {
      flushOpenZoomClickTimer();
    }
    event.preventDefault();
    runStripGestureAction(btn, galleryStripDblclickAction);
  }

  function onTrackContextMenu(event) {
    if (galleryStripContextmenuAction === "none") {
      return;
    }
    const btn = getSlideFromEventTarget(event.target);
    if (!btn) {
      return;
    }
    event.preventDefault();
    runStripGestureAction(btn, galleryStripContextmenuAction);
  }

  track.addEventListener("click", onTrackClick);
  track.addEventListener("dblclick", onTrackDblClick);
  track.addEventListener("contextmenu", onTrackContextMenu);

  function appendImages(images) {
    const frag = document.createDocumentFragment();
    images.forEach((raw, i) => {
      const entry = normalizeImageEntry(raw);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "draggable-gallery__slide";
      btn.setAttribute("role", "listitem");
      btn.setAttribute("aria-label", "View image larger");
      const img = document.createElement("img");
      img.src = entry.src;
      img.alt = entry.alt;
      if (entry.srcset) {
        img.setAttribute("srcset", entry.srcset);
      } else {
        img.removeAttribute("srcset");
      }
      img.setAttribute("sizes", entry.sizes || stripImageSizes);
      if (entry.fullSrc) {
        img.dataset.fullSrc = entry.fullSrc;
      } else {
        delete img.dataset.fullSrc;
      }
      if (entry.fullSrcset) {
        img.dataset.fullSrcset = entry.fullSrcset;
      } else {
        delete img.dataset.fullSrcset;
      }
      if (entry.fullSizes) {
        img.dataset.fullSizes = entry.fullSizes;
      } else {
        delete img.dataset.fullSizes;
      }
      img.draggable = false;
      const loading = entry.loading ?? (i === 0 ? "eager" : "lazy");
      img.loading = loading;
      const fp = entry.fetchPriority ?? (i === 0 ? "high" : "auto");
      if ("fetchPriority" in img) {
        img.fetchPriority = fp;
      } else {
        img.setAttribute("fetchpriority", fp);
      }
      img.decoding = "async";
      btn.appendChild(img);
      frag.appendChild(btn);
    });
    track.appendChild(frag);
  }

  function clear() {
    closeZoom({ immediate: true });
    stripFocusIndex = 0;
    track.replaceChildren();
  }

  function setImages(images) {
    clear();
    appendImages(images);
  }

  function addImages(images) {
    appendImages(images);
  }

  function destroy() {
    flushOpenZoomClickTimer();
    closeZoom({ immediate: true });
    window.removeEventListener("resize", onGalleryResize);
    if (showStagingGalleryToolbar) {
      window.removeEventListener(STAGING_GALLERY_SETTINGS_EVENT, onStagingGallerySettingsEvent);
      if (typeof stagingTestingPanelTeardown === "function") {
        stagingTestingPanelTeardown();
        stagingTestingPanelTeardown = null;
      }
    }
    track.removeEventListener("click", onTrackClick);
    track.removeEventListener("dblclick", onTrackDblClick);
    track.removeEventListener("contextmenu", onTrackContextMenu);
    if (viewport) {
      viewport.removeEventListener("keydown", onViewportKeyDown);
    }
    if (edgePrev && edgeNext) {
      edgePrev.removeEventListener("click", onEdgeNavClick);
      edgeNext.removeEventListener("click", onEdgeNavClick);
    }
    if (zoom) {
      zoom.removeEventListener("click", onZoomPaneClick);
    }
    root.style.removeProperty("--draggable-gallery-zoom-columns");
    root.style.removeProperty("--draggable-gallery-zoom-rows");
    root.style.removeProperty("--draggable-gallery-zoom-pane-max");
    root.classList.remove(
      "draggable-gallery",
      "draggable-gallery--zoom-open",
      "draggable-gallery--default-cursor",
      "draggable-gallery--zoom-thumbs-fill",
      "draggable-gallery--half-click-nav",
      "draggable-gallery--staging",
      "draggable-gallery--zoom-open-anim-none",
      "draggable-gallery--zoom-open-anim-slide",
      "draggable-gallery--zoom-open-anim-fade",
      "draggable-gallery--zoom-open-anim-scale",
    );
    root.replaceChildren();
  }

  return {
    setImages,
    addImages,
    clear,
    destroy,
    goNext,
    goPrev,
    element: root,
  };
}
