const projects = [...document.querySelectorAll(".project")];
const previewImage = document.getElementById("preview-image");

if (projects.length && previewImage) {
  const activate = (item) => {
    projects.forEach((project) => project.classList.remove("is-active"));
    item.classList.add("is-active");
    const nextImage = item.getAttribute("data-image");
    if (nextImage) previewImage.src = nextImage;
  };

  projects.forEach((item) => {
    item.addEventListener("mouseenter", () => activate(item));
    item.addEventListener("focus", () => activate(item));
  });

  activate(projects[0]);
}
