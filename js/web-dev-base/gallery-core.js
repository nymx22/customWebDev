/**
 * Reusable gallery helpers: lightbox from DOM + strip/zoom gallery (expects matching CSS).
 */

import { buildDividedGridTracks } from "./frame-layout.js";

/**
 * @param {string | { src: string, alt?: string }} item
 * @returns {{ src: string, alt: string }}
 */
export function normalizeImageEntry(item) {
  if (typeof item === "string") {
    return { src: item, alt: "" };
  }
  return { src: item.src, alt: item.alt ?? "" };
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

  const open = (index) => {
    current = index;
    image.src = items[current].dataset.full || "";
    lightbox.hidden = false;
    setGalleryBodyScrollLocked(true);
  };

  const close = () => {
    lightbox.hidden = true;
    image.src = "";
    setGalleryBodyScrollLocked(false);
  };

  const step = (dir) => {
    current = wrapGalleryIndex(current + dir, items.length);
    image.src = items[current].dataset.full || "";
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
 * }} [options] – `zoomOpenDividers` defaults to two columns `1,3` (thumb rail ∶ zoom pane). `zoomThumbFill` true = fixed-height thumbs cropped with `object-fit: cover`; default = full rail width, whole image, variable thumb height. `zoomPaneMaxHeight` = CSS length for max height of both rail and zoom when open (e.g. `"min(85dvh, calc(100dvh - 8rem))"`); caps pane to wrapper/viewport; left scrolls, right does not.
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

    zoomImg.src = img.src;
    zoomImg.alt = img.alt || "";
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
    for (const raw of images) {
      const { src, alt } = normalizeImageEntry(raw);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "draggable-gallery__slide";
      btn.setAttribute("role", "listitem");
      btn.setAttribute("aria-label", "View image larger");
      const img = document.createElement("img");
      img.src = src;
      img.alt = alt;
      img.draggable = false;
      img.loading = "lazy";
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
    }
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
