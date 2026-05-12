# Changelog

Document notable changes whenever behavior, settings, or user-visible output changes—not only when you cut a release.

## [Unreleased]

### Added

- [feat] **Layout SSOT + local API:** `server/dev_api.py` (default `127.0.0.1:8787`) reads/writes `lib/db/customdev.db` with CORS for localhost static origins; `GET /api/layout`, `GET /api/registry`, gallery/page/font `POST`/`PATCH`/`DELETE`. `npm run dev:api` in `package.json`. `lib/db/init_db.py` seeds demo pages and default galleries.
- [feat] **`js/web-dev-base/gallery-layout-from-db.js`:** page name from pathname, gallery key from `data-gallery-key`, maps SQLite gallery rows to `createDraggableGallery` options and optional `draggable-gallery--layout-*` classes; layout API base from `layoutApiBase` option, `window.__CUSTOMDEV_LAYOUT_API__`, or `<meta name="customdev-layout-api">`.
- [feat] **`createDraggableGallery`** (`gallery-core.js`) is **async**: in staging, loads layout from the local API before building DOM; staging panel split into **Layout (SQLite)** (PATCH) vs **Interaction** (existing session / publish prefs). Half-screen nav, zoom transitions, strip alignment, and published `localStorage` prefs behavior unchanged aside from layout-from-API and `official-live` gating.
- [feat] **Official canonical site:** `<html data-official-live="true">` or `1`, or `<meta name="customdev-official-live" content="true">` / `1`, sets `html.official-live`, ignores `?staging=1`, and adds **no** staging.js chrome (no Live badge, no status bar). Gallery staging/testing and layout API auto-fetch stay off when `official-live` is set (`gallery-core.js`, `gallery-layout-from-db.js`). Documented in `lib/staging/staging.txt`.
- [feat] Portfolio homepage (`index.html`) lists photographer credit and project titles inside a reusable column shell (`column-layout`, `column-slot`) driven by `--columns-laptop` (default four tracks on wide layouts from `lib/layout/layout.css`).
- [feat] Optional staging (`lib/staging/staging.js`, `lib/staging/staging.css`): when the URL includes `?staging=1` (or `#staging=1`) and the page is **not** marked **official-live** (see above), adds `html.staging`, top-left **Staging** badge, and `?staging=1` on same-origin links; otherwise legacy `localStorage` staging key is cleared. **Non-official** live pages show a top-left **Live** badge; click adds `?staging=1`. Homepage and contact grids are always live at laptop widths in `lib/layout/layout.css`.
- [feat] Photography gallery page with keyboard-friendly lightbox (`pages/gallery.html`, `style/gallery/gallery.css`, `js/web-dev-base/gallery-core/gallery-core.js`).
- [feat] About and Contact pages (`pages/about.html`, `pages/contact.html`).
- [feat] Fixed-position Contact shortcut on the homepage linking to `pages/contact.html`.
- [feat] Mobile layout smoke-test shell embedding `index.html` in a phone-sized iframe (`mobile-view-index.html`).

### Changed

- [upg] **Staging registry:** `lib/staging/staging.js` **Pages / galleries** dialog talks to the layout API (`GET /api/registry`, `POST`/`DELETE` page & gallery) instead of `localStorage` keys `customdev_staging_pages_v1` / `customdev_staging_galleries_v1`. Staging toolbar: **Staging**, **Publish galleries to live**, and **Pages / galleries** stay on one row (`lib/staging/staging.css`); publish feedback is single-line with ellipsis.
- [upg] **Production HTML:** `data-official-live="true"` on `<html>` for `index.html`, `pages/farewell-mr-fuji.html`, `pages/gallery.html`, and `pages/contact.html` so the top-left Live entry control does not appear on the canonical deploy for those routes.
- [upg] Farewell, Mr. Fuji (`js/farewell-mr-fuji.js`): `initFarewellMrFuji` is async and **awaits** `createDraggableGallery`; gallery root may use `data-gallery-key="default"`. Gallery images load from `assets/images/FarewellMrFuji/bg_removed/` as PNGs (cover `Farewell, Mr. Fuji Scan.png` then scans 1–33); `forceLandscape` now aliases `forceLandscapeMobile` from `js/web-dev-base/project-page.js` to match the exported API.
- [upg] Farewell, Mr. Fuji (`style/main.css`): page-scoped overrides remove draggable gallery borders and the light panel background behind thumbs and the desktop zoom pane so PNGs sit flush on the page background.
- [upg] Homepage two-row column grid (`column-layout--rows-2`) is always active at laptop widths from `lib/layout/layout.css`; staging shows the top-left **Staging** badge only when staging is enabled, not on live.
- [upg] Site typography uses embedded MingLiU-style face `MingLiuCustom` loaded from `mingliu.ttf` via `style/main.css`.

### Tests / tooling

- [docs] `lib/db/README.txt`, `lib/staging/staging.txt`, and `.cursor/rules/staging.mdc` updated for layout API, official-live, and production checklist.
- [docs] `js/web-dev-base/project-page.js` file comment clarifies Live/staging chrome comes from `staging.js`, not project-page.
- [docs] Added this changelog and release-notes conventions (`CHANGELOG.md`).

---

Release workflow (for maintainers): when you tag `x.y.z`, add `## [x.y.z] - YYYY-MM-DD` below `[Unreleased]`, move or summarize the relevant `[Unreleased]` bullets into that version, then trim `[Unreleased]` to empty or leave only planned work.
