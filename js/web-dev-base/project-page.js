/**
 * Reusable project header + back link (expects matching class names in your stylesheet).
 * Site-wide “Live” / staging chrome comes from `lib/staging/staging.js`, not this module — use `<html data-official-live="true">` on production pages to hide it.
 */

/**
 * Forces a landscape-style mobile layout and optionally attempts browser orientation lock.
 * Always applies a CSS class fallback, so layout stays landscape-styled even when lock fails.
 *
 * @param {{
 *   root?: HTMLElement,
 *   className?: string,
 *   tryLock?: boolean,
 * }} [options] – defaults: `root` `document.documentElement`, `className` `project-page-force-landscape`, `tryLock` true
 * @returns {Promise<{ classApplied: boolean, lockAttempted: boolean, lockSucceeded: boolean }>}
 */
export async function forceLandscapeMobile(options) {
  const o = options || {};
  const root =
    o.root instanceof HTMLElement ? o.root : document.documentElement;
  const className =
    typeof o.className === "string" && o.className.trim()
      ? o.className.trim()
      : "project-page-force-landscape";
  const tryLock = o.tryLock !== false;

  root.classList.add(className);

  let lockAttempted = false;
  let lockSucceeded = false;

  const orientation = screen.orientation;
  if (tryLock && orientation && typeof orientation.lock === "function") {
    lockAttempted = true;
    try {
      await orientation.lock("landscape");
      lockSucceeded = true;
    } catch (_error) {
      // Ignore lock failures; class-based landscape styling is the reliable fallback.
    }
  }

  return { classApplied: true, lockAttempted, lockSucceeded };
}

/**
 * @param {{ href?: string, label?: string, showContact?: boolean, contactHref?: string, contactLabel?: string, footerTarget?: HTMLElement | string | null }} [options]
 * – Defaults: `href` `../index.html`, `label` `back`, `showContact` false, `contactHref` `contact.html`, `contactLabel` `contact`.
 *   If a project footer exists (or `footerTarget` resolves), renders footer nav links inside that footer.
 */
export function mountProjectBackButton(options) {
  const o = options || {};
  const footerMount =
    typeof o.footerTarget === "string"
      ? document.querySelector(o.footerTarget)
      : o.footerTarget || document.querySelector(".project-page-footer");

  if (footerMount) {
    if (footerMount.querySelector(".project-page-footer-nav")) {
      return;
    }

    const nav = document.createElement("nav");
    nav.className = "project-page-footer-nav";
    nav.setAttribute("aria-label", "Project navigation");

    const back = document.createElement("a");
    back.className = "back-link";
    back.href = o.href != null ? o.href : "../index.html";
    back.textContent = o.label != null ? o.label : "back";

    nav.appendChild(back);

    if (o.showContact === true) {
      const contact = document.createElement("a");
      contact.className = "contact-link";
      contact.href = o.contactHref != null ? o.contactHref : "contact.html";
      contact.textContent = o.contactLabel != null ? o.contactLabel : "contact";
      nav.appendChild(contact);
    }

    footerMount.appendChild(nav);
    return;
  }

  if (document.querySelector("a.back-link")) {
    return;
  }

  const back = document.createElement("a");
  back.className = "back-link";
  back.href = o.href != null ? o.href : "../index.html";
  back.textContent = o.label != null ? o.label : "back";
  document.body.appendChild(back);
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
 *   stickyHeaderHeight?: string,
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
    const height =
      typeof o.stickyHeaderHeight === "string" ? o.stickyHeaderHeight.trim() : "";
    if (height) {
      mount.style.setProperty("--project-page-header-sticky-height", height);
    } else {
      mount.style.removeProperty("--project-page-header-sticky-height");
    }
  } else {
    mount.classList.remove("project-page-header--sticky");
    mount.style.removeProperty("--project-page-header-sticky-top");
    mount.style.removeProperty("--project-page-header-sticky-height");
  }
}

/**
 * Fills a mount node with optional footer copy and sticky behavior (mirrors {@link mountProjectPageHeader}).
 *
 * @param {HTMLElement | string | null} target – element or selector (e.g. `.project-page-footer`)
 * @param {{
 *   text?: string,
 *   stickyFooter?: boolean,
 *   stickyFooterBottom?: string,
 *   stickyFooterHeight?: string,
 * }} options – `stickyFooter` true adds `.project-page-footer--sticky`; `stickyFooterBottom` sets `--project-page-footer-sticky-bottom` for `bottom` (e.g. `"env(safe-area-inset-bottom, 0px)"`).
 */
export function mountProjectPageFooter(target, options) {
  const mount =
    typeof target === "string" ? document.querySelector(target) : target;
  if (!mount || !options) {
    return;
  }

  const o = options;
  const text = typeof o.text === "string" ? o.text.trim() : "";

  const existingText = mount.querySelector(".project-page-footer-text");
  if (existingText) {
    existingText.remove();
  }

  if (!text && o.stickyFooter !== true) {
    mount.classList.remove("project-page-footer--sticky");
    mount.style.removeProperty("--project-page-footer-sticky-bottom");
    mount.style.removeProperty("--project-page-footer-sticky-height");
    return;
  }

  if (text) {
    const p = document.createElement("p");
    p.className = "project-page-footer-text";
    p.textContent = text;
    mount.appendChild(p);
  }

  if (o.stickyFooter === true) {
    mount.classList.add("project-page-footer--sticky");
    const bottom =
      typeof o.stickyFooterBottom === "string" ? o.stickyFooterBottom.trim() : "";
    if (bottom) {
      mount.style.setProperty(
        "--project-page-footer-sticky-bottom",
        bottom
      );
    } else {
      mount.style.removeProperty("--project-page-footer-sticky-bottom");
    }
    const height =
      typeof o.stickyFooterHeight === "string" ? o.stickyFooterHeight.trim() : "";
    if (height) {
      mount.style.setProperty("--project-page-footer-sticky-height", height);
    } else {
      mount.style.removeProperty("--project-page-footer-sticky-height");
    }
  } else {
    mount.classList.remove("project-page-footer--sticky");
    mount.style.removeProperty("--project-page-footer-sticky-bottom");
    mount.style.removeProperty("--project-page-footer-sticky-height");
  }
}
