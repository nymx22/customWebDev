/**
 * Horizontal gallery: drag (or trackpad / touch scroll) to move through images.
 *
 * @param {HTMLElement} root – Container; receives `.draggable-gallery`.
 * @returns {{
 *   setImages: (images: (string | { src: string, alt?: string })[]) => void,
 *   addImages: (images: (string | { src: string, alt?: string })[]) => void,
 *   clear: () => void,
 *   destroy: () => void,
 *   element: HTMLElement
 * }}
 */
export function createDraggableGallery(root) {
  if (!root) {
    throw new Error("createDraggableGallery: root element required");
  }

  root.classList.add("draggable-gallery");
  root.innerHTML = `
    <div class="draggable-gallery__viewport" tabindex="0" role="region" aria-label="Image gallery">
      <div class="draggable-gallery__track" role="list"></div>
    </div>
    <aside class="draggable-gallery__zoom" aria-live="polite" hidden>
      <img class="draggable-gallery__zoom-image" alt="">
    </aside>
  `;

  const viewport = root.querySelector(".draggable-gallery__viewport");
  const track = root.querySelector(".draggable-gallery__track");
  const zoom = root.querySelector(".draggable-gallery__zoom");
  const zoomImage = root.querySelector(".draggable-gallery__zoom-image");

  let dragging = false;
  let startClientX = 0;
  let startScrollLeft = 0;
  let activePointerId = null;
  let hasDragged = false;
  let activeSlide = null;
  let zoomTimer = null;

  const normalize = (item) =>
    typeof item === "string" ? { src: item, alt: "" } : { src: item.src, alt: item.alt ?? "" };

  function appendImages(images) {
    const frag = document.createDocumentFragment();
    for (const raw of images) {
      const { src, alt } = normalize(raw);
      const figure = document.createElement("button");
      figure.type = "button";
      figure.className = "draggable-gallery__slide";
      figure.setAttribute("role", "listitem");
      figure.setAttribute("aria-label", "Zoom image");
      const img = document.createElement("img");
      img.src = src;
      img.alt = alt;
      img.draggable = false;
      img.loading = "lazy";
      img.decoding = "async";
      figure.appendChild(img);
      figure.addEventListener("click", function () {
        if (hasDragged) return;
        setZoom(figure, src, alt);
      });
      frag.appendChild(figure);
    }
    track.appendChild(frag);
    if (!activeSlide) {
      const first = track.querySelector(".draggable-gallery__slide");
      if (first) {
        const firstImg = first.querySelector("img");
        setZoom(first, firstImg.src, firstImg.alt);
      }
    }
  }

  function clear() {
    track.replaceChildren();
    activeSlide = null;
    if (zoomTimer) {
      window.clearTimeout(zoomTimer);
      zoomTimer = null;
    }
    if (zoom && zoomImage) {
      zoom.hidden = true;
      zoom.classList.remove("is-visible", "is-entering");
      zoomImage.src = "";
      zoomImage.alt = "";
    }
  }

  function setImages(images) {
    clear();
    appendImages(images);
  }

  function addImages(images) {
    appendImages(images);
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    dragging = true;
    hasDragged = false;
    activePointerId = e.pointerId;
    startClientX = e.clientX;
    startScrollLeft = viewport.scrollLeft;
    viewport.classList.add("is-dragging");
    viewport.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startClientX;
    if (Math.abs(dx) > 6) hasDragged = true;
    viewport.scrollLeft = startScrollLeft - dx;
  }

  function endPointer(e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    viewport.classList.remove("is-dragging");
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  function setZoom(slide, src, alt) {
    if (!zoom || !zoomImage) return;
    if (activeSlide) activeSlide.classList.remove("is-active");
    activeSlide = slide;
    activeSlide.classList.add("is-active");
    if (zoomTimer) {
      window.clearTimeout(zoomTimer);
      zoomTimer = null;
    }
    zoom.classList.remove("is-entering");
    zoomImage.src = src;
    zoomImage.alt = alt || "";
    zoom.hidden = false;
    window.requestAnimationFrame(function () {
      zoom.classList.add("is-visible");
      zoom.classList.add("is-entering");
      zoomTimer = window.setTimeout(function () {
        zoom.classList.remove("is-entering");
      }, 320);
    });
  }

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);

  function destroy() {
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", endPointer);
    viewport.removeEventListener("pointercancel", endPointer);
    root.classList.remove("draggable-gallery");
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
