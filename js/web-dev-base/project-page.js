/**
 * Reusable project header + back link (expects matching CSS class names in your stylesheet).
 */

/**
 * @param {{ href?: string, label?: string }} [options] – defaults: `../index.html`, label `back`
 */
export function mountProjectBackButton(options) {
  if (document.querySelector("a.back-link")) {
    return;
  }
  const o = options || {};
  const a = document.createElement("a");
  a.className = "back-link";
  a.href = o.href != null ? o.href : "../index.html";
  a.textContent = o.label != null ? o.label : "back";
  document.body.appendChild(a);
}

/**
 * Fills a mount node with the standard project header: optional home line, title, optional lead.
 *
 * @param {HTMLElement | string | null} target – element or selector (e.g. `.project-page-header`)
 * @param {{
 *   title: string,
 *   lead?: string,
 *   showHomeLink?: boolean,
 *   homeHref?: string,
 *   titleHref?: string,
 *   stickyHeader?: boolean,
 *   stickyHeaderTop?: string,
 * }} options – `showHomeLink` defaults true; set false for title-only. Title links to `titleHref` or `homeHref` (default `../index.html`). `stickyHeader` true adds a sticky bar on the mount node; `stickyHeaderTop` optional CSS length for `top` (e.g. `"12px"`, `"env(safe-area-inset-top, 0px)"`).
 */
export function mountProjectPageHeader(target, options) {
  const mount =
    typeof target === "string" ? document.querySelector(target) : target;
  if (!mount || !options || typeof options.title !== "string") {
    return;
  }

  mount.replaceChildren();
  const o = options;
  const homeHref = o.homeHref != null ? o.homeHref : "../index.html";
  const showHome = o.showHomeLink !== false;

  if (showHome) {
    const p = document.createElement("p");
    p.className = "photographer";
    const a = document.createElement("a");
    a.className = "photographer-link project-home-link";
    a.href = homeHref;
    a.textContent = "calvin van";
    p.appendChild(a);
    mount.appendChild(p);
  }

  const h1 = document.createElement("h1");
  h1.className = "project-page-title";
  const titleLink = document.createElement("a");
  titleLink.className = "project-page-title-link";
  titleLink.href = o.titleHref != null ? o.titleHref : homeHref;
  titleLink.textContent = o.title;
  h1.appendChild(titleLink);
  mount.appendChild(h1);

  if (o.lead) {
    const leadEl = document.createElement("p");
    leadEl.className = "project-page-lead";
    leadEl.textContent = o.lead;
    mount.appendChild(leadEl);
  }

  if (o.stickyHeader === true) {
    mount.classList.add("project-page-header--sticky");
    const top = typeof o.stickyHeaderTop === "string" ? o.stickyHeaderTop.trim() : "";
    if (top) {
      mount.style.setProperty("--project-page-header-sticky-top", top);
    } else {
      mount.style.removeProperty("--project-page-header-sticky-top");
    }
  } else {
    mount.classList.remove("project-page-header--sticky");
    mount.style.removeProperty("--project-page-header-sticky-top");
  }
}
