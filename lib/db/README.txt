SQLite store: lib/db/customdev.db (layout SSOT)

Tables (see schema.sql):

  page
    id            INTEGER PRIMARY KEY
    name          TEXT NOT NULL UNIQUE          — page slug from URL (see identity below)
    header        INTEGER NOT NULL 0|1          — show header (app-defined)
    footer        INTEGER NOT NULL 0|1          — show footer (app-defined)

  gallery
    id              INTEGER PRIMARY KEY
    page_id         INTEGER NOT NULL → page(id) ON DELETE CASCADE
    gallery_key     TEXT NOT NULL DEFAULT 'default' — multiple galleries per page
    thumbnail       INTEGER NOT NULL 0|1        — thumbnail strip on
    zoom            INTEGER NOT NULL 0|1        — zoom UI on
    zoom_style      TEXT                        — e.g. bookflip, crossfade (maps to gallery zoom-image transition)
    column_count    INTEGER                     — zoom-open grid column count (≥2)
    row_count       INTEGER                     — reserved / future grid rows
    gallery_style   TEXT                        — optional token → root class draggable-gallery--layout-g-<token>
    thumbnail_style TEXT                        — optional token; values fill / cover set thumb fill mode
    UNIQUE (page_id, gallery_key)

  font
    id           INTEGER PRIMARY KEY
    page_id      INTEGER NOT NULL UNIQUE → page(id) ON DELETE CASCADE — one typography row per page
    font_size    INTEGER NOT NULL
    font_family  TEXT NOT NULL

  frame
    id             INTEGER PRIMARY KEY
    page_id        INTEGER NOT NULL UNIQUE → page(id) ON DELETE CASCADE
    column_count   INTEGER — grid columns (1–24)
    row_count      INTEGER — grid rows (1–24)
    label          TEXT — short name for the staging chip (e.g. home); shown as pageName / label
    grid_gap       TEXT — optional CSS `gap` for the frame root when it is a CSS grid (e.g. 12px)
    notes          TEXT — author notes only (not rendered on the public site)
    default_text_font_family TEXT — default `fontFamily` for new text cells (staging; same values as **GET /api/fonts** / presets / custom CSS)
    default_text_font_size INTEGER — default font size in px (8–288) for new text cells

  frame_cell
    id             INTEGER PRIMARY KEY
    frame_id       INTEGER NOT NULL → frame(id) ON DELETE CASCADE
    cell_index     INTEGER NOT NULL — 0 .. (column_count * row_count - 1), row-major
    content_type   TEXT — empty | text | html | image | table (table: body = tab-separated text; line 1 = header columns)
    body           TEXT — plain text (text), HTML snippet (html), image URL (image), tab text (table), or empty
    css_class      TEXT — legacy; staging/API no longer surface it for authoring (cleared on text saves)
    aria_label     TEXT — legacy; cleared on text saves
    cell_role      TEXT — optional author label for staging (e.g. projects); saved in DB, not rendered on the public page
    UNIQUE (frame_id, cell_index)

  frame_cell_text  (one row per cell when content_type = text; PK = frame_cell_id → frame_cell(id) ON DELETE CASCADE)
    font_family    TEXT
    font_size      INTEGER — px, clamped server-side (e.g. 8–288)
    line_height_pct INTEGER — line spacing as % of font size (50–250; 100 = browser default relative leading)
    padding        TEXT — optional CSS padding for the text wrapper
    nav_url        TEXT — optional same-origin / https link
    nav_label      TEXT — optional anchor label (defaults to URL if empty)

Identity (for GET /api/layout and gallery init):

  page name — from the URL path’s last segment without .html (e.g. /pages/farewell-mr-fuji.html → farewell-mr-fuji; / or /index.html → index). Implemented in js/web-dev-base/gallery-layout-from-db.js as pageNameFromPathname().

  gallery key — from the gallery root element: data-gallery-key="..." if set, otherwise default. Implemented as galleryKeyFromRoot() (default default).

Build / refresh the database file (drops existing file, applies schema, seeds demo pages + default galleries):

  python3 lib/db/init_db.py

Update an existing database in place (adds missing frame/frame_cell columns including **default_text_font_family** and **default_text_font_size** on `frame`; rebuilds `frame_cell` when the old `content_type` CHECK omits `table` or `text`; creates **frame_cell_text** when missing):

  python3 lib/db/migrate_schema.py
  # optional: python3 lib/db/migrate_schema.py /path/to/customdev.db

Requires Python 3 (stdlib sqlite3 only).

Local layout API (read/write this DB during staging):

  npm run dev:api
  # or: python3 server/dev_api.py

  Binds 127.0.0.1:8787 by default (CUSTOMDEV_API_PORT / CUSTOMDEV_API_HOST). Database path: CUSTOMDEV_DB or lib/db/customdev.db.

  Endpoints: GET /api/layout?page=<name>&galleryKey=<key>, GET /api/fonts (lists **assets/fonts** for frame text `cssFamily` names), GET /api/registry (includes **frames**), GET /api/pages, GET /api/galleries?page=..., GET /api/frame?page=..., POST /api/page, POST /api/gallery, POST /api/frame, PATCH /api/gallery|/api/page|/api/font|/api/frame|/api/frame/cell, DELETE /api/page?id=...& /api/gallery?id=...

  `GET /api/fonts`: JSON `{ "fonts": [ { "file", "cssFamily", "label" } ] }`. Add a matching `@font-face` in `style/local-asset-fonts.css` for each new file (same `cssFamily` rule as the API).

  `PATCH /api/frame/cell`: body `{ id, contentType?, body?, cellRole?, textStyle? }`. For `contentType: "text"`, include `textStyle: { fontFamily, fontSize, lineHeightPct, padding, navUrl, navLabel }` (`lineHeightPct` 50–250, default 100). Body is plain text. Page-level typography defaults live in table **`font`** (`GET /api/layout` → `font`).

  `PATCH /api/frame`: body `{ id, label?, gridGap?, notes?, columnCount?, rowCount?, defaultTextFontFamily?, defaultTextFontSize? }`. Changing **columnCount**×**rowCount** clears all `frame_cell` rows and inserts empty cells; same dimensions only updates metadata.

Staging in the browser uses this API for the **Pages, frames & galleries** dialog, per-gallery layout in the “Gallery testing” panel, and the **Frame** editor on pages with `data-site-frame-page` (label + panel from `js/web-dev-base/staging-gui-settings.js`, wired by `site-frame.js`; see lib/staging/staging.txt).

Static deploy (Option B — bake DB to JSON):

  npm run export:layout
  # writes data/layout/ (frame/*.json, gallery/<page>/<key>.json, manifest.json)

  Staging **Publish** also calls POST /api/export-layout after saving SQLite.

  On **official-live** pages, the site loads baked JSON from data/layout/ (see data/layout/README.txt and js/web-dev-base/layout-baked.js). No Python API is required on the public host — deploy static files + data/layout/ only.
