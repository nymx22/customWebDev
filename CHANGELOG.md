# Changelog

Document notable changes whenever behavior, settings, or user-visible output changes—not only when you cut a release.

## [Unreleased]

### Added

- [feat] Portfolio homepage (`index.html`) lists photographer credit and project titles inside a reusable column shell (`column-layout`, `column-slot`) driven by `--columns-laptop` (default four tracks on wide layouts from `lib/layout/layout.css`).
- [feat] Optional staging (`lib/staging/staging.js`, `lib/staging/staging.css`): only when the URL includes `?staging=1` (or hash `#staging=1`), adds a top-left “Testing mode” label and `?staging=1` on same-origin links; otherwise live with no label (legacy `localStorage` staging key is cleared). Homepage and contact grids are always live at laptop widths in `lib/layout/layout.css`.
- [feat] Photography gallery page with keyboard-friendly lightbox (`pages/gallery.html`, `style/gallery/gallery.css`, `js/web-dev-base/gallery-core.js`).
- [feat] About and Contact pages (`pages/about.html`, `pages/contact.html`).
- [feat] Fixed-position Contact shortcut on the homepage linking to `pages/contact.html`.
- [feat] Mobile layout smoke-test shell embedding `index.html` in a phone-sized iframe (`mobile-view-index.html`).

### Changed

- [upg] Homepage two-row column grid (`column-layout--rows-2`) is always active at laptop widths from `lib/layout/layout.css`; staging shows the “Testing mode” label only when staging is enabled, not on live.
- [upg] Site typography uses embedded MingLiU-style face `MingLiuCustom` loaded from `mingliu.ttf` via `style/main.css`.

### Tests / tooling

- [docs] Added this changelog and release-notes conventions (`CHANGELOG.md`).

---

Release workflow (for maintainers): when you tag `x.y.z`, add `## [x.y.z] - YYYY-MM-DD` below `[Unreleased]`, move or summarize the relevant `[Unreleased]` bullets into that version, then trim `[Unreleased]` to empty or leave only planned work.
