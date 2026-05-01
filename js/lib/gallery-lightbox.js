const items = [...document.querySelectorAll(".gallery-item")];
const lightbox = document.getElementById("lightbox");
const image = document.getElementById("lightbox-image");
const closeBtn = document.getElementById("lightbox-close");
const prevBtn = document.getElementById("lightbox-prev");
const nextBtn = document.getElementById("lightbox-next");

if (!items.length || !lightbox || !image || !closeBtn || !prevBtn || !nextBtn) {
  // Not on gallery page.
} else {
  let current = 0;

  const open = (index) => {
    current = index;
    image.src = items[current].dataset.full || "";
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  };

  const close = () => {
    lightbox.hidden = true;
    image.src = "";
    document.body.style.overflow = "";
  };

  const step = (dir) => {
    current = (current + dir + items.length) % items.length;
    image.src = items[current].dataset.full || "";
  };

  items.forEach((item, i) => item.addEventListener("click", () => open(i)));
  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) close();
  });

  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  });
}
