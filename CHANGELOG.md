# Changelog

Document notable changes whenever behavior, settings, or user-visible output changes—not only when you cut a release.

## [Unreleased]

### Added

- [feat] Portfolio homepage (`index.html`) lists photographer credit and project titles inside a reusable column shell (`column-layout`, `column-slot`) driven by `--columns-laptop` (default four tracks on wide layouts when staging is on).
- [feat] Staging-only multi-column grid and “Testing mode” label: enable with URL `?staging=1` or `?staging=true`, or persist with `localStorage` key `customdev_staging` set to `"1"` (`lib/staging/staging.js`, `lib/staging/staging.css`). Column primitives live in `lib/layout/layout.css`; production viewing hides spacer columns until staging activates.
- [feat] Photography gallery page with keyboard-friendly lightbox (`pages/gallery.html`, `style/gallery/gallery.css`, `js/lib/gallery-lightbox.js`).
- [feat] About and Contact pages (`pages/about.html`, `pages/contact.html`).
- [feat] Fixed-position Contact shortcut on the homepage linking to `pages/contact.html`.
- [feat] Mobile layout smoke-test shell embedding `index.html` in a phone-sized iframe (`mobile-view-index.html`).

### Changed

- [upg] Site typography uses embedded MingLiU-style face `MingLiuCustom` loaded from `mingliu.ttf` via `style/main.css`.

### Tests / tooling

- [docs] Added this changelog and release-notes conventions (`CHANGELOG.md`).

---

Release workflow (for maintainers): when you tag `x.y.z`, add `## [x.y.z] - YYYY-MM-DD` below `[Unreleased]`, move or summarize the relevant `[Unreleased]` bullets into that version, then trim `[Unreleased]` to empty or leave only planned work.
