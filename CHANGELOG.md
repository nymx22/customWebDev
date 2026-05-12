# Changelog

Document notable changes whenever behavior, settings, or user-visible output changes—not only when you cut a release.

## [Unreleased]

### Added

- [feat] Portfolio homepage (`index.html`) lists photographer credit and project titles inside a reusable column shell (`column-layout`, `column-slot`) driven by `--columns-laptop` (default four tracks on wide layouts from `lib/layout/layout.css`).
- [feat] Optional staging (`lib/staging/staging.js`, `lib/staging/staging.css`): when the URL includes `?staging=1` (or hash `#staging=1`), adds top-left **Staging** status badge and `?staging=1` on same-origin links; otherwise live (legacy `localStorage` staging key cleared). **Live** shows a top-left **Live** badge in the same spot; click adds `?staging=1`. Homepage and contact grids are always live at laptop widths in `lib/layout/layout.css`.
- [feat] Photography gallery page with keyboard-friendly lightbox (`pages/gallery.html`, `style/gallery/gallery.css`, `js/web-dev-base/gallery-core/gallery-core.js`).
- [feat] About and Contact pages (`pages/about.html`, `pages/contact.html`).
- [feat] Fixed-position Contact shortcut on the homepage linking to `pages/contact.html`.
- [feat] Draggable strip / zoom gallery (`createDraggableGallery` in `js/web-dev-base/gallery-core/gallery-core.js`): optional half-screen prev/next, `goPrev` / `goNext`, and staging-only **per-gallery** **“Gallery testing”** label on the dotted frame that toggles a **draggable** options panel (nav mode, open-zoom gesture, strip `scrollIntoView` behavior); prefs in `sessionStorage` JSON keyed by gallery id (`stagingGalleryPrefsStorageKey`); `stripHalfClickNav: false` / panel `stagingGalleryToolbar: false` to opt out. Styling in `style/gallery/draggable-gallery.css` and `lib/staging/staging.css`.
- [feat] Staging (`lib/staging/staging.js`): top-left **Staging** / **Live** badges (same position); click staging badge → live, live badge → `?staging=1`. Gallery testing UI stays on each draggable gallery. See `lib/staging/staging.txt`.
- [feat] Mobile layout smoke-test shell embedding `index.html` in a phone-sized iframe (`mobile-view-index.html`).

### Changed

- [upg] Farewell, Mr. Fuji (`js/farewell-mr-fuji.js`): gallery images load from `assets/images/FarewellMrFuji/bg_removed/` as PNGs (cover `Farewell, Mr. Fuji Scan.png` then scans 1–33); `forceLandscape` now aliases `forceLandscapeMobile` from `js/web-dev-base/project-page.js` to match the exported API.
- [upg] Farewell, Mr. Fuji (`style/main.css`): page-scoped overrides remove draggable gallery borders and the light panel background behind thumbs and the desktop zoom pane so PNGs sit flush on the page background.
- [upg] Homepage two-row column grid (`column-layout--rows-2`) is always active at laptop widths from `lib/layout/layout.css`; staging shows the top-left **Staging** badge only when staging is enabled, not on live.
- [upg] Site typography uses embedded MingLiU-style face `MingLiuCustom` loaded from `mingliu.ttf` via `style/main.css`.

### Tests / tooling

- [docs] Added this changelog and release-notes conventions (`CHANGELOG.md`).

---

Release workflow (for maintainers): when you tag `x.y.z`, add `## [x.y.z] - YYYY-MM-DD` below `[Unreleased]`, move or summarize the relevant `[Unreleased]` bullets into that version, then trim `[Unreleased]` to empty or leave only planned work.
