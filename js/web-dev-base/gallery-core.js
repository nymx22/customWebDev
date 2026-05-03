/**
 * Reusable gallery helpers: lightbox from DOM + strip/zoom gallery (expects matching CSS).
 */

import { buildDividedGridTracks } from "./frame-layout.js";

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
 * }} [options] – `zoomOpenDividers` defaults to two columns `1,3` (thumb rail ∶ zoom pane). `zoomThumbFill` true = fixed-height thumbs cropped with `object-fit: cover`; default = full rail width, whole image, variable thumb height. `zoomPaneMaxHeight` = CSS length for max height of both rail and zoom when open (e.g. `"min(85dvh, calc(100dvh - 8rem))"`); caps pane to wrapper/viewport; left scrolls, right does not. `stripImageSizes` / `zoomImageSizes` override defaults for responsive `sizes` on strip and zoom pane (see `DEFAULT_STRIP_IMAGE_SIZES`, `DEFAULT_ZOOM_IMAGE_SIZES`).
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
    </div>
    <aside class="draggable-gallery__zoom" aria-hidden="true">
      <img class="draggable-gallery__zoom-image" alt="">
    </aside>
  `;

  const track = root.querySelector(".draggable-gallery__track");
  const zoom = root.querySelector(".draggable-gallery__zoom");
  const zoomImg = root.querySelector(".draggable-gallery__zoom-image");

  let activeSlide = null;
  let enterTimer = null;

  function isMobileZoomDisabled() {
    return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches;
  }

  function onGalleryResize() {
    if (isMobileZoomDisabled() && root.classList.contains("draggable-gallery--zoom-open")) {
      closeZoom();
    }
  }
  window.addEventListener("resize", onGalleryResize);

  function onZoomPanelClick() {
    if (root.classList.contains("draggable-gallery--zoom-open")) {
      closeZoom();
    }
  }

  if (zoom) {
    zoom.addEventListener("click", onZoomPanelClick);
  }

  function closeZoom() {
    if (enterTimer) {
      window.clearTimeout(enterTimer);
      enterTimer = null;
    }
    if (activeSlide) {
      activeSlide.classList.remove("is-active");
      activeSlide = null;
    }
    root.classList.remove("draggable-gallery--zoom-open");
    if (zoom && zoomImg) {
      zoom.classList.remove("is-visible", "is-entering");
      zoom.setAttribute("aria-hidden", "true");
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
  }

  function zoomImage(slide) {
    const img = slide.querySelector("img");
    if (!img || !zoomImg) return;
    if (isMobileZoomDisabled()) {
      return;
    }

    if (activeSlide) activeSlide.classList.remove("is-active");
    activeSlide = slide;
    activeSlide.classList.add("is-active");

    if (enterTimer) {
      window.clearTimeout(enterTimer);
      enterTimer = null;
    }

    const zoomSrc = img.dataset.fullSrc || img.getAttribute("src") || "";
    zoomImg.src = zoomSrc;
    zoomImg.alt = img.alt || "";
    const zss = img.dataset.fullSrcset || img.getAttribute("srcset") || "";
    if (zss) {
      zoomImg.setAttribute("srcset", zss);
    } else {
      zoomImg.removeAttribute("srcset");
    }
    zoomImg.setAttribute("sizes", img.dataset.fullSizes || zoomImageSizes);
    if ("fetchPriority" in zoomImg) {
      zoomImg.fetchPriority = "high";
    } else {
      zoomImg.setAttribute("fetchpriority", "high");
    }
    root.classList.add("draggable-gallery--zoom-open");
    zoom.setAttribute("aria-hidden", "false");

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

    activeSlide.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

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
      btn.addEventListener("click", function () {
        if (root.classList.contains("draggable-gallery--zoom-open") && activeSlide === btn) {
          closeZoom();
          return;
        }
        zoomImage(btn);
      });
      frag.appendChild(btn);
    });
    track.appendChild(frag);
  }

  function clear() {
    closeZoom();
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
    window.removeEventListener("resize", onGalleryResize);
    if (zoom) {
      zoom.removeEventListener("click", onZoomPanelClick);
    }
    root.style.removeProperty("--draggable-gallery-zoom-columns");
    root.style.removeProperty("--draggable-gallery-zoom-rows");
    root.style.removeProperty("--draggable-gallery-zoom-pane-max");
    root.classList.remove(
      "draggable-gallery",
      "draggable-gallery--zoom-open",
      "draggable-gallery--default-cursor",
      "draggable-gallery--zoom-thumbs-fill",
    );
    root.replaceChildren();
  }

  return {
    setImages,
    addImages,
    clear,
    destroy,
    element: root,
  };
}
